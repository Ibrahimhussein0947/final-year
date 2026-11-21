import { assertWorkerDocuments } from '../documents/status';
import { assertCvAgreesWithProfile } from '../verification/service';
import { assertDecisionAllowed, getPolicy, rulesView } from '../hiring/service';
import { assertRequiredSteps } from '../hiring/steps';
import { appealState } from '../hiring/appeals';
import { markInvitationApplied } from '../talent/service';
import type { ApplicationStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, badRequest, conflict, notFound, tooMany } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { notify } from '../notifications/service';
import { briefMatch, publicMatch, recommendJobs, recordFeedback, scoreOne, scoreWorkersForJob } from '../matching/service';
import { getPublicProfile, workerIdFor } from '../workers/service';
import { orgIdFor } from '../jobs/service';
import { findClashes, makeVideoRoom } from './interviews';
import { assertCanReview } from '../subscriptions/service';
import { rejectionTips, type ProfileState } from './tips';
import { canReviewEmployer } from '../reviews/service';
import { trustOf } from '../workers/trust';
import { CONTACT_VISIBLE, INTERVIEWABLE, WORKER_CAN_WITHDRAW, EMPLOYER_TRANSITIONS, canEmployerMove } from './transitions';

const DAILY_APPLICATION_LIMIT = 30;

/** "Qualified": no must-have requirement is missed and the overall match is at least moderate. A label for tracking, not a decision. */
export const QUALIFIED_MIN_SCORE = 60;
export const isQualified = (m: { score?: number; eligibility?: string } | null | undefined) =>
  !!m && typeof m.score === 'number' && m.score >= QUALIFIED_MIN_SCORE && m.eligibility !== 'not_eligible';

/** Plain-language reasons a person did not fit, taken from the same calculation as the score. Never from private data. */
export function mismatchReasons(m: { missingSkills: string[]; criteria: { unmet: { label: string; mustHave: boolean }[] }; requiredCoverage: { required: number; covered: number } }): string[] {
  const out: string[] = [];
  if (m.missingSkills.length) out.push(`Required skills not on your profile: ${m.missingSkills.slice(0, 5).join(', ')}`);
  for (const u of m.criteria.unmet.filter((c) => c.mustHave).slice(0, 5)) out.push(`Requirement not met: ${u.label}`);
  return out;
}

const jobBrief = {
  select: {
    id: true, title: true, status: true, deadline: true, vacancies: true, organizationId: true, workMode: true,
    organization: { select: { id: true, name: true, verificationStatus: true, type: true } },
    location: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
  },
} as const;

const place = (loc: { nameEn: string; parent: { nameEn: string } | null } | null) =>
  loc ? (loc.parent ? `${loc.nameEn}, ${loc.parent.nameEn}` : loc.nameEn) : null;

const interviewOut = (i: { id: string; scheduledAt: Date; mode: string; locationOrLink: string | null; status: string }) => ({
  id: i.id, scheduledAt: i.scheduledAt, mode: i.mode, locationOrLink: i.locationOrLink, status: i.status,
});

// ───────── Worker actions ─────────

export async function apply(userId: string, jobId: string, coverNote: string | null, opts: { auto?: boolean } = {}) {
  const workerId = await workerIdFor(userId);
  // The documents every worker has to send before applying (an ID document and a profile photo).
  await assertWorkerDocuments(workerId);
  // A CV that contradicts the profile (someone else's name, inflated education or experience) is declined here, with reasons.
  const cvCheck = await assertCvAgreesWithProfile(workerId);
  const job = await prisma.job.findFirst({
    where: { id: jobId, status: 'ACTIVE', OR: [{ deadline: null }, { deadline: { gte: new Date() } }] },
    select: { id: true, title: true, postedById: true, organizationId: true },
  });
  if (!job) throw notFound('This job is not open for applications');

  const recent = await prisma.application.count({ where: { workerId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (recent >= DAILY_APPLICATION_LIMIT) throw tooMany('Daily application limit reached. Try again tomorrow.');

  const existing = await prisma.application.findUnique({ where: { jobId_workerId: { jobId, workerId } } });
  if (existing && existing.status !== 'WITHDRAWN') throw conflict('You have already applied to this job');

  const id = await prisma.$transaction(async (tx) => {
    // Re-applying after withdrawing reuses the same row so the history stays in one place.
    const app = existing
      ? await tx.application.update({ where: { id: existing.id }, data: { status: 'PENDING', coverNote, autoApplied: !!opts.auto } })
      : await tx.application.create({ data: { jobId, workerId, coverNote, autoApplied: !!opts.auto } });
    await tx.applicationStatusHistory.create({
      data: { applicationId: app.id, fromStatus: existing ? 'WITHDRAWN' : null, toStatus: 'PENDING', byUserId: userId },
    });
    return app.id;
  });

  // Remember how well the worker matched at the moment of applying (kept for later evaluation).
  try {
    const { result, weightsVersion } = await scoreOne(jobId, workerId);
    await prisma.application.update({ where: { id }, data: { matchSnapshot: { ...publicMatch(result), weightsVersion } as unknown as Prisma.InputJsonValue } });
  } catch (err) {
    logger.error({ err, applicationId: id }, 'could not store match snapshot');
  }

  await recordFeedback(jobId, workerId, 'APPLIED');
  await markInvitationApplied(jobId, workerId);

  // Recipient: the person who posted the job.
  await notify(job.postedById, 'application.received', { applicationId: id, jobId, jobTitle: job.title, autoApplied: !!opts.auto, ...(cvCheck ? { cvCheck: cvCheck.outcome, cvWarnings: cvCheck.findings.filter((f) => f.severity === 'warn').length } : {}) });
  return id;
}

export async function withdraw(userId: string, applicationId: string) {
  const workerId = await workerIdFor(userId);
  const app = await prisma.application.findFirst({ where: { id: applicationId, workerId }, include: { job: { select: { title: true, postedById: true, id: true } } } });
  if (!app) throw notFound('Application not found');
  if (!WORKER_CAN_WITHDRAW.includes(app.status)) throw conflict(`An application that is ${app.status.toLowerCase().replace('_', ' ')} cannot be withdrawn`);

  await prisma.$transaction([
    prisma.application.update({ where: { id: app.id }, data: { status: 'WITHDRAWN' } }),
    prisma.interview.updateMany({ where: { applicationId: app.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } }),
    prisma.applicationStatusHistory.create({ data: { applicationId: app.id, fromStatus: app.status, toStatus: 'WITHDRAWN', byUserId: userId } }),
  ]);
  await notify(app.job.postedById, 'application.withdrawn', { applicationId: app.id, jobId: app.job.id, jobTitle: app.job.title });
}

export async function myApplications(userId: string) {
  const workerId = await workerIdFor(userId);
  const profileState = async (): Promise<ProfileState> => {
    const [w, t] = await Promise.all([
      prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, select: { cvFileId: true, photoFileId: true, _count: { select: { skills: true } } } }),
      trustOf(workerId),
    ]);
    return { hasCv: !!w.cvFileId, hasPhoto: !!w.photoFileId, identityVerified: t.proven.identity, hasCertificates: t.proven.credentials, skillCount: w._count.skills };
  };
  const rows = await prisma.application.findMany({
    where: { workerId },
    orderBy: { updatedAt: 'desc' },
    include: { job: jobBrief, interviews: { orderBy: { scheduledAt: 'asc' } }, history: { orderBy: { createdAt: 'asc' } }, review: { select: { rating: true } }, appeal: true, steps: { select: { kind: true } } },
  });
  const state = rows.some((a) => a.status === 'REJECTED' && a.matchSnapshot) ? await profileState() : null;
  return Promise.all(rows.map(async (a) => ({
    id: a.id,
    status: a.status,
    qualified: isQualified(a.matchSnapshot as { score?: number; eligibility?: string } | null),
    autoApplied: a.autoApplied,
    // Why the match fell short, from the match stored when the person applied (only shown once not selected).
    notSelectedReasons: a.status === 'REJECTED' && a.matchSnapshot ? mismatchReasons(a.matchSnapshot as Parameters<typeof mismatchReasons>[0]) : [],
    notSelectedTips: a.status === 'REJECTED' && state ? rejectionTips(a.matchSnapshot as Parameters<typeof rejectionTips>[0], state) : [],
    review: a.review ? { rating: a.review.rating } : null,
    // What the employer did to select people, in plain kinds (never the scores or notes), so the process is not a black box.
    selectionSteps: [...new Set(a.steps.map((s) => s.kind))],
    appeal: await appealState({ id: a.id, status: a.status, orgType: a.job.organization.type }, a.appeal),
    canReview: !a.review && canReviewEmployer(a.status, a.interviews.length),
    coverNote: a.coverNote,
    appliedAt: a.createdAt,
    updatedAt: a.updatedAt,
    job: { id: a.job.id, title: a.job.title, status: a.job.status, organization: a.job.organization.name, verified: a.job.organization.verificationStatus === 'VERIFIED', location: place(a.job.location), deadline: a.job.deadline },
    interviews: a.interviews.map(interviewOut),
    history: a.history.map((h) => ({ from: h.fromStatus, to: h.toStatus, note: h.note, at: h.createdAt })),
    canWithdraw: WORKER_CAN_WITHDRAW.includes(a.status),
  })));
}

export async function saveJob(userId: string, jobId: string) {
  const workerId = await workerIdFor(userId);
  const job = await prisma.job.findFirst({ where: { id: jobId, status: 'ACTIVE' }, select: { id: true } });
  if (!job) throw notFound('Job not found');
  await prisma.savedJob.upsert({ where: { workerId_jobId: { workerId, jobId } }, update: {}, create: { workerId, jobId } });
}

export async function unsaveJob(userId: string, jobId: string) {
  const workerId = await workerIdFor(userId);
  await prisma.savedJob.deleteMany({ where: { workerId, jobId } });
}

export async function savedJobs(userId: string) {
  const workerId = await workerIdFor(userId);
  const rows = await prisma.savedJob.findMany({
    where: { workerId },
    orderBy: { createdAt: 'desc' },
    include: { job: { select: { ...jobBrief.select, employmentType: true, salaryMin: true, salaryMax: true, currency: true } } },
  });
  return rows.map((r) => ({
    savedAt: r.createdAt,
    job: {
      id: r.job.id, title: r.job.title, organization: r.job.organization.name, location: place(r.job.location),
      employmentType: r.job.employmentType, salaryMin: r.job.salaryMin, salaryMax: r.job.salaryMax, currency: r.job.currency,
      deadline: r.job.deadline,
      // Saved jobs can close later; say so instead of silently hiding them.
      open: r.job.status === 'ACTIVE' && (!r.job.deadline || r.job.deadline > new Date()),
    },
  }));
}

/** What a signed-in worker needs on a job page: have I applied, have I saved it. */
export async function viewerState(userId: string, jobId: string) {
  const worker = await prisma.workerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!worker) return null;
  const [app, saved] = await Promise.all([
    prisma.application.findUnique({ where: { jobId_workerId: { jobId, workerId: worker.id } }, select: { id: true, status: true } }),
    prisma.savedJob.findUnique({ where: { workerId_jobId: { workerId: worker.id, jobId } }, select: { workerId: true } }),
  ]);
  return { application: app, saved: !!saved };
}

// ───────── Employer actions ─────────

/** The application, only if it belongs to a job of the employer's organization. */
async function ownedApplication(userId: string, applicationId: string) {
  const orgId = await orgIdFor(userId);
  const app = await prisma.application.findFirst({
    where: { id: applicationId, job: { organizationId: orgId } },
    include: { job: { select: { id: true, title: true, vacancies: true, deadline: true, organization: { select: { type: true } } } }, worker: { select: { id: true, userId: true } } },
  });
  if (!app) throw notFound('Application not found');
  return app;
}

const STATUS_FILTER = ['PENDING', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const;

export async function jobApplications(userId: string, jobId: string, status?: string, sort: 'newest' | 'match' = 'newest') {
  const orgId = await orgIdFor(userId);
  const jobRow = await prisma.job.findFirst({ where: { id: jobId, organizationId: orgId, status: { not: 'REMOVED' } }, select: { id: true, title: true, vacancies: true, status: true, deadline: true, organization: { select: { type: true } } } });
  if (!jobRow) throw notFound('Job not found');
  const job = { id: jobRow.id, title: jobRow.title, vacancies: jobRow.vacancies, status: jobRow.status };
  const rules = rulesView(await getPolicy(jobRow.organization.type), jobRow);
  if (status && !STATUS_FILTER.includes(status as (typeof STATUS_FILTER)[number])) throw badRequest('Unknown status filter');

  const rows = await prisma.application.findMany({
    where: { jobId, ...(status ? { status: status as ApplicationStatus } : {}) },
    orderBy: { createdAt: 'desc' },
    include: {
      worker: {
        select: {
          id: true, headline: true, occupation: true, yearsExperience: true, photoFileId: true,
          user: { select: { fullName: true, phone: true } },
          location: { select: { nameEn: true, parent: { select: { nameEn: true } } } },
          skills: { select: { skill: { select: { nameEn: true } } }, take: 6 },
        },
      },
      interviews: { where: { status: 'SCHEDULED' }, orderBy: { scheduledAt: 'asc' } },
    },
  });
  const counts = await prisma.application.groupBy({ by: ['status'], where: { jobId }, _count: true });
  // Current match (not the snapshot): profiles may have improved since the person applied.
  const scores = await scoreWorkersForJob(jobId, rows.map((a) => a.worker.id));
  const items = rows.map((a) => ({
      id: a.id,
      status: a.status,
      appliedAt: a.createdAt,
      coverNote: a.coverNote,
      allowedNext: EMPLOYER_TRANSITIONS[a.status],
      match: scores.has(a.worker.id) ? briefMatch(scores.get(a.worker.id)!) : null,
      qualified: isQualified(scores.has(a.worker.id) ? briefMatch(scores.get(a.worker.id)!) : null),
      autoApplied: a.autoApplied,
      candidate: {
        workerId: a.worker.id,
        name: a.worker.user.fullName,
        headline: a.worker.headline,
        occupation: a.worker.occupation,
        yearsExperience: a.worker.yearsExperience,
        location: place(a.worker.location),
        skills: a.worker.skills.map((s) => s.skill.nameEn),
        photoUrl: a.worker.photoFileId ? `/api/v1/files/${a.worker.photoFileId}` : null,
        // Phone numbers stay hidden until the candidate is shortlisted.
        phone: CONTACT_VISIBLE.includes(a.status) ? a.worker.user.phone : null,
      },
      interviews: a.interviews.map(interviewOut),
  }));
  if (sort === 'match') items.sort((x, y) => (y.match?.score ?? -1) - (x.match?.score ?? -1));
  return { job, rules, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])), items };
}

export async function candidateView(userId: string, applicationId: string) {
  const app = await ownedApplication(userId, applicationId);
  const profile = await getPublicProfile(app.worker.id, userId, { viaApplication: true, showPhone: CONTACT_VISIBLE.includes(app.status) });
  const [history, interviews, jobSkills, worker] = await Promise.all([
    prisma.applicationStatusHistory.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } }),
    prisma.interview.findMany({ where: { applicationId }, orderBy: { scheduledAt: 'asc' } }),
    prisma.jobSkill.findMany({ where: { jobId: app.job.id }, include: { skill: { select: { nameEn: true } } } }),
    prisma.workerProfile.findUnique({ where: { id: app.worker.id }, select: { cvFileId: true } }),
  ]);
  const have = new Set(profile.skills.map((s) => s.skillId));
  const match = (await scoreWorkersForJob(app.job.id, [app.worker.id])).get(app.worker.id);
  return {
    application: {
      id: app.id, status: app.status, coverNote: app.coverNote, appliedAt: app.createdAt, allowedNext: EMPLOYER_TRANSITIONS[app.status],
      canSchedule: INTERVIEWABLE.includes(app.status), job: app.job,
    },
    match: match ? publicMatch(match) : null,
    rules: rulesView(await getPolicy(app.job.organization.type), app.job),
    // The CV is shared with the employer only because the worker applied; withdrawn applications lose access.
    cvUrl: app.status !== 'WITHDRAWN' && worker?.cvFileId ? `/api/v1/files/${worker.cvFileId}` : null,
    profile,
    // Plain overlap with the job's skill list (the weighted score above also credits related skills).
    skillOverlap: jobSkills.map((j) => ({ name: j.skill.nameEn, importance: j.importance, has: have.has(j.skillId) })),
    history: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, note: h.note, at: h.createdAt })),
    interviews: interviews.map(interviewOut),
  };
}

export async function changeStatus(userId: string, applicationId: string, to: ApplicationStatus, note: string | null) {
  const app = await ownedApplication(userId, applicationId);
  if (!canEmployerMove(app.status, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot move an application from ${app.status} to ${to}`, { allowed: EMPLOYER_TRANSITIONS[app.status] as string[] });
  }
  // The first decision on an application counts against the plan's monthly review allowance.
  if (app.status === 'PENDING') await assertCanReview(await orgIdFor(userId));
  // Hiring rules of the organization type: a written reason, a closed announcement, a recorded interview.
  if (to === 'ACCEPTED' || to === 'REJECTED') await assertDecisionAllowed({ applicationId: app.id, orgType: app.job.organization.type, job: app.job, to, note });
  // The recruitment methods of this kind of organization (written exam, selection panel, references...) must have been recorded.
  if (to === 'ACCEPTED') await assertRequiredSteps(await getPolicy(app.job.organization.type), app.id, app.worker.id);
  await prisma.$transaction([
    prisma.application.update({ where: { id: app.id }, data: { status: to } }),
    prisma.applicationStatusHistory.create({ data: { applicationId: app.id, fromStatus: app.status, toStatus: to, byUserId: userId, note } }),
    ...(to === 'ACCEPTED' || to === 'REJECTED'
      ? [prisma.interview.updateMany({ where: { applicationId: app.id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } })]
      : []),
  ]);
  if (to === 'SHORTLISTED') await recordFeedback(app.job.id, app.worker.id, 'SHORTLISTED');
  if (to === 'ACCEPTED') await recordFeedback(app.job.id, app.worker.id, 'HIRED');
  let reasons: string[] = [];
  let otherMatches = 0;
  if (to === 'REJECTED') {
    // Automatic, informative part of the "not selected" message. The employer's own note (if any) is separate.
    try {
      reasons = mismatchReasons((await scoreOne(app.job.id, app.worker.id)).result);
      const others = await recommendJobs(app.worker.id, 10);
      otherMatches = others.items.filter((i) => i.result.score >= QUALIFIED_MIN_SCORE && i.result.eligibility !== 'not_eligible' && i.jobId !== app.job.id).length;
    } catch (err) {
      logger.warn({ err: String(err), applicationId: app.id }, 'rejection reasons not computed');
    }
  }
  await notify(app.worker.userId, 'application.status', { applicationId: app.id, jobId: app.job.id, jobTitle: app.job.title, status: to, note, ...(to === 'REJECTED' ? { reasons, otherMatches } : {}) });
  return to;
}

/** Work out the link and room for an interview: a made room, the employer's own link, or nothing. */
function resolveVideo(input: { mode: 'IN_PERSON' | 'PHONE' | 'VIDEO'; locationOrLink: string | null; createVideoRoom?: boolean }, existingRoom: string | null) {
  if (input.createVideoRoom && input.mode !== 'VIDEO') throw badRequest('A video room can only be made for a video call');
  if (input.mode === 'VIDEO' && input.createVideoRoom) {
    if (existingRoom && !input.locationOrLink) return { locationOrLink: null as string | null, videoRoom: existingRoom, keep: true };
    const made = makeVideoRoom();
    return { locationOrLink: made.url, videoRoom: made.room, keep: false };
  }
  return { locationOrLink: input.locationOrLink, videoRoom: null as string | null, keep: false };
}

export async function scheduleInterview(
  userId: string, applicationId: string, input: { scheduledAt: Date; mode: 'IN_PERSON' | 'PHONE' | 'VIDEO'; locationOrLink: string | null; createVideoRoom?: boolean },
) {
  const app = await ownedApplication(userId, applicationId);
  if (!INTERVIEWABLE.includes(app.status)) {
    throw conflict(app.status === 'PENDING' ? 'Review or shortlist the application before scheduling an interview' : `Cannot schedule an interview for an application that is ${app.status.toLowerCase().replace('_', ' ')}`);
  }
  const clashes = await findClashes({ at: input.scheduledAt, workerId: app.worker.id, organizationId: await orgIdFor(userId) });
  if (clashes.candidateBusy) throw conflict('This candidate is not available at that time. Choose a time at least an hour apart from their other interviews.');
  const video = resolveVideo(input, null);
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.interview.create({ data: { applicationId: app.id, scheduledAt: input.scheduledAt, mode: input.mode, locationOrLink: video.locationOrLink, videoRoom: video.videoRoom } }),
  ];
  if (app.status !== 'INTERVIEW_SCHEDULED') {
    ops.push(prisma.application.update({ where: { id: app.id }, data: { status: 'INTERVIEW_SCHEDULED' } }));
    ops.push(prisma.applicationStatusHistory.create({ data: { applicationId: app.id, fromStatus: app.status, toStatus: 'INTERVIEW_SCHEDULED', byUserId: userId } }));
  }
  await prisma.$transaction(ops);
  await notify(app.worker.userId, 'interview.scheduled', {
    applicationId: app.id, jobId: app.job.id, jobTitle: app.job.title, scheduledAt: input.scheduledAt.toISOString(), mode: input.mode,
  });
  return { warnings: clashes.ownWarnings };
}

/** Move an interview to a new time or place. Reminders start over, and the candidate is told. */
export async function rescheduleInterview(
  userId: string, applicationId: string, interviewId: string,
  input: { scheduledAt: Date; mode: 'IN_PERSON' | 'PHONE' | 'VIDEO'; locationOrLink: string | null; createVideoRoom?: boolean },
) {
  const app = await ownedApplication(userId, applicationId);
  const existing = await prisma.interview.findFirst({ where: { id: interviewId, applicationId, status: 'SCHEDULED' } });
  if (!existing) throw notFound('Interview not found');
  if (!INTERVIEWABLE.includes(app.status)) throw conflict('This application can no longer be changed');
  const clashes = await findClashes({ at: input.scheduledAt, workerId: app.worker.id, organizationId: await orgIdFor(userId), exceptInterviewId: interviewId });
  if (clashes.candidateBusy) throw conflict('This candidate is not available at that time. Choose a time at least an hour apart from their other interviews.');
  const video = resolveVideo(input, existing.videoRoom);
  await prisma.interview.update({
    where: { id: interviewId },
    data: { scheduledAt: input.scheduledAt, mode: input.mode, remindedDayAt: null, remindedHourAt: null, workerResponse: 'PENDING', respondedAt: null, declineNote: null, ...(video.keep ? {} : { locationOrLink: video.locationOrLink, videoRoom: video.videoRoom }) },
  });
  await notify(app.worker.userId, 'interview.scheduled', {
    applicationId: app.id, jobId: app.job.id, jobTitle: app.job.title, scheduledAt: input.scheduledAt.toISOString(), mode: input.mode, rescheduled: true,
  });
  return { warnings: clashes.ownWarnings };
}

export async function cancelInterview(userId: string, applicationId: string, interviewId: string) {
  const app = await ownedApplication(userId, applicationId);
  const { count } = await prisma.interview.updateMany({ where: { id: interviewId, applicationId, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
  if (!count) throw notFound('Interview not found');
  // Last scheduled interview cancelled: step back to shortlisted.
  const remaining = await prisma.interview.count({ where: { applicationId, status: 'SCHEDULED' } });
  if (remaining === 0 && app.status === 'INTERVIEW_SCHEDULED') {
    await prisma.$transaction([
      prisma.application.update({ where: { id: app.id }, data: { status: 'SHORTLISTED' } }),
      prisma.applicationStatusHistory.create({ data: { applicationId: app.id, fromStatus: 'INTERVIEW_SCHEDULED', toStatus: 'SHORTLISTED', byUserId: userId, note: 'Interview cancelled' } }),
    ]);
  }
  await notify(app.worker.userId, 'interview.cancelled', { applicationId: app.id, jobId: app.job.id, jobTitle: app.job.title });
}

/** Side-by-side view of up to 4 applicants to the same job. */
export async function compare(userId: string, ids: string[]) {
  const orgId = await orgIdFor(userId);
  const apps = await prisma.application.findMany({
    where: { id: { in: ids }, job: { organizationId: orgId } },
    include: { job: { select: { id: true, title: true } } },
  });
  if (apps.length !== ids.length) throw notFound('One or more applications were not found');
  if (new Set(apps.map((a) => a.jobId)).size > 1) throw badRequest('Only applicants to the same job can be compared');

  const jobId = apps[0].jobId;
  const jobSkills = await prisma.jobSkill.findMany({ where: { jobId }, include: { skill: { select: { nameEn: true } } } });
  const columns: { applicationId: string; status: ApplicationStatus; profile: Awaited<ReturnType<typeof getPublicProfile>>; requiredSkillsHeld: number; match: ReturnType<typeof briefMatch> | null }[] = [];
  const scores = await scoreWorkersForJob(jobId, apps.map((a) => a.workerId));
  for (const a of apps) {
    const profile = await getPublicProfile(a.workerId, userId, { viaApplication: true, showPhone: CONTACT_VISIBLE.includes(a.status) });
    const have = new Set(profile.skills.map((s) => s.skillId));
    columns.push({
      applicationId: a.id, status: a.status, profile,
      match: scores.has(a.workerId) ? briefMatch(scores.get(a.workerId)!) : null,
      requiredSkillsHeld: jobSkills.filter((j) => j.importance === 'REQUIRED' && have.has(j.skillId)).length,
    });
  }
  return {
    job: apps[0].job,
    requiredSkills: jobSkills.filter((j) => j.importance === 'REQUIRED').map((j) => j.skill.nameEn),
    columns: ids.map((id) => columns.find((c) => c.applicationId === id)!),
  };
}

export async function summary(userId: string, role: 'WORKER' | 'EMPLOYER') {
  if (role === 'WORKER') {
    const workerId = await workerIdFor(userId);
    const groups = await prisma.application.groupBy({ by: ['status'], where: { workerId }, _count: true });
    const [saved, upcoming] = await Promise.all([
      prisma.savedJob.count({ where: { workerId } }),
      prisma.interview.count({ where: { status: 'SCHEDULED', scheduledAt: { gte: new Date() }, application: { workerId } } }),
    ]);
    return { applications: Object.fromEntries(groups.map((g) => [g.status, g._count])), saved, upcomingInterviews: upcoming };
  }
  const orgId = await orgIdFor(userId);
  const groups = await prisma.application.groupBy({ by: ['status'], where: { job: { organizationId: orgId } }, _count: true });
  const [activeJobs, upcoming] = await Promise.all([
    prisma.job.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
    prisma.interview.count({ where: { status: 'SCHEDULED', scheduledAt: { gte: new Date() }, application: { job: { organizationId: orgId } } } }),
  ]);
  return { applications: Object.fromEntries(groups.map((g) => [g.status, g._count])), activeJobs, upcomingInterviews: upcoming };
}

/** Used by the file route: may this employer download this worker's CV? Only if the worker applied to one of their jobs. */
export async function employerMayReadCv(employerUserId: string, cvFileId: string) {
  const hit = await prisma.application.findFirst({
    where: {
      status: { not: 'WITHDRAWN' },
      worker: {
        OR: [
          { cvFileId },
          { education: { some: { evidenceFileId: cvFileId } } },
          { certifications: { some: { evidenceFileId: cvFileId } } },
          { activities: { some: { evidenceFileId: cvFileId } } },
          { experiences: { some: { evidenceFileId: cvFileId } } },
        ],
      },
      job: { organization: { employers: { some: { userId: employerUserId } } } },
    },
    select: { id: true },
  });
  return !!hit;
}
