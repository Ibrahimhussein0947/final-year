import { z } from 'zod';
import type { OrganizationType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { notify } from '../notifications/service';
import { orgIdFor } from '../jobs/service';
import { workerIdFor } from '../workers/service';
import { getPolicy } from './service';

/**
 * A candidate who was not selected may ask the employer to look again, where the organization type allows it (appealDays > 0),
 * within that many days of the rejection, once. The employer must answer in writing: the decision stands, or the application
 * goes back under review. The platform does not decide the appeal, and reopening does not mean the person will be hired.
 */
const DAY = 86_400_000;

export const appealSchema = z.object({ reason: z.string().trim().min(10, 'Say why you ask for a review (at least 10 letters)').max(300) }).strict();
export const answerSchema = z.object({ outcome: z.enum(['UPHELD', 'REOPENED']), reply: z.string().trim().min(10, 'Write a short reply (at least 10 letters)').max(300) }).strict();

const rejectedAt = async (applicationId: string) =>
  (await prisma.applicationStatusHistory.findFirst({ where: { applicationId, toStatus: 'REJECTED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt ?? null;

/** What a worker's application card needs to know about asking for a review. */
export async function appealState(app: { id: string; status: string; orgType: OrganizationType }, appeal: { reason: string; createdAt: Date; answeredAt: Date | null; outcome: string | null; reply: string | null } | null) {
  if (app.status !== 'REJECTED' && !appeal) return null;
  const policy = await getPolicy(app.orgType);
  const at = await rejectedAt(app.id);
  const until = at && policy.appealDays > 0 ? new Date(at.getTime() + policy.appealDays * DAY) : null;
  return {
    canAppeal: app.status === 'REJECTED' && !appeal && !!until && until.getTime() > Date.now(),
    until, days: policy.appealDays,
    appeal: appeal ? { reason: appeal.reason, createdAt: appeal.createdAt, answered: !!appeal.answeredAt, outcome: appeal.outcome, reply: appeal.reply } : null,
  };
}

export async function submitAppeal(userId: string, applicationId: string, reason: string) {
  const workerId = await workerIdFor(userId);
  const app = await prisma.application.findFirst({
    where: { id: applicationId, workerId },
    select: { id: true, status: true, appeal: { select: { id: true } }, job: { select: { id: true, title: true, postedById: true, organization: { select: { type: true } } } } },
  });
  if (!app) throw notFound('Application not found');
  if (app.status !== 'REJECTED') throw conflict('You can ask for a review only after you were not selected.');
  if (app.appeal) throw conflict('You already asked for a review of this decision.');
  const state = await appealState({ id: app.id, status: app.status, orgType: app.job.organization.type }, null);
  if (!state || state.days === 0) throw forbidden('This kind of employer does not take requests for a review.');
  if (!state.canAppeal) throw conflict(`The time to ask for a review (${state.days} days) has passed.`);
  const row = await prisma.applicationAppeal.create({ data: { applicationId, reason } });
  await notify(app.job.postedById, 'appeal.received', { applicationId, jobId: app.job.id, jobTitle: app.job.title });
  return { id: row.id };
}

async function ownedForEmployer(userId: string, applicationId: string) {
  const orgId = await orgIdFor(userId);
  const app = await prisma.application.findFirst({
    where: { id: applicationId, job: { organizationId: orgId } },
    select: { id: true, status: true, worker: { select: { userId: true } }, appeal: true, job: { select: { id: true, title: true, status: true } } },
  });
  if (!app) throw notFound('Application not found');
  return app;
}

export async function employerAppeal(userId: string, applicationId: string) {
  const app = await ownedForEmployer(userId, applicationId);
  return app.appeal ? { reason: app.appeal.reason, createdAt: app.appeal.createdAt, answered: !!app.appeal.answeredAt, outcome: app.appeal.outcome, reply: app.appeal.reply, answeredAt: app.appeal.answeredAt } : null;
}

export async function answerAppeal(userId: string, applicationId: string, input: z.infer<typeof answerSchema>) {
  const app = await ownedForEmployer(userId, applicationId);
  if (!app.appeal) throw notFound('There is no request for a review on this application');
  if (app.appeal.answeredAt) throw conflict('This request was already answered.');
  if (input.outcome === 'REOPENED' && !['ACTIVE', 'CLOSED'].includes(app.job.status)) throw badRequest('The job is filled or removed, so the application cannot be reopened', { outcome: ['Choose "decision stands" or reopen only while the job is open or closed'] });
  const claimed = await prisma.applicationAppeal.updateMany({ where: { id: app.appeal.id, answeredAt: null }, data: { answeredAt: new Date(), outcome: input.outcome, reply: input.reply } });
  if (!claimed.count) throw conflict('This request was already answered.');
  if (input.outcome === 'REOPENED') {
    await prisma.$transaction([
      prisma.application.update({ where: { id: applicationId }, data: { status: 'UNDER_REVIEW' } }),
      prisma.applicationStatusHistory.create({ data: { applicationId, fromStatus: 'REJECTED', toStatus: 'UNDER_REVIEW', byUserId: userId, note: 'Reopened after the candidate asked for a review' } }),
    ]);
  }
  await notify(app.worker.userId, 'appeal.answered', { applicationId, jobId: app.job.id, jobTitle: app.job.title, outcome: input.outcome, reply: input.reply });
  return { outcome: input.outcome };
}
