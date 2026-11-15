import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { matchPair, recommendable } from './scorer';
import { cosine } from './components';
import { notify } from '../notifications/service';
import { logger } from '../../lib/logger';
import { getRelations, getWeights } from './weights';
import { type JobFeatures, type MatchResult, type WorkerFeatures } from './types';

/** Recommendations below this score are not worth showing. */
export { MIN_RECOMMENDED_SCORE } from './scorer';

/** Raw cosine above which an embedding neighbour is considered as a candidate even without shared skills. */
export const SEMANTIC_CANDIDATE_MIN = 0.45;
const SEMANTIC_CANDIDATES = 100;
const SEMANTIC_POOL = 3000;

const MAX_CANDIDATES = 400;

const locChain = { include: { parent: { include: { parent: { include: { parent: true } } } } } } as const;

/** Location ids from region down to the most specific known place. */
function pathIds(loc: unknown): string[] {
  const out: string[] = [];
  for (let cur = loc as any; cur; cur = cur.parent) out.unshift(cur.id);
  return out;
}

const jobSelect = {
  id: true, embedding: true, categoryId: true, employmentType: true, workMode: true, minExperienceYears: true, requiredEducationLevel: true,
  salaryMin: true, salaryMax: true, startDate: true, lat: true, lng: true,
  location: locChain,
  skills: { select: { skillId: true, importance: true, minProficiency: true, skill: { select: { nameEn: true } } } },
  criteria: { select: { criterionId: true, importance: true, value: true, criterion: { select: { key: true, labelEn: true, type: true, options: true, isActive: true } } } },
} satisfies Prisma.JobSelect;

const workerSelect = {
  id: true, embedding: true, categoryId: true, yearsExperience: true, availability: true, availableFrom: true, lat: true, lng: true,
  maxTravelKm: true, willingToRelocate: true, preferredTypes: true, preferredWorkModes: true,
  expectedSalaryMin: true, expectedSalaryMax: true,
  location: locChain,
  skills: { select: { skillId: true, proficiency: true, skill: { select: { nameEn: true } } } },
  experiences: { select: { categoryId: true, startDate: true, endDate: true } },
  education: { select: { level: true } },
  _count: { select: { certifications: true } },
  criteria: { select: { criterionId: true, value: true, source: true } },
} satisfies Prisma.WorkerProfileSelect;

type JobRow = Prisma.JobGetPayload<{ select: typeof jobSelect }>;
type WorkerRow = Prisma.WorkerProfileGetPayload<{ select: typeof workerSelect }>;

const toJob = (j: JobRow): JobFeatures => ({
  id: j.id, categoryId: j.categoryId, employmentType: j.employmentType, workMode: j.workMode,
  minExperienceYears: j.minExperienceYears, requiredEducationLevel: j.requiredEducationLevel,
  salaryMin: j.salaryMin, salaryMax: j.salaryMax, startDate: j.startDate, lat: j.lat, lng: j.lng,
  locationPath: pathIds(j.location),
  skills: j.skills.map((s) => ({ skillId: s.skillId, name: s.skill.nameEn, importance: s.importance, minProficiency: s.minProficiency })),
  embedding: j.embedding.length ? j.embedding : null,
  criteria: j.criteria.filter((c) => c.criterion.isActive).map((c) => ({
    id: c.criterionId, key: c.criterion.key, label: c.criterion.labelEn, type: c.criterion.type, importance: c.importance, requirement: c.value,
    optionLabels: Object.fromEntries(((c.criterion.options ?? []) as { value: string; labelEn: string }[]).map((o) => [o.value, o.labelEn])),
  })),
});

const toWorker = (w: WorkerRow): WorkerFeatures => ({
  id: w.id, categoryId: w.categoryId, yearsExperience: w.yearsExperience,
  experiences: w.experiences.map((e) => ({ categoryId: e.categoryId, start: e.startDate, end: e.endDate })),
  educationLevels: w.education.map((e) => e.level), certificationCount: w._count.certifications,
  skills: w.skills.map((s) => ({ skillId: s.skillId, name: s.skill.nameEn, proficiency: s.proficiency })),
  availability: w.availability, availableFrom: w.availableFrom, lat: w.lat, lng: w.lng,
  maxTravelKm: w.maxTravelKm, willingToRelocate: w.willingToRelocate, locationPath: pathIds(w.location),
  preferredTypes: w.preferredTypes, preferredWorkModes: w.preferredWorkModes,
  expectedSalaryMin: w.expectedSalaryMin, expectedSalaryMax: w.expectedSalaryMax,
  embedding: w.embedding.length ? w.embedding : null,
  criteria: Object.fromEntries(w.criteria.map((c) => [c.criterionId, { value: c.value, verified: c.source === 'VERIFIED' }])),
});

export async function loadJob(jobId: string): Promise<JobFeatures> {
  const j = await prisma.job.findUnique({ where: { id: jobId }, select: jobSelect });
  if (!j) throw notFound('Job not found');
  return toJob(j);
}
const loadJobs = async (ids: string[]) => (await prisma.job.findMany({ where: { id: { in: ids } }, select: jobSelect })).map(toJob);
export async function loadWorker(workerId: string): Promise<WorkerFeatures> {
  const w = await prisma.workerProfile.findUnique({ where: { id: workerId }, select: workerSelect });
  if (!w) throw notFound('Worker not found');
  return toWorker(w);
}
const loadWorkers = async (ids: string[]) => (await prisma.workerProfile.findMany({ where: { id: { in: ids } }, select: workerSelect })).map(toWorker);

/** Ids of the rows whose embedding is close to the query, best first. In-process cosine: fine for thousands of rows; pgvector is the scale path. */
function nearest(query: number[], rows: { id: string; embedding: number[] }[]): string[] {
  return rows
    .map((r) => ({ id: r.id, sim: cosine(query, r.embedding) }))
    .filter((r) => r.sim >= SEMANTIC_CANDIDATE_MIN)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, SEMANTIC_CANDIDATES)
    .map((r) => r.id);
}

/** Skill ids that could satisfy any of the given skills: themselves plus related ones. */
async function expandSkills(ids: string[]): Promise<string[]> {
  const rel = await getRelations();
  const out = new Set(ids);
  for (const id of ids) for (const r of rel.get(id)?.keys() ?? []) out.add(r);
  return [...out];
}

export async function scoreOne(jobId: string, workerId: string): Promise<{ result: MatchResult; weightsVersion: number | null }> {
  const [job, worker, relations] = await Promise.all([loadJob(jobId), loadWorker(workerId), getRelations()]);
  const { weights, version } = await getWeights(job.categoryId);
  return { result: matchPair(job, worker, weights, relations), weightsVersion: version };
}

/** Scores several workers against one job (used for applicant lists and comparisons). */
export async function scoreWorkersForJob(jobId: string, workerIds: string[]): Promise<Map<string, MatchResult>> {
  const out = new Map<string, MatchResult>();
  if (!workerIds.length) return out;
  const [job, workers, relations] = await Promise.all([loadJob(jobId), loadWorkers(workerIds), getRelations()]);
  const { weights } = await getWeights(job.categoryId);
  for (const w of workers) out.set(w.id, matchPair(job, w, weights, relations));
  return out;
}

export interface RankedWorker { workerId: string; result: MatchResult }
export interface RankedJob { jobId: string; result: MatchResult }

/** Visible, available workers who could plausibly fit the job (shared skills, related skills, or same category), best first. */
export async function recommendWorkers(jobId: string, limit: number): Promise<RankedWorker[]> {
  const job = await loadJob(jobId);
  const expanded = await expandSkills(job.skills.map((s) => s.skillId));
  const candidates = await prisma.workerProfile.findMany({
    where: {
      isVisible: true,
      availability: { not: 'NOT_AVAILABLE' },
      user: { status: 'ACTIVE' },
      applications: { none: { jobId } }, // people who already applied are in the applicant list
      OR: [{ skills: { some: { skillId: { in: expanded } } } }, { categoryId: job.categoryId }],
    },
    select: { id: true },
    take: MAX_CANDIDATES,
  });
  // Recall beyond shared skills: workers whose profile text is close in meaning to the posting.
  const neighbours = job.embedding
    ? await prisma.workerProfile
        .findMany({
          where: { isVisible: true, availability: { not: 'NOT_AVAILABLE' }, user: { status: 'ACTIVE' }, applications: { none: { jobId } }, embedding: { isEmpty: false } },
          select: { id: true, embedding: true },
          take: SEMANTIC_POOL,
        })
        .then((rows) => nearest(job.embedding!, rows))
    : [];
  const ids = [...new Set([...candidates.map((c) => c.id), ...neighbours])];
  const [workers, relations, { weights, version }] = await Promise.all([loadWorkers(ids), getRelations(), getWeights(job.categoryId)]);
  const ranked = workers
    .map((w) => ({ workerId: w.id, result: matchPair(job, w, weights, relations) }))
    .filter((r) => recommendable(r.result))
    .sort((a, b) => b.result.score - a.result.score || b.result.confidence - a.result.confidence)
    .slice(0, limit);
  await persist(ranked.map((r) => ({ jobId, workerId: r.workerId, result: r.result })), 'JOB_TO_WORKER', version, { jobId });
  return ranked;
}

/** Open jobs that could fit the worker, best first. */
export async function recommendJobs(workerId: string, limit: number): Promise<{ items: RankedJob[]; reason: 'ok' | 'no_profile_data' }> {
  const worker = await loadWorker(workerId);
  if (worker.skills.length === 0 && !worker.categoryId) return { items: [], reason: 'no_profile_data' };
  const expanded = await expandSkills(worker.skills.map((s) => s.skillId));
  const now = new Date();
  const candidates = await prisma.job.findMany({
    where: {
      AND: [
        { status: 'ACTIVE' },
        { OR: [{ deadline: null }, { deadline: { gte: now } }] },
        { applications: { none: { workerId, status: { not: 'WITHDRAWN' } } } },
        { OR: [{ skills: { some: { skillId: { in: expanded } } } }, ...(worker.categoryId ? [{ categoryId: worker.categoryId }] : [])] },
      ],
    },
    select: { id: true },
    take: MAX_CANDIDATES,
  });
  const neighbours = worker.embedding
    ? await prisma.job
        .findMany({
          where: {
            status: 'ACTIVE', OR: [{ deadline: null }, { deadline: { gte: now } }],
            applications: { none: { workerId, status: { not: 'WITHDRAWN' } } }, embedding: { isEmpty: false },
          },
          select: { id: true, embedding: true },
          take: SEMANTIC_POOL,
        })
        .then((rows) => nearest(worker.embedding!, rows))
    : [];
  const [jobs, relations] = await Promise.all([loadJobs([...new Set([...candidates.map((c) => c.id), ...neighbours])]), getRelations()]);
  const scored: (RankedJob & { version: number | null })[] = [];
  for (const j of jobs) {
    const { weights, version } = await getWeights(j.categoryId);
    scored.push({ jobId: j.id, result: matchPair(j, worker, weights, relations), version });
  }
  const ranked = scored
    .filter((r) => recommendable(r.result))
    .sort((a, b) => b.result.score - a.result.score || b.result.confidence - a.result.confidence)
    .slice(0, limit);
  await persist(ranked.map((r) => ({ jobId: r.jobId, workerId, result: r.result })), 'WORKER_TO_JOB', ranked[0]?.version ?? null, { workerId });
  return { items: ranked.map(({ jobId, result }) => ({ jobId, result })), reason: 'ok' };
}

/**
 * Keep the latest recommendation list as an evaluation log. Older rows for the same job (or worker) are
 * replaced unless someone already reacted to them, so feedback signals are never lost.
 */
async function persist(
  rows: { jobId: string; workerId: string; result: MatchResult }[],
  direction: 'JOB_TO_WORKER' | 'WORKER_TO_JOB',
  weightsVersion: number | null,
  scope: { jobId?: string; workerId?: string },
) {
  await prisma.$transaction([
    prisma.recommendation.deleteMany({ where: { ...scope, direction, feedback: { none: {} } } }),
    prisma.recommendation.createMany({
      data: rows.map((r) => ({
        jobId: r.jobId, workerId: r.workerId, direction, score: r.result.score, confidence: r.result.confidence,
        components: r.result.components as unknown as Prisma.InputJsonValue, explanation: r.result.explanation,
        engineVersion: r.result.engineVersion, weightsVersion,
      })),
    }),
  ]);
}

/**
 * Remember what happened to a recommended person or job (applied, shortlisted, hired) so the administrator can
 * see how recommendations perform. Only recommendations that were actually shown can be credited; each outcome
 * is recorded once per recommendation.
 */
export async function recordFeedback(jobId: string, workerId: string, action: 'APPLIED' | 'SHORTLISTED' | 'HIRED') {
  try {
    const recs = await prisma.recommendation.findMany({ where: { jobId, workerId }, select: { id: true, feedback: { where: { action }, select: { id: true } } } });
    const fresh = recs.filter((r) => r.feedback.length === 0);
    if (fresh.length) await prisma.recommendationFeedback.createMany({ data: fresh.map((r) => ({ recommendationId: r.id, action })) });
  } catch (err) {
    logger.warn({ err: String(err), jobId, workerId, action }, 'recommendation feedback not recorded');
  }
}

const ALERT_MIN_SCORE = 60;
const ALERT_MIN_CONFIDENCE = 0.5;
const ALERTS_PER_WORKER_PER_DAY = 3;
const ALERT_RECIPIENTS = 10;
const MATCH_POOL = 200; // how many ranked candidates are looked at when a job goes live
const AUTO_APPLY_PER_JOB = 20;
const AUTO_APPLY_PER_WORKER_PER_DAY = 5;

/**
 * When a job goes live:
 *  1. the employer is told how many people match (a count only, no names or contact details);
 *  2. workers who opted in to auto-apply and match at or above their own threshold are applied for, and told;
 *  3. other strong matches get a "you match this job" alert.
 * Nothing here is sent without the match being eligible (a missed must-have never matches) and confident enough,
 * workers can switch alerts off, nobody gets more than three alerts a day, and the worker's phone number stays hidden
 * from the employer until the application is shortlisted, exactly as for a normal application.
 */
export async function notifyNewJobMatches(jobId: string): Promise<{ alerts: number; autoApplied: number; matching: number }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, status: 'ACTIVE' }, select: { id: true, title: true, postedById: true, organization: { select: { name: true } } } });
  if (!job) return { alerts: 0, autoApplied: 0, matching: 0 };
  const ranked = await recommendWorkers(jobId, MATCH_POOL);
  const good = ranked.filter((r) => r.result.score >= ALERT_MIN_SCORE && r.result.confidence >= ALERT_MIN_CONFIDENCE && r.result.eligibility !== 'not_eligible');

  if (good.length > 0) {
    await notify(job.postedById, 'job.matches', { jobId: job.id, jobTitle: job.title, matching: good.length, strong: good.filter((r) => r.result.score >= 80).length });
  }

  const since = new Date(Date.now() - 86_400_000);
  const { apply } = await import('../applications/service');
  let alerts = 0;
  let autoApplied = 0;
  for (const r of good) {
    if (alerts >= ALERT_RECIPIENTS && autoApplied >= AUTO_APPLY_PER_JOB) break;
    const w = await prisma.workerProfile.findUnique({
      where: { id: r.workerId },
      select: { userId: true, user: { select: { notifyJobMatches: true, autoApply: true, autoApplyMinScore: true } } },
    });
    if (!w) continue;

    if (w.user.autoApply && autoApplied < AUTO_APPLY_PER_JOB && r.result.score >= w.user.autoApplyMinScore) {
      const today = await prisma.application.count({ where: { workerId: r.workerId, autoApplied: true, createdAt: { gte: since } } });
      if (today < AUTO_APPLY_PER_WORKER_PER_DAY) {
        try {
          const applicationId = await apply(w.userId, job.id, null, { auto: true });
          await notify(w.userId, 'application.auto', { applicationId, jobId: job.id, jobTitle: job.title, organizationName: job.organization.name, score: r.result.score });
          autoApplied++;
          continue;
        } catch (err) {
          logger.warn({ err: String(err), jobId }, 'auto-apply skipped');
        }
      }
    }

    if (alerts >= ALERT_RECIPIENTS || !w.user.notifyJobMatches) continue;
    const recent = await prisma.notification.count({ where: { userId: w.userId, type: 'job.recommended', createdAt: { gte: since } } });
    if (recent >= ALERTS_PER_WORKER_PER_DAY) continue;
    await notify(w.userId, 'job.recommended', { jobId: job.id, jobTitle: job.title, organizationName: job.organization.name, score: r.result.score, strength: r.result.strength });
    alerts++;
  }
  return { alerts, autoApplied, matching: good.length };
}

/** What employers and workers see. The same shape for both; distance is already whole kilometres. */
export const publicMatch = (r: MatchResult) => ({
  score: r.score, confidence: r.confidence, strength: r.strength, explanation: r.explanation,
  components: r.components, matchedSkills: r.matchedSkills, relatedSkills: r.relatedSkills, missingSkills: r.missingSkills,
  requiredCoverage: r.requiredCoverage, semantic: r.semantic, notAssessed: r.notAssessed, distanceKm: r.distanceKm, engineVersion: r.engineVersion,
  criteria: r.criteria, eligibility: r.eligibility,
});
export const briefMatch = (r: MatchResult) => ({ score: r.score, confidence: r.confidence, strength: r.strength, eligibility: r.eligibility });
