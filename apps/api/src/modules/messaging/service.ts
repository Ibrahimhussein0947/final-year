import type { ApplicationStatus, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { emitToUser } from '../../realtime';

/**
 * Messaging is tied to an application: an employer and a worker can write to each other once the worker has
 * applied to one of that employer's jobs. This keeps the channel to people with a real reason to talk (no cold
 * messages to strangers, no spam inbox) and means contact never starts without the worker's consent (applying).
 * When an application ends (rejected or withdrawn) the conversation stays readable but nobody can add to it.
 *
 * One more way in, before anyone has applied: an employer can invite a worker to a job, and the *worker* can then
 * choose to reply with a question. Only the worker can start that conversation, so contact never begins without their
 * consent, and it ends (read-only) if they decline the invitation or the job closes. If they go on to apply, the same
 * conversation continues under the application.
 */
const CLOSED: ApplicationStatus[] = ['REJECTED', 'WITHDRAWN'];
const MAX_BODY = 2000;

// Control characters (except newline and tab) have no place in a chat message.
const cleanBody = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The application, if (and only if) this user is the worker who applied or an employer of the job's organization. */
async function accessibleApplication(userId: string, role: Role, applicationId: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true, status: true, workerId: true, worker: { select: { userId: true } },
      job: { select: { id: true, title: true, organizationId: true, organization: { select: { name: true } } } },
    },
  });
  if (!app) throw notFound('Application not found');
  if (role === 'WORKER') {
    if (app.worker.userId !== userId) throw notFound('Application not found');
  } else if (role === 'EMPLOYER') {
    const ep = await prisma.employerProfile.findUnique({ where: { userId }, select: { organizationId: true } });
    if (ep?.organizationId !== app.job.organizationId) throw notFound('Application not found');
  } else {
    throw forbidden();
  }
  return app;
}

/** Open the conversation for an application, creating it on first use. */
export async function openConversation(userId: string, role: Role, applicationId: string) {
  const app = await accessibleApplication(userId, role, applicationId);
  let conv = await prisma.conversation.findUnique({ where: { applicationId }, select: { id: true } });
  if (!conv) {
    if (CLOSED.includes(app.status)) throw conflict('Messaging is closed for this application');
    // A conversation that began from an invitation carries on under the application.
    const fromInvitation = await prisma.conversation.findFirst({ where: { applicationId: null, invitation: { jobId: app.job.id, workerId: app.workerId } }, select: { id: true } });
    if (fromInvitation) {
      conv = await prisma.conversation.update({ where: { id: fromInvitation.id }, data: { applicationId }, select: { id: true } });
    }
  }
  if (!conv) {
    try {
      conv = await prisma.conversation.create({
        data: { applicationId, participants: { create: [{ userId: app.worker.userId }, ...(userId !== app.worker.userId ? [{ userId }] : [])] } },
        select: { id: true },
      });
    } catch {
      // two people opened it at the same moment; the unique index let only one succeed
      conv = await prisma.conversation.findUniqueOrThrow({ where: { applicationId }, select: { id: true } });
    }
  }
  // An employer colleague opening an existing conversation joins it.
  await prisma.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId: conv.id, userId } },
    update: {},
    create: { conversationId: conv.id, userId },
  });
  return { conversationId: conv.id };
}

async function participantConversation(userId: string, conversationId: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, participants: { some: { userId } } },
    select: { id: true, applicationId: true, invitationId: true, participants: { select: { userId: true } } },
  });
  if (!conv) throw notFound('Conversation not found');
  return conv;
}

/** Why a conversation that began from an invitation can no longer take messages, or null if it still can. */
async function invitationClosedReason(invitationId: string): Promise<string | null> {
  const inv = await prisma.jobInvitation.findUnique({ where: { id: invitationId }, select: { status: true, job: { select: { status: true, deadline: true } } } });
  if (!inv) return 'This conversation is no longer available';
  if (inv.status === 'DECLINED') return 'The invitation was declined, so the conversation is read-only';
  if (inv.status === 'SENT' && (inv.job.status !== 'ACTIVE' || (inv.job.deadline && inv.job.deadline.getTime() < Date.now()))) return 'This job is no longer open, so the conversation is read-only';
  return null;
}

/**
 * Open the conversation for an invitation, before the worker has applied.
 * The worker starts it (that is their consent). The employer can only join one that already exists.
 */
export async function openInvitationConversation(userId: string, role: Role, invitationId: string) {
  const inv = await prisma.jobInvitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true, status: true, jobId: true, workerId: true, invitedById: true,
      worker: { select: { userId: true } },
      job: { select: { status: true, deadline: true, organizationId: true } },
      conversation: { select: { id: true } },
    },
  });
  if (!inv) throw notFound('Invitation not found');

  if (role === 'WORKER') {
    if (inv.worker.userId !== userId) throw notFound('Invitation not found');
  } else if (role === 'EMPLOYER') {
    const ep = await prisma.employerProfile.findUnique({ where: { userId }, select: { organizationId: true } });
    if (ep?.organizationId !== inv.job.organizationId) throw notFound('Invitation not found');
  } else {
    throw forbidden();
  }

  // Once they have applied, the application is the place to talk.
  if (inv.status === 'APPLIED') {
    const application = await prisma.application.findUnique({ where: { jobId_workerId: { jobId: inv.jobId, workerId: inv.workerId } }, select: { id: true } });
    if (application) return openConversation(userId, role, application.id);
  }

  let convId = inv.conversation?.id ?? null;
  if (!convId) {
    if (role !== 'WORKER') throw conflict('The worker has not replied to your invitation yet. They decide whether to start a conversation.');
    const reason = await invitationClosedReason(inv.id);
    if (reason) throw conflict(reason.replace(', so the conversation is read-only', '').replace('. ', ''));
    try {
      convId = (await prisma.conversation.create({
        data: { invitationId: inv.id, participants: { create: [{ userId: inv.worker.userId }, { userId: inv.invitedById }] } },
        select: { id: true },
      })).id;
    } catch {
      convId = (await prisma.conversation.findUniqueOrThrow({ where: { invitationId: inv.id }, select: { id: true } })).id;
    }
  }
  await prisma.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId: convId, userId } },
    update: {},
    create: { conversationId: convId, userId },
  });
  return { conversationId: convId };
}

async function statusOf(applicationId: string | null): Promise<ApplicationStatus | null> {
  if (!applicationId) return null;
  return (await prisma.application.findUnique({ where: { id: applicationId }, select: { status: true } }))?.status ?? null;
}

export async function listConversations(userId: string) {
  const convs = await prisma.conversation.findMany({
    where: { participants: { some: { userId } } },
    select: {
      id: true, applicationId: true, invitationId: true, serviceInquiryId: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, senderId: true, createdAt: true } },
    },
  });
  // Chats that began when a provider accepted a service inquiry: both sides see the other person and the service title.
  const svcIds = convs.map((c) => c.serviceInquiryId).filter((x): x is string => !!x);
  const svcInquiries = await prisma.serviceInquiry.findMany({
    where: { id: { in: svcIds } },
    select: { id: true, customerId: true, customer: { select: { fullName: true } }, service: { select: { id: true, title: true, worker: { select: { userId: true, user: { select: { fullName: true } } } } } } },
  });
  const bySvc = new Map(svcInquiries.map((i) => [i.id, i]));
  const appIds = convs.map((c) => c.applicationId).filter((x): x is string => !!x);
  const apps = await prisma.application.findMany({
    where: { id: { in: appIds } },
    select: {
      id: true, status: true,
      worker: { select: { userId: true, user: { select: { fullName: true } } } },
      job: { select: { id: true, title: true, organization: { select: { name: true } } } },
    },
  });
  const byApp = new Map(apps.map((a) => [a.id, a]));
  const invIds = convs.filter((c) => !c.applicationId && c.invitationId).map((c) => c.invitationId as string);
  const invs = await prisma.jobInvitation.findMany({
    where: { id: { in: invIds } },
    select: {
      id: true, status: true, worker: { select: { userId: true, user: { select: { fullName: true } } } },
      job: { select: { id: true, title: true, status: true, deadline: true, organization: { select: { name: true } } } },
    },
  });
  const byInv = new Map(invs.map((i) => [i.id, i]));
  const unread = await prisma.message.groupBy({
    by: ['conversationId'],
    where: { conversation: { participants: { some: { userId } } }, senderId: { not: userId }, readAt: null },
    _count: true,
  });
  const unreadBy = new Map(unread.map((u) => [u.conversationId, u._count]));

  const items = convs.map((c) => {
    const svc = c.serviceInquiryId ? bySvc.get(c.serviceInquiryId) : undefined;
    if (svc) {
      const iAmCustomer = svc.customerId === userId;
      const last = c.messages[0] ?? null;
      return {
        id: c.id,
        applicationId: null,
        beforeApplying: false,
        readOnly: false,
        with: { name: iAmCustomer ? svc.service.worker.user.fullName : svc.customer.fullName, role: iAmCustomer ? 'PROVIDER' : 'CUSTOMER' } as { name: string; role: string },
        job: null,
        service: { id: svc.service.id, title: svc.service.title },
        lastMessage: last ? { preview: clip(last.body.replace(/\s+/g, ' '), 100), mine: last.senderId === userId, createdAt: last.createdAt } : null,
        unread: unreadBy.get(c.id) ?? 0,
      };
    }
    const a = c.applicationId ? byApp.get(c.applicationId) : (c.invitationId ? byInv.get(c.invitationId) : undefined);
    const iAmWorker = a?.worker.userId === userId;
    const last = c.messages[0] ?? null;
    const inv = !c.applicationId && c.invitationId ? byInv.get(c.invitationId) : undefined;
    const invClosed = !!inv && (inv.status === 'DECLINED' || (inv.status === 'SENT' && (inv.job.status !== 'ACTIVE' || (!!inv.job.deadline && inv.job.deadline.getTime() < Date.now()))));
    return {
      id: c.id,
      applicationId: c.applicationId,
      beforeApplying: !!inv,
      readOnly: inv ? invClosed : a && 'status' in a && c.applicationId ? CLOSED.includes(a.status as ApplicationStatus) : false,
      // Workers see the organization; employers see the worker's name. Never a phone number or email.
      with: a ? { name: iAmWorker ? a.job.organization.name : a.worker.user.fullName, role: iAmWorker ? 'EMPLOYER' : 'WORKER' } : null,
      job: a ? { id: a.job.id, title: a.job.title } : null,
      service: null as { id: string; title: string } | null,
      lastMessage: last ? { preview: clip(last.body.replace(/\s+/g, ' '), 100), mine: last.senderId === userId, createdAt: last.createdAt } : null,
      unread: unreadBy.get(c.id) ?? 0,
    };
  });
  items.sort((x, y) => (y.lastMessage?.createdAt.getTime() ?? 0) - (x.lastMessage?.createdAt.getTime() ?? 0));
  return items;
}

export async function unreadTotal(userId: string) {
  return prisma.message.count({ where: { conversation: { participants: { some: { userId } } }, senderId: { not: userId }, readAt: null } });
}

export async function getMessages(userId: string, conversationId: string, opts: { before?: Date; limit: number }) {
  const conv = await participantConversation(userId, conversationId);
  const rows = await prisma.message.findMany({
    where: { conversationId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
    select: { id: true, senderId: true, body: true, createdAt: true, readAt: true, sender: { select: { fullName: true } } },
  });
  const hasMore = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit).reverse(); // oldest first for display
  const status = await statusOf(conv.applicationId);
  const invitationClosed = !conv.applicationId && conv.invitationId ? !!(await invitationClosedReason(conv.invitationId)) : false;
  return {
    readOnly: status ? CLOSED.includes(status) : invitationClosed,
    hasMore,
    messages: page.map((m) => ({ id: m.id, mine: m.senderId === userId, senderName: m.sender.fullName, body: m.body, createdAt: m.createdAt, readAt: m.readAt })),
  };
}

export async function sendMessage(userId: string, conversationId: string, rawBody: string) {
  const body = cleanBody(rawBody);
  if (!body) throw badRequest('Write a message first');
  if (body.length > MAX_BODY) throw badRequest(`Messages can be at most ${MAX_BODY} characters`);
  const conv = await participantConversation(userId, conversationId);
  const status = await statusOf(conv.applicationId);
  if (status && CLOSED.includes(status)) throw conflict('This application has ended, so the conversation is read-only');
  if (!conv.applicationId && conv.invitationId) {
    const reason = await invitationClosedReason(conv.invitationId);
    if (reason) throw conflict(reason);
  }

  const sender = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
  const msg = await prisma.message.create({ data: { conversationId, senderId: userId, body }, select: { id: true, createdAt: true } });

  const others = conv.participants.map((p) => p.userId).filter((id) => id !== userId);
  for (const to of others) {
    emitToUser(to, 'message:new', { conversationId, message: { id: msg.id, senderName: sender.fullName, body, createdAt: msg.createdAt, mine: false } });
    await notifyMessage(to, conversationId, sender.fullName);
  }
  return { id: msg.id, mine: true, senderName: sender.fullName, body, createdAt: msg.createdAt, readAt: null };
}

/**
 * One notification per conversation while it is unread ("3 new messages from X"), instead of one per message.
 * The notification never contains the message text.
 */
async function notifyMessage(userId: string, conversationId: string, fromName: string) {
  const existing = await prisma.notification.findFirst({
    where: { userId, type: 'message.new', readAt: null, payload: { path: ['conversationId'], equals: conversationId } },
  });
  const count = ((existing?.payload as { count?: number } | null)?.count ?? 0) + 1;
  const payload = { conversationId, fromName, count };
  const n = existing
    ? await prisma.notification.update({ where: { id: existing.id }, data: { payload } })
    : await prisma.notification.create({ data: { userId, type: 'message.new', payload } });
  emitToUser(userId, 'notification:new', { id: n.id, type: 'message.new', payload, readAt: null, createdAt: n.createdAt });
}

export async function markRead(userId: string, conversationId: string) {
  const conv = await participantConversation(userId, conversationId);
  const { count } = await prisma.message.updateMany({ where: { conversationId, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() } });
  // the related notification is now stale
  await prisma.notification.updateMany({
    where: { userId, type: 'message.new', readAt: null, payload: { path: ['conversationId'], equals: conversationId } },
    data: { readAt: new Date() },
  });
  if (count > 0) {
    for (const other of conv.participants.map((p) => p.userId).filter((id) => id !== userId)) emitToUser(other, 'message:read', { conversationId });
  }
  return { marked: count };
}
