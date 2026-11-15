import { assertCanInvite, assertCanSearchWorkers } from '../subscriptions/service';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound, tooMany } from '../../lib/errors';
import { audit } from '../../lib/audit';
import type { Request } from 'express';
import { evaluateCriterion, type JobCriterionFeature } from '../matching/criteria';
import { publicMatch, scoreOne, scoreWorkersForJob } from '../matching/service';
import { EDUCATION_RANK } from '../matching/types';
import { detectDiscrimination, discriminationMessage } from '../criteria/discrimination';
import { normalizeRequirement, optionsOf } from '../criteria/validate';
import { ownedJob } from '../jobs/service';
import { notify } from '../notifications/service';

// ───────── search ─────────

/** How many candidates are pulled from the database before the in-memory steps (sector filters, ranking by a job). */
export const SEARCH_POOL = 400;

const availabilitySets: Record<string, string[]> = {
  immediate: ['IMMEDIATELY'],
  two_weeks: ['IMMEDIATELY', 'FLEXIBLE', 'WITHIN_TWO_WEEKS'],
  month: ['IMMEDIATELY', 'FLEXIBLE', 'WITHIN_TWO_WEEKS', 'WITHIN_ONE_MONTH'],
};

const csvUuids = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid()).max(10));

export const searchSchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    categoryId: z.string().uuid().optional(),
    skills: csvUuids.optional(),
    skillsMode: z.enum(['all', 'any']).default('all'),
    locationId: z.string().uuid().optional(),
    minYears: z.coerce.number().int().min(0).max(60).optional(),
    availableWithin: z.enum(['immediate', 'two_weeks', 'month']).optional(),
    minEducation: z.enum(['PRIMARY', 'SECONDARY', 'VOCATIONAL_CERTIFICATE', 'DIPLOMA', 'BACHELOR', 'MASTER', 'DOCTORATE']).optional(),
    verified: z.enum(['true', 'false']).optional(),
    /** JSON array of {criterionId, value}: keep only workers whose own answer satisfies each one. */
    criteria: z.string().max(2000).optional(),
    /** One of the employer's own jobs: rank by match to it and leave out people who do not meet a must-have. */
    jobId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(100).default(1),
    pageSize: z.coerce.number().int().min(1).max(24).default(12),
  })
  .strict();
export type SearchInput = z.infer<typeof searchSchema>;

async function parseCriteriaFilter(raw: string | undefined): Promise<JobCriterionFeature[]> {
  if (!raw) return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { throw badRequest('Invalid sector filter', { criteria: ['The sector filter could not be read'] }); }
  const parsed = z.array(z.object({ criterionId: z.string().uuid(), value: z.union([z.boolean(), z.number(), z.string().max(80), z.array(z.string().max(80)).max(30)]) }).strict()).max(8).safeParse(list);
  if (!parsed.success) throw badRequest('Invalid sector filter', { criteria: ['Use at most 8 filters, each with a criterionId and a value'] });
  const defs = new Map((await prisma.criterionDefinition.findMany({ where: { id: { in: parsed.data.map((c) => c.criterionId) }, isActive: true } })).map((d) => [d.id, d]));
  return parsed.data.map((c) => {
    const d = defs.get(c.criterionId);
    if (!d) throw badRequest('Unknown sector filter', { criteria: ['One of the sector filters does not exist or is hidden'] });
    const r = normalizeRequirement(d, 'PREFERRED', c.value);
    if (!r.ok) throw badRequest('Invalid sector filter', { criteria: [`${d.labelEn}: ${r.message}`] });
    return { id: d.id, key: d.key, label: d.labelEn, type: d.type, importance: 'PREFERRED' as const, requirement: r.value, optionLabels: Object.fromEntries(optionsOf(d).map((o) => [o.value, o.labelEn])) };
  });
}

function whereFor(input: SearchInput): Prisma.WorkerProfileWhereInput {
  const and: Prisma.WorkerProfileWhereInput[] = [{ isVisible: true }, { user: { status: 'ACTIVE' } }];
  if (input.q) {
    const q = input.q;
    and.push({
      OR: [
        { headline: { contains: q, mode: 'insensitive' } },
        { occupation: { contains: q, mode: 'insensitive' } },
        { bio: { contains: q, mode: 'insensitive' } },
        { skills: { some: { skill: { OR: [{ nameEn: { contains: q, mode: 'insensitive' } }, { aliases: { has: q.toLowerCase() } }] } } } },
      ],
    });
  }
  if (input.categoryId) and.push({ categoryId: input.categoryId });
  if (input.skills?.length) {
    if (input.skillsMode === 'any') and.push({ skills: { some: { skillId: { in: input.skills } } } });
    else for (const skillId of input.skills) and.push({ skills: { some: { skillId } } });
  }
  if (input.locationId) {
    // The chosen place or anything inside it (region > zone > woreda > kebele).
    and.push({ OR: [{ locationId: input.locationId }, { location: { parentId: input.locationId } }, { location: { parent: { parentId: input.locationId } } }, { location: { parent: { parent: { parentId: input.locationId } } } }] });
  }
  if (input.minYears) and.push({ yearsExperience: { gte: input.minYears } });
  if (input.availableWithin) and.push({ availability: { in: availabilitySets[input.availableWithin] as ('IMMEDIATELY')[] } });
  if (input.minEducation) {
    const need = EDUCATION_RANK[input.minEducation];
    and.push({ education: { some: { level: { in: Object.entries(EDUCATION_RANK).filter(([, r]) => r >= need).map(([l]) => l) as ('DIPLOMA')[] } } } });
  }
  if (input.verified === 'true') {
    and.push({ OR: [{ skills: { some: { source: 'VERIFIED' } } }, { education: { some: { source: 'VERIFIED' } } }, { certifications: { some: { source: 'VERIFIED' } } }, { criteria: { some: { source: 'VERIFIED' } } }] });
  }
  return { AND: and };
}

const searchSelect = {
  id: true, headline: true, occupation: true, yearsExperience: true, photoFileId: true, availability: true, completionPct: true,
  user: { select: { fullName: true } },
  location: { select: { nameEn: true, parent: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
  skills: { select: { source: true, skill: { select: { nameEn: true } } } },
  education: { select: { source: true } },
  certifications: { select: { source: true } },
  criteria: { select: { criterionId: true, value: true, source: true } },
} satisfies Prisma.WorkerProfileSelect;

/**
 * Employer search for workers. Same privacy as the recommendations: only visible workers of active accounts, name and
 * headline, administrative area only, never contact details or exact position. Without a job it is a plain filtered
 * list (most complete profiles first); with one of the employer's jobs it is ranked by match to that job.
 */
export async function searchWorkers(orgId: string, input: SearchInput) {
  await assertCanSearchWorkers(orgId);
  const criteriaFilter = await parseCriteriaFilter(input.criteria);
  const job = input.jobId ? await ownedJob(orgId, input.jobId) : null;

  const pool = await prisma.workerProfile.findMany({
    where: whereFor(input),
    orderBy: [{ completionPct: 'desc' }, { updatedAt: 'desc' }],
    take: SEARCH_POOL,
    select: searchSelect,
  });
  let rows = pool;
  if (criteriaFilter.length) {
    rows = rows.filter((w) => {
      const have = Object.fromEntries(w.criteria.map((c) => [c.criterionId, { value: c.value, verified: c.source === 'VERIFIED' }]));
      return criteriaFilter.every((c) => evaluateCriterion(c, have[c.id]).state === 'met');
    });
  }

  let matches = new Map<string, ReturnType<typeof publicMatch>>();
  if (job) {
    const scored = await scoreWorkersForJob(job.id, rows.map((r) => r.id));
    rows = rows.filter((r) => scored.get(r.id)?.eligibility !== 'not_eligible');
    rows.sort((a, b) => (scored.get(b.id)?.score ?? 0) - (scored.get(a.id)?.score ?? 0));
    matches = new Map(rows.map((r) => [r.id, publicMatch(scored.get(r.id)!)]));
  }

  const total = rows.length;
  const pageRows = rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);

  const [invites, applied] = job && pageRows.length
    ? await Promise.all([
        prisma.jobInvitation.findMany({ where: { jobId: job.id, workerId: { in: pageRows.map((r) => r.id) } }, select: { workerId: true, status: true } }),
        prisma.application.findMany({ where: { jobId: job.id, workerId: { in: pageRows.map((r) => r.id) }, status: { not: 'WITHDRAWN' } }, select: { workerId: true } }),
      ])
    : [[], []];
  const inviteBy = new Map(invites.map((i) => [i.workerId, i.status]));
  const appliedSet = new Set(applied.map((a) => a.workerId));

  return {
    job: job ? { id: job.id, title: job.title } : null,
    total, page: input.page, pageSize: input.pageSize,
    // true when more people matched in the database than were examined: narrow the filters to see the rest
    capped: pool.length >= SEARCH_POOL,
    items: pageRows.map((w) => {
      const names: string[] = [];
      for (let cur: any = w.location; cur; cur = cur.parent) names.unshift(cur.nameEn);
      return {
        workerId: w.id, name: w.user.fullName, headline: w.headline, occupation: w.occupation, yearsExperience: w.yearsExperience,
        photoUrl: w.photoFileId ? `/api/v1/files/${w.photoFileId}` : null, location: names.slice(0, 3).join(', ') || null,
        availability: w.availability, completionPct: w.completionPct,
        skills: w.skills.slice(0, 5).map((s) => s.skill.nameEn),
        verified: {
          skills: w.skills.filter((s) => s.source === 'VERIFIED').length,
          qualifications: w.education.filter((s) => s.source === 'VERIFIED').length + w.certifications.filter((s) => s.source === 'VERIFIED').length,
          answers: w.criteria.filter((c) => c.source === 'VERIFIED').length,
        },
        ...(job ? { match: matches.get(w.id) ?? null, invitation: inviteBy.get(w.id) ?? null, applied: appliedSet.has(w.id) } : {}),
      };
    }),
  };
}

// ───────── invitations ─────────

export const INVITES_PER_DAY = 20;
export const inviteSchema = z.object({ workerId: z.string().uuid(), message: z.string().trim().max(300).optional() }).strict();

/** An employer invites a worker to apply to one of their open jobs. Nothing about the worker is revealed by this. */
export async function inviteWorker(req: Request, userId: string, orgId: string, jobId: string, input: z.infer<typeof inviteSchema>) {
  await assertCanInvite(orgId);
  const job = await ownedJob(orgId, jobId);
  if (job.status !== 'ACTIVE' || (job.deadline && job.deadline.getTime() < Date.now())) throw conflict('You can only invite people to jobs that are open for applications');

  const worker = await prisma.workerProfile.findFirst({ where: { id: input.workerId, isVisible: true, user: { status: 'ACTIVE' } }, select: { id: true, userId: true } });
  if (!worker) throw notFound('Worker not found');
  if (await prisma.application.findFirst({ where: { jobId, workerId: worker.id, status: { not: 'WITHDRAWN' } }, select: { id: true } })) throw conflict('This person has already applied');

  const prior = await prisma.jobInvitation.findUnique({ where: { jobId_workerId: { jobId, workerId: worker.id } } });
  if (prior) throw conflict(prior.status === 'DECLINED' ? 'This person declined the invitation for this job' : 'This person has already been invited to this job');

  const sentToday = await prisma.jobInvitation.count({ where: { invitedById: userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (sentToday >= INVITES_PER_DAY) throw tooMany(`Daily invitation limit (${INVITES_PER_DAY}) reached. Try again tomorrow.`);

  const { result } = await scoreOne(jobId, worker.id);
  if (result.eligibility === 'not_eligible') throw conflict('This person does not meet a required condition for the job');

  const findings = detectDiscrimination(input.message);
  if (findings.length) throw badRequest('The message contains a requirement that is not allowed', { message: [discriminationMessage(findings)] });

  const invitation = await prisma.jobInvitation.create({ data: { jobId, workerId: worker.id, invitedById: userId, message: input.message || null } });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
  await notify(worker.userId, 'job.invitation', { invitationId: invitation.id, jobId, jobTitle: job.title, organizationName: org.name });
  await audit(req, userId, 'job.invitation_sent', 'JobInvitation', invitation.id, { jobId });
  return invitation.id;
}

export const BULK_INVITE_MAX = 20;
export const bulkInviteSchema = z.object({
  workerIds: z.array(z.string().uuid()).min(1, 'Choose at least one person').max(BULK_INVITE_MAX, `Invite at most ${BULK_INVITE_MAX} people at once`),
  message: z.string().trim().max(300).optional(),
}).strict();

/**
 * Invite several workers to one job in one go. Every person goes through exactly the same checks as a single
 * invitation (open job, visible profile, not already applied or invited, required conditions, daily and plan limits,
 * no discriminatory wording), and one person failing never blocks the others. When a limit that applies to the
 * whole employer is hit, the rest are reported as not sent instead of being tried.
 */
export async function inviteMany(req: Request, userId: string, orgId: string, jobId: string, input: z.infer<typeof bulkInviteSchema>) {
  const ids = [...new Set(input.workerIds)];
  const results: { workerId: string; sent: boolean; reason?: string }[] = [];
  let stopReason: string | null = null;
  for (const workerId of ids) {
    if (stopReason) {
      results.push({ workerId, sent: false, reason: stopReason });
      continue;
    }
    try {
      await inviteWorker(req, userId, orgId, jobId, { workerId, message: input.message });
      results.push({ workerId, sent: true });
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string; details?: unknown };
      const reason = (e.code !== 'PLAN_LIMIT' && e.details && Object.values(e.details as Record<string, string[]>).flat()[0]) || e.message || 'Could not invite this person';
      if (e.code === 'RATE_LIMITED' || e.code === 'PLAN_LIMIT') stopReason = String(reason);
      else if (e.status === undefined) throw err; // not one of ours: do not hide a real fault
      results.push({ workerId, sent: false, reason: String(reason) });
    }
  }
  return { sent: results.filter((r) => r.sent).length, failed: results.filter((r) => !r.sent).length, results };
}

export async function listJobInvitations(orgId: string, jobId: string) {
  await ownedJob(orgId, jobId);
  const rows = await prisma.jobInvitation.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' }, include: { conversation: { select: { id: true, applicationId: true } }, worker: { select: { id: true, headline: true, user: { select: { fullName: true } } } } } });
  return rows.map((r) => ({ id: r.id, conversationId: r.conversation?.id ?? null, status: r.status, message: r.message, createdAt: r.createdAt, respondedAt: r.respondedAt, worker: { id: r.worker.id, name: r.worker.user.fullName, headline: r.worker.headline } }));
}

/** The worker's invitations: open ones first, then history. The employer's identity is the organization, not a person. */
export async function myInvitations(workerId: string) {
  const rows = await prisma.jobInvitation.findMany({
    where: { workerId, job: { status: { not: 'REMOVED' } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 50,
    include: { conversation: { select: { id: true } }, job: { select: { id: true, title: true, status: true, deadline: true, organization: { select: { name: true, verificationStatus: true } }, location: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } } },
  });
  return rows.map((r) => ({
    id: r.id, conversationId: r.conversation?.id ?? null, status: r.status, message: r.message, createdAt: r.createdAt,
    job: {
      id: r.job.id, title: r.job.title, open: r.job.status === 'ACTIVE' && (!r.job.deadline || r.job.deadline.getTime() >= Date.now()),
      organization: r.job.organization.name, verified: r.job.organization.verificationStatus === 'VERIFIED',
      location: [r.job.location?.parent?.nameEn, r.job.location?.nameEn].filter(Boolean).join(', ') || null,
    },
  }));
}

export async function declineInvitation(workerId: string, invitationId: string) {
  const inv = await prisma.jobInvitation.findFirst({ where: { id: invitationId, workerId } });
  if (!inv) throw notFound('Invitation not found');
  if (inv.status !== 'SENT') throw conflict('This invitation was already answered');
  await prisma.jobInvitation.update({ where: { id: inv.id }, data: { status: 'DECLINED', respondedAt: new Date() } });
}

/** Called when a worker applies: an open invitation for that job becomes "applied". */
export async function markInvitationApplied(jobId: string, workerId: string) {
  await prisma.jobInvitation.updateMany({ where: { jobId, workerId, status: 'SENT' }, data: { status: 'APPLIED', respondedAt: new Date() } });
}
