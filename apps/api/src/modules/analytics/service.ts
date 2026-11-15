import { prisma } from '../../lib/prisma';
import { orgIdFor } from '../jobs/service';
import { workerIdFor } from '../workers/service';

/** Groups smaller than this are never shown, so a statistic cannot point at one or two identifiable people or firms. */
export const K_MIN = 5;
const suppressed = (n: number) => (n >= K_MIN ? n : null);
const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

async function regionResolver() {
  const rows = await prisma.location.findMany({ select: { id: true, parentId: true, nameEn: true, level: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (locationId: string | null): string | null => {
    let cur = locationId ? byId.get(locationId) : undefined;
    while (cur && cur.level !== 'REGION') cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    return cur?.nameEn ?? null;
  };
}

// ───────── Worker ─────────

export async function workerAnalytics(userId: string) {
  const workerId = await workerIdFor(userId);
  const w = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, select: { categoryId: true, profileViews: true, skills: { select: { skillId: true } } } });
  const owned = new Set(w.skills.map((s) => s.skillId));

  const [byStatus, interviews] = await Promise.all([
    prisma.application.groupBy({ by: ['status'], where: { workerId }, _count: true }),
    prisma.interview.count({ where: { application: { workerId } } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
  const total = byStatus.reduce((s, x) => s + x._count, 0);
  const accepted = counts.ACCEPTED ?? 0;
  const decided = accepted + (counts.REJECTED ?? 0);

  const names = async (ids: string[]) => new Map((await prisma.skill.findMany({ where: { id: { in: ids } }, select: { id: true, nameEn: true } })).map((s) => [s.id, s.nameEn]));

  // What the market asks for right now (all open jobs).
  const demand = await prisma.jobSkill.groupBy({ by: ['skillId'], where: { job: { status: 'ACTIVE' } }, _count: true, orderBy: { _count: { skillId: 'desc' } }, take: 10 });
  const nameOf = await names(demand.map((d) => d.skillId));
  const mostRequested = demand.map((d) => ({ skillId: d.skillId, name: nameOf.get(d.skillId) ?? '', openJobs: d._count, youHaveIt: owned.has(d.skillId) }));

  // Skills the worker lacks that open jobs in their field require. Demand-based, not a promise of results.
  const gap = await prisma.jobSkill.groupBy({
    by: ['skillId'],
    where: { importance: 'REQUIRED', job: { status: 'ACTIVE', ...(w.categoryId ? { categoryId: w.categoryId } : {}) }, ...(owned.size ? { skillId: { notIn: [...owned] } } : {}) },
    _count: true, orderBy: { _count: { skillId: 'desc' } }, take: 6,
  });
  const gapNames = await names(gap.map((g) => g.skillId));
  const rel = owned.size ? await prisma.skillRelation.findMany({ where: { OR: [{ skillAId: { in: [...owned] } }, { skillBId: { in: [...owned] } }] }, select: { skillAId: true, skillBId: true } }) : [];
  const near = new Set(rel.flatMap((r) => [r.skillAId, r.skillBId]));
  const recommendedSkills = gap.map((g) => ({ skillId: g.skillId, name: gapNames.get(g.skillId) ?? '', requiredInOpenJobs: g._count, closeToYourSkills: near.has(g.skillId) }));

  return {
    profileViews: w.profileViews,
    applications: { total, byStatus: counts, interviewInvitations: interviews, successful: accepted, decided, successRate: decided >= 3 ? round1((accepted / decided) * 100) : null },
    mostRequestedSkills: mostRequested,
    recommendedSkills,
    scope: w.categoryId ? 'open jobs in your professional category' : 'all open jobs (set a category on your profile for a sharper list)',
    note: 'Suggestions are based on what open jobs ask for. They do not guarantee a better outcome.',
  };
}

// ───────── Employer ─────────

export async function employerAnalytics(userId: string) {
  const orgId = await orgIdFor(userId);
  const [jobsByStatus, vacancies, apps] = await Promise.all([
    prisma.job.groupBy({ by: ['status'], where: { organizationId: orgId, status: { not: 'REMOVED' } }, _count: true }),
    prisma.job.aggregate({ where: { organizationId: orgId, status: 'ACTIVE' }, _sum: { vacancies: true } }),
    prisma.application.findMany({
      where: { job: { organizationId: orgId } },
      select: { id: true, jobId: true, status: true, createdAt: true, matchSnapshot: true, history: { select: { toStatus: true, createdAt: true } }, job: { select: { title: true, status: true, publishedAt: true } } },
      take: 5000,
    }),
  ]);

  const byStatus: Record<string, number> = {};
  const reached = { UNDER_REVIEW: new Set<string>(), SHORTLISTED: new Set<string>(), INTERVIEW_SCHEDULED: new Set<string>(), ACCEPTED: new Set<string>() } as Record<string, Set<string>>;
  const scores: number[] = [];
  const toHire: number[] = [];
  const publishToFirstHire = new Map<string, number>();
  const perJob = new Map<string, { jobId: string; title: string; status: string; applications: number; scores: number[]; shortlisted: number; accepted: number }>();

  for (const a of apps) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    for (const h of a.history) if (reached[h.toStatus]) reached[h.toStatus].add(a.id);
    const score = (a.matchSnapshot as { score?: number } | null)?.score;
    if (typeof score === 'number') scores.push(score);
    const hired = a.history.find((h) => h.toStatus === 'ACCEPTED');
    if (hired) {
      toHire.push((hired.createdAt.getTime() - a.createdAt.getTime()) / DAY);
      if (a.job.publishedAt) {
        const d = (hired.createdAt.getTime() - a.job.publishedAt.getTime()) / DAY;
        publishToFirstHire.set(a.jobId, Math.min(publishToFirstHire.get(a.jobId) ?? Infinity, d));
      }
    }
    const row = perJob.get(a.jobId) ?? { jobId: a.jobId, title: a.job.title, status: a.job.status, applications: 0, scores: [], shortlisted: 0, accepted: 0 };
    row.applications++;
    if (typeof score === 'number') row.scores.push(score);
    if (reached.SHORTLISTED.has(a.id)) row.shortlisted++;
    if (a.status === 'ACCEPTED') row.accepted++;
    perJob.set(a.jobId, row);
  }

  return {
    jobs: { byStatus: Object.fromEntries(jobsByStatus.map((j) => [j.status, j._count])), openVacancies: vacancies._sum.vacancies ?? 0 },
    applications: { total: apps.length, byStatus },
    funnel: {
      applied: apps.length,
      reviewed: reached.UNDER_REVIEW.size,
      shortlisted: reached.SHORTLISTED.size,
      interviewed: reached.INTERVIEW_SCHEDULED.size,
      hired: reached.ACCEPTED.size,
    },
    candidateMatchQuality: { averageScore: avg(scores), medianScore: median(scores), scored: scores.length, note: 'Score when each person applied (rule-based match, 0 to 100).' },
    hiring: {
      hires: reached.ACCEPTED.size,
      averageDaysFromApplicationToHire: avg(toHire),
      averageDaysFromPostingToFirstHire: avg([...publishToFirstHire.values()]),
    },
    perJob: [...perJob.values()].map((r) => ({ jobId: r.jobId, title: r.title, status: r.status, applications: r.applications, averageMatchScore: avg(r.scores), shortlisted: r.shortlisted, accepted: r.accepted })).sort((a, b) => b.applications - a.applications),
  };
}

// ───────── National (administrators, privacy-protected) ─────────

export async function nationalAnalytics() {
  const regionOf = await regionResolver();
  const [jobs, workers, requiredSkills, decided] = await Promise.all([
    prisma.job.findMany({ where: { status: 'ACTIVE', OR: [{ deadline: null }, { deadline: { gte: new Date() } }] }, select: { locationId: true, vacancies: true, categoryId: true, category: { select: { nameEn: true } } } }),
    prisma.workerProfile.findMany({ where: { isVisible: true, user: { status: 'ACTIVE' } }, select: { locationId: true, occupation: true } }),
    prisma.jobSkill.groupBy({ by: ['skillId'], where: { importance: 'REQUIRED', job: { status: 'ACTIVE' } }, _count: true, orderBy: { _count: { skillId: 'desc' } }, take: 15 }),
    prisma.application.findMany({ where: { status: { in: ['ACCEPTED', 'REJECTED'] } }, select: { status: true, job: { select: { category: { select: { nameEn: true } } } } }, take: 20_000 }),
  ]);

  const jobsByRegion = new Map<string, { jobs: number; vacancies: number }>();
  const byCategory = new Map<string, number>();
  for (const j of jobs) {
    const r = regionOf(j.locationId) ?? 'Not specified';
    const cur = jobsByRegion.get(r) ?? { jobs: 0, vacancies: 0 };
    cur.jobs++;
    cur.vacancies += j.vacancies;
    jobsByRegion.set(r, cur);
    byCategory.set(j.category.nameEn, (byCategory.get(j.category.nameEn) ?? 0) + 1);
  }
  const workersByRegion = new Map<string, number>();
  const occ = new Map<string, number>();
  for (const w of workers) {
    const r = regionOf(w.locationId) ?? 'Not specified';
    workersByRegion.set(r, (workersByRegion.get(r) ?? 0) + 1);
    const o = w.occupation?.trim().toLowerCase();
    if (o && o.length <= 60) occ.set(o, (occ.get(o) ?? 0) + 1);
  }
  const skillNames = new Map((await prisma.skill.findMany({ where: { id: { in: requiredSkills.map((s) => s.skillId) } }, select: { id: true, nameEn: true } })).map((s) => [s.id, s.nameEn]));

  const outcome = new Map<string, { accepted: number; decided: number }>();
  let acc = 0;
  for (const d of decided) {
    const k = d.job.category.nameEn;
    const cur = outcome.get(k) ?? { accepted: 0, decided: 0 };
    cur.decided++;
    if (d.status === 'ACCEPTED') { cur.accepted++; acc++; }
    outcome.set(k, cur);
  }

  const regions = [...new Set([...jobsByRegion.keys(), ...workersByRegion.keys()])].sort();
  return {
    privacy: `Counts below ${K_MIN} are hidden (shown as null) so no statistic points at a handful of people or firms.`,
    k: K_MIN,
    regions: regions.map((name) => ({
      region: name,
      openJobs: suppressed(jobsByRegion.get(name)?.jobs ?? 0),
      vacancies: (jobsByRegion.get(name)?.jobs ?? 0) >= K_MIN ? jobsByRegion.get(name)!.vacancies : null,
      visibleWorkers: suppressed(workersByRegion.get(name) ?? 0),
    })),
    categories: [...byCategory.entries()].map(([name, n]) => ({ category: name, openJobs: suppressed(n) })).sort((a, b) => (b.openJobs ?? 0) - (a.openJobs ?? 0)),
    mostRequiredSkills: requiredSkills.map((s) => ({ skill: skillNames.get(s.skillId) ?? '', openJobs: suppressed(s._count) })),
    popularOccupations: [...occ.entries()].filter(([, n]) => n >= K_MIN).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([occupation, workers]) => ({ occupation, workers })),
    applicationOutcomes: {
      decided: decided.length,
      successRate: decided.length >= K_MIN ? round1((acc / decided.length) * 100) : null,
      byCategory: [...outcome.entries()].map(([category, v]) => ({ category, decided: suppressed(v.decided), successRate: v.decided >= K_MIN ? round1((v.accepted / v.decided) * 100) : null })),
      note: 'Success rate = accepted / (accepted + rejected). Applications still pending or withdrawn are not counted.',
    },
  };
}

/** Totals that are safe to show on the public home page; tiny numbers are hidden. */
export async function publicStats() {
  const [activeJobs, workers, employers, hires] = await Promise.all([
    prisma.job.count({ where: { status: 'ACTIVE', OR: [{ deadline: null }, { deadline: { gte: new Date() } }] } }),
    prisma.user.count({ where: { role: 'WORKER', status: 'ACTIVE' } }),
    prisma.organization.count({ where: { jobs: { some: { status: 'ACTIVE' } } } }),
    prisma.application.count({ where: { status: 'ACCEPTED' } }),
  ]);
  return { activeJobs: suppressed(activeJobs), registeredWorkers: suppressed(workers), hiringEmployers: suppressed(employers), successfulHires: suppressed(hires) };
}

// ───────── Recommendation performance (administrators) ─────────

export async function aiPerformance() {
  const recs = await prisma.recommendation.findMany({
    select: { engineVersion: true, direction: true, score: true, confidence: true, feedback: { select: { action: true } } },
    take: 50_000,
  });
  type Agg = { recommendations: number; scores: number[]; confidences: number[]; applied: number; shortlisted: number; hired: number };
  const empty = (): Agg => ({ recommendations: 0, scores: [], confidences: [], applied: 0, shortlisted: 0, hired: 0 });
  const by = new Map<string, Agg>();
  const buckets: [string, number, number][] = [['0 to 39', 0, 40], ['40 to 59', 40, 60], ['60 to 79', 60, 80], ['80 to 100', 80, 101]];
  const byBucket = new Map<string, Agg>(buckets.map(([k]) => [k, empty()]));

  const add = (a: Agg, r: (typeof recs)[number]) => {
    a.recommendations++;
    a.scores.push(r.score);
    a.confidences.push(r.confidence);
    const acts = new Set(r.feedback.map((f) => f.action));
    if (acts.has('APPLIED')) a.applied++;
    if (acts.has('SHORTLISTED')) a.shortlisted++;
    if (acts.has('HIRED')) a.hired++;
  };
  for (const r of recs) {
    const key = `${r.engineVersion}|${r.direction}`;
    add(by.get(key) ?? by.set(key, empty()).get(key)!, r);
    const b = buckets.find(([, lo, hi]) => r.score >= lo && r.score < hi)![0];
    add(byBucket.get(b)!, r);
  }
  const rate = (n: number, d: number) => (d >= K_MIN ? round1((n / d) * 100) : null);
  const shape = (a: Agg) => ({
    recommendations: a.recommendations, averageScore: avg(a.scores), averageConfidence: a.confidences.length ? Math.round((a.confidences.reduce((x, y) => x + y, 0) / a.confidences.length) * 100) / 100 : null,
    appliedPct: rate(a.applied, a.recommendations), shortlistedPct: rate(a.shortlisted, a.recommendations), hiredPct: rate(a.hired, a.recommendations),
    applied: a.applied, shortlisted: a.shortlisted, hired: a.hired,
  });
  const fb = await prisma.recommendationFeedback.groupBy({ by: ['action'], _count: true });
  return {
    byEngine: [...by.entries()].map(([k, v]) => { const [engineVersion, direction] = k.split('|'); return { engineVersion, direction, ...shape(v) }; }),
    byScoreBand: buckets.map(([k]) => ({ band: k, ...shape(byBucket.get(k)!) })),
    feedbackTotals: Object.fromEntries(fb.map((f) => [f.action, f._count])),
    caveats: [
      'Percentages are hidden when fewer than 5 recommendations are in the group.',
      'A recommendation is only logged when someone opens a recommendation list, so unseen matches are not counted.',
      'Applying, shortlisting and hiring depend on many things besides the score (pay, timing, employer preferences). Higher rates in higher score bands are encouraging but are observational, not proof that scores cause better outcomes.',
      'This is not the evaluation required by the project: that uses labelled relevance judgements (Phase 13).',
    ],
  };
}
