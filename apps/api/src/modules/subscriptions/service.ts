import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { notify } from '../notifications/service';

/**
 * Subscriptions are plans with limits, assigned and changed by administrators. The system does not take payments:
 * an administrator records how an employer paid (paymentNote). `null` for a limit means unlimited.
 * An organization with no current subscription gets the default plan.
 */

const planSelect = {
  id: true, slug: true, name: true, description: true, priceEtbMonthly: true, maxActiveJobs: true, maxInvitationsPerMonth: true,
  maxFeaturedJobs: true, maxApplicationsReviewedPerMonth: true, canSearchWorkers: true, isActive: true, isDefault: true, sortOrder: true,
} as const;

export type PlanView = Prisma.SubscriptionPlanGetPayload<{ select: typeof planSelect }>;

export class PlanLimitError extends AppError {
  constructor(message: string, limit: string) {
    super(402, 'PLAN_LIMIT', message, { limit: [limit] });
  }
}

export async function defaultPlan(): Promise<PlanView> {
  const plan = await prisma.subscriptionPlan.findFirst({ where: { isDefault: true }, select: planSelect });
  if (!plan) throw new AppError(500, 'NO_DEFAULT_PLAN', 'No default subscription plan is configured');
  return plan;
}

/** The subscription in force right now (started, not ended, not cancelled), else the default plan. */
export async function currentPlan(orgId: string) {
  const now = new Date();
  const sub = await prisma.subscription.findFirst({
    where: { organizationId: orgId, status: 'ACTIVE', startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    orderBy: { startsAt: 'desc' },
    select: { id: true, startsAt: true, endsAt: true, paymentNote: true, plan: { select: planSelect } },
  });
  if (sub) return { plan: sub.plan, subscription: { id: sub.id, startsAt: sub.startsAt, endsAt: sub.endsAt, paymentNote: sub.paymentNote }, isDefault: false };
  return { plan: await defaultPlan(), subscription: null, isDefault: true };
}

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

/** Applications this organisation has moved out of "pending" this month (the first decision on each one). */
export const reviewedCount = (orgId: string) =>
  prisma.applicationStatusHistory.count({
    where: { fromStatus: 'PENDING', byUserId: { not: null }, createdAt: { gte: monthStart() }, application: { job: { organizationId: orgId } } },
  });

export async function usageFor(orgId: string) {
  const [activeJobs, invitationsThisMonth, featuredJobs, reviewedThisMonth] = await Promise.all([
    prisma.job.count({ where: { organizationId: orgId, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } } }),
    prisma.jobInvitation.count({ where: { job: { organizationId: orgId }, createdAt: { gte: monthStart() } } }),
    prisma.job.count({ where: { organizationId: orgId, featuredAt: { not: null }, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } } }),
    reviewedCount(orgId),
  ]);
  return { activeJobs, invitationsThisMonth, featuredJobs, reviewedThisMonth };
}

/** What an employer sees about their own plan and how much of it they have used. */
export async function planStatus(orgId: string) {
  const [cur, usage] = await Promise.all([currentPlan(orgId), usageFor(orgId)]);
  return { ...cur, usage };
}

// ───────── Enforcement (called by the jobs and talent modules) ─────────

export async function assertCanPublish(orgId: string, jobId: string) {
  const { plan } = await currentPlan(orgId);
  if (plan.maxActiveJobs === null) return;
  const live = await prisma.job.count({ where: { organizationId: orgId, id: { not: jobId }, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } } });
  if (live >= plan.maxActiveJobs) {
    throw new PlanLimitError(`Your ${plan.name} plan allows ${plan.maxActiveJobs} open job${plan.maxActiveJobs === 1 ? '' : 's'} at a time. Close a job or ask the administrator to change your plan.`, 'maxActiveJobs');
  }
}

export async function assertCanInvite(orgId: string) {
  const { plan } = await currentPlan(orgId);
  if (plan.maxInvitationsPerMonth === null) return;
  const sent = await prisma.jobInvitation.count({ where: { job: { organizationId: orgId }, createdAt: { gte: monthStart() } } });
  if (sent >= plan.maxInvitationsPerMonth) {
    throw new PlanLimitError(`Your ${plan.name} plan allows ${plan.maxInvitationsPerMonth} invitations a month and you have used them. They reset next month, or ask the administrator to change your plan.`, 'maxInvitationsPerMonth');
  }
}

/** Featuring a job is a plan perk with a cap on how many live jobs can be featured at once. */
export async function assertCanFeature(orgId: string, jobId: string) {
  const { plan } = await currentPlan(orgId);
  if (plan.maxFeaturedJobs === null) return;
  const featured = await prisma.job.count({ where: { organizationId: orgId, id: { not: jobId }, featuredAt: { not: null }, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } } });
  if (featured >= plan.maxFeaturedJobs) {
    throw new PlanLimitError(
      plan.maxFeaturedJobs === 0
        ? `Featured jobs are not included in your ${plan.name} plan. Ask the administrator to change your plan.`
        : `Your ${plan.name} plan allows ${plan.maxFeaturedJobs} featured job${plan.maxFeaturedJobs === 1 ? '' : 's'} at a time. Remove the feature from another job first, or ask the administrator to change your plan.`,
      'maxFeaturedJobs',
    );
  }
}

/**
 * Called before the first decision on an application (leaving "pending"). Decisions on applications already in
 * progress are never blocked, so a candidate who has been shortlisted can always be taken forward or answered.
 */
export async function assertCanReview(orgId: string) {
  const { plan } = await currentPlan(orgId);
  if (plan.maxApplicationsReviewedPerMonth === null) return;
  const reviewed = await reviewedCount(orgId);
  if (reviewed >= plan.maxApplicationsReviewedPerMonth) {
    throw new PlanLimitError(`Your ${plan.name} plan allows reviewing ${plan.maxApplicationsReviewedPerMonth} new applications a month and you have used them. Applications already under review are not affected. The count restarts next month, or ask the administrator to change your plan.`, 'maxApplicationsReviewedPerMonth');
  }
}

export async function assertCanSearchWorkers(orgId: string) {
  const { plan } = await currentPlan(orgId);
  if (!plan.canSearchWorkers) throw new PlanLimitError(`Searching workers is not included in your ${plan.name} plan. Ask the administrator to change your plan.`, 'canSearchWorkers');
}

// ───────── Administration ─────────

const limit = z.number().int().min(0).max(100_000).nullable();
const planFields = {
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).transform((v) => v || null).nullable().optional(),
  priceEtbMonthly: z.number().int().min(0).max(10_000_000),
  maxActiveJobs: limit,
  maxInvitationsPerMonth: limit,
  maxFeaturedJobs: limit,
  maxApplicationsReviewedPerMonth: limit,
  canSearchWorkers: z.boolean(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};
export const planCreateSchema = z.object({ ...planFields, maxFeaturedJobs: limit.default(null), maxApplicationsReviewedPerMonth: limit.default(null), isActive: planFields.isActive.default(true), isDefault: planFields.isDefault.default(false), sortOrder: planFields.sortOrder.default(10), canSearchWorkers: planFields.canSearchWorkers.default(true), priceEtbMonthly: planFields.priceEtbMonthly.default(0) }).strict();
export const planUpdateSchema = z.object(planFields).partial().strict();

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plan';

export async function adminListPlans() {
  const plans = await prisma.subscriptionPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: planSelect });
  const now = new Date();
  const counts = await prisma.subscription.groupBy({ by: ['planId'], where: { status: 'ACTIVE', startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, _count: { _all: true } });
  return plans.map((p) => ({ ...p, subscribers: counts.find((c) => c.planId === p.id)?._count._all ?? 0 }));
}

export async function createPlan(input: z.infer<typeof planCreateSchema>) {
  const base = slugify(input.name);
  let slug = base;
  for (let i = 2; await prisma.subscriptionPlan.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.subscriptionPlan.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.subscriptionPlan.create({ data: { ...input, slug }, select: planSelect });
  });
}

export async function updatePlan(id: string, input: z.infer<typeof planUpdateSchema>) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, select: { id: true, isDefault: true } });
  if (!plan) throw notFound('Plan not found');
  if (plan.isDefault && (input.isDefault === false || input.isActive === false)) {
    throw conflict('The default plan cannot be switched off. Make another plan the default first.');
  }
  if (input.isDefault && input.isActive === false) throw badRequest('The default plan must be active');
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.subscriptionPlan.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
    if (input.isDefault) await tx.subscriptionPlan.update({ where: { id }, data: { isActive: true } });
    return tx.subscriptionPlan.update({ where: { id }, data: input, select: planSelect });
  });
}

export const assignSchema = z.object({
  planId: z.string().uuid(),
  endsAt: z.coerce.date().nullable().optional(),
  paymentNote: z.string().trim().max(300).transform((v) => v || null).nullable().optional(),
}).strict();

/** Put an organization on a plan from now. Any current subscription is ended first, so there is only ever one in force. */
export async function assignPlan(adminId: string, orgId: string, input: z.infer<typeof assignSchema>) {
  const [org, plan] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }),
    prisma.subscriptionPlan.findUnique({ where: { id: input.planId }, select: { id: true, isActive: true, name: true } }),
  ]);
  if (!org) throw notFound('Organization not found');
  if (!plan) throw notFound('Plan not found');
  if (!plan.isActive) throw conflict('That plan is switched off and cannot be assigned');
  const now = new Date();
  if (input.endsAt && input.endsAt <= now) throw badRequest('The end date must be in the future', { endsAt: ['Choose a later date'] });
  const created = await prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({ where: { organizationId: orgId, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: now } });
    return tx.subscription.create({
      data: { organizationId: orgId, planId: plan.id, startsAt: now, endsAt: input.endsAt ?? null, paymentNote: input.paymentNote ?? null, assignedById: adminId },
      select: { id: true },
    });
  });
  return { id: created.id, planName: plan.name };
}

/** Return an organization to the default plan. */
export async function cancelSubscription(orgId: string) {
  const { count } = await prisma.subscription.updateMany({ where: { organizationId: orgId, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  return { cancelled: count };
}

export async function adminSubscriptions(q: { q?: string; page: number; pageSize: number }) {
  const where: Prisma.OrganizationWhereInput = q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {};
  const [total, orgs] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, name: true, type: true } }),
  ]);
  const items = await Promise.all(orgs.map(async (o) => {
    const [cur, usage] = await Promise.all([currentPlan(o.id), usageFor(o.id)]);
    return { id: o.id, name: o.name, type: o.type, plan: { id: cur.plan.id, name: cur.plan.name }, isDefault: cur.isDefault, endsAt: cur.subscription?.endsAt ?? null, paymentNote: cur.subscription?.paymentNote ?? null, usage, maxActiveJobs: cur.plan.maxActiveJobs, maxInvitationsPerMonth: cur.plan.maxInvitationsPerMonth };
  }));
  return { total, page: q.page, pageSize: q.pageSize, items };
}

// ───────── Upgrade requests (the employer asks, an administrator decides; no payment is taken here) ─────────

export const planRequestSchema = z.object({ planId: z.string().uuid(), note: z.string().trim().max(300).transform((v) => v || null).nullable().optional() }).strict();
export const planDecisionSchema = z.object({
  endsAt: z.coerce.date().nullable().optional(),
  paymentNote: z.string().trim().max(300).transform((v) => v || null).nullable().optional(),
  decisionNote: z.string().trim().max(300).transform((v) => v || null).nullable().optional(),
}).strict();

const requestView = {
  id: true, status: true, note: true, createdAt: true, decidedAt: true, decisionNote: true,
  plan: { select: { id: true, name: true } },
} as const;

/** The plans an employer can ask for, the one they are on, and their open request (if any) and most recent decision. */
export async function plansForEmployer(orgId: string) {
  const [plans, cur, pending, lastDecided] = await Promise.all([
    prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { priceEtbMonthly: 'asc' }], select: planSelect }),
    currentPlan(orgId),
    prisma.planUpgradeRequest.findFirst({ where: { organizationId: orgId, status: 'PENDING' }, select: requestView }),
    prisma.planUpgradeRequest.findFirst({ where: { organizationId: orgId, status: { in: ['APPROVED', 'DECLINED'] } }, orderBy: { decidedAt: 'desc' }, select: requestView }),
  ]);
  return { plans, currentPlanId: cur.plan.id, pending, lastDecided };
}

export async function requestPlan(userId: string, orgId: string, input: z.infer<typeof planRequestSchema>) {
  const [plan, cur, open] = await Promise.all([
    prisma.subscriptionPlan.findUnique({ where: { id: input.planId }, select: { id: true, isActive: true, name: true } }),
    currentPlan(orgId),
    prisma.planUpgradeRequest.findFirst({ where: { organizationId: orgId, status: 'PENDING' }, select: { id: true } }),
  ]);
  if (!plan || !plan.isActive) throw notFound('Plan not found');
  if (cur.plan.id === plan.id) throw conflict('You are already on that plan');
  if (open) throw conflict('You already have a request waiting for the administrator. Cancel it first to ask for a different plan.');
  return prisma.planUpgradeRequest.create({ data: { organizationId: orgId, planId: plan.id, requestedById: userId, note: input.note ?? null }, select: requestView });
}

export async function cancelPlanRequest(orgId: string, id: string) {
  const { count } = await prisma.planUpgradeRequest.updateMany({ where: { id, organizationId: orgId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date() } });
  if (!count) throw notFound('No waiting request found');
}

export async function adminPlanRequests(status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED') {
  const rows = await prisma.planUpgradeRequest.findMany({
    where: { status }, orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' }, take: 100,
    select: { ...requestView, organization: { select: { id: true, name: true, type: true } } },
  });
  const items = await Promise.all(rows.map(async (r) => ({ ...r, currentPlan: (await currentPlan(r.organization.id)).plan.name })));
  return { items };
}

/** Approve: put the organization on the requested plan (the administrator has agreed the payment outside the system), then tell the employer. */
export async function approvePlanRequest(adminId: string, id: string, input: z.infer<typeof planDecisionSchema>) {
  const req = await prisma.planUpgradeRequest.findUnique({ where: { id }, select: { id: true, status: true, organizationId: true, planId: true, requestedById: true, plan: { select: { name: true } } } });
  if (!req) throw notFound('Request not found');
  if (req.status !== 'PENDING') throw conflict('This request has already been decided');
  await assignPlan(adminId, req.organizationId, { planId: req.planId, endsAt: input.endsAt ?? null, paymentNote: input.paymentNote ?? null });
  await prisma.planUpgradeRequest.update({ where: { id }, data: { status: 'APPROVED', decidedById: adminId, decidedAt: new Date(), decisionNote: input.decisionNote ?? null } });
  await notify(req.requestedById, 'plan.request_decided', { planName: req.plan.name, approved: true, note: input.decisionNote ?? null });
  return { planName: req.plan.name, organizationId: req.organizationId };
}

export async function declinePlanRequest(adminId: string, id: string, input: z.infer<typeof planDecisionSchema>) {
  const req = await prisma.planUpgradeRequest.findUnique({ where: { id }, select: { id: true, status: true, organizationId: true, requestedById: true, plan: { select: { name: true } } } });
  if (!req) throw notFound('Request not found');
  if (req.status !== 'PENDING') throw conflict('This request has already been decided');
  await prisma.planUpgradeRequest.update({ where: { id }, data: { status: 'DECLINED', decidedById: adminId, decidedAt: new Date(), decisionNote: input.decisionNote ?? null } });
  await notify(req.requestedById, 'plan.request_decided', { planName: req.plan.name, approved: false, note: input.decisionNote ?? null });
  return { planName: req.plan.name, organizationId: req.organizationId };
}
