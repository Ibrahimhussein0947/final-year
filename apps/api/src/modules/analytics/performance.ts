import type { ApplicationStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { K_MIN } from './service';

/**
 * Platform performance for administrators: hiring funnel and drop-off, how quickly employers respond and hire, how well the
 * match score lines up with outcomes, and weekly growth. Everything is aggregate. Any figure about a group smaller than
 * K_MIN (5) is returned as null, so no number points at a handful of people or firms; platform-wide totals and the weekly
 * growth counts are not suppressed (they are the same totals the admin overview already shows).
 *
 * The functions below the loader are pure so they can be tested without a database.
 */

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number, d: number) => (d > 0 ? round1((n / d) * 100) : null);
const sup = <T>(n: number, v: T): T | null => (n >= K_MIN ? v : null);

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return round1(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}

export type PerfEvent = { to: ApplicationStatus; at: Date };
export type PerfApp = {
  id: string;
  createdAt: Date;
  status: ApplicationStatus;
  autoApplied: boolean;
  score: number | null; // match score at the time of applying
  category: string;
  jobId: string;
  jobPublishedAt: Date | null;
  events: PerfEvent[]; // status changes, any order
};

// ───────── Funnel ─────────

const RANK: Partial<Record<ApplicationStatus, number>> = { PENDING: 0, UNDER_REVIEW: 1, SHORTLISTED: 2, INTERVIEW_SCHEDULED: 3, ACCEPTED: 4 };
export const FUNNEL_STAGES = ['Applied', 'Reviewed', 'Shortlisted', 'Interview', 'Hired'] as const;

/** The furthest stage an application ever reached, from its current status and its history (rejections and withdrawals do not count as progress). */
export function furthestStage(a: Pick<PerfApp, 'status' | 'events'>): number {
  let best = RANK[a.status] ?? 0;
  for (const e of a.events) best = Math.max(best, RANK[e.to] ?? 0);
  return best;
}

export function buildFunnel(apps: PerfApp[]) {
  const reached = FUNNEL_STAGES.map((_, i) => apps.filter((a) => furthestStage(a) >= i).length);
  const stages = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    applications: reached[i],
    pctOfApplied: pct(reached[i], reached[0]),
    // Of those who reached the previous stage, how many made it to this one: the drop-off at each step.
    pctOfPrevious: i === 0 ? null : pct(reached[i], reached[i - 1]),
  }));
  const count = (s: ApplicationStatus) => apps.filter((a) => a.status === s).length;
  return {
    stages,
    // Where applications stand today (not where they got to).
    current: { open: apps.filter((a) => !['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(a.status)).length, hired: count('ACCEPTED'), rejected: count('REJECTED'), withdrawn: count('WITHDRAWN') },
  };
}

// ───────── Timing ─────────

const days = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY;
const firstAt = (a: PerfApp, pred: (e: PerfEvent) => boolean) => a.events.filter(pred).map((e) => e.at.getTime()).sort((x, y) => x - y)[0];

function dist(xs: number[]) {
  return { n: xs.length, medianDays: sup(xs.length, quantile(xs, 0.5)), p75Days: sup(xs.length, quantile(xs, 0.75)) };
}

export function buildTiming(apps: PerfApp[], now: Date) {
  // First answer from the employer side: any move away from PENDING that is not the worker withdrawing.
  const response: number[] = [];
  const hire: number[] = [];
  for (const a of apps) {
    const r = firstAt(a, (e) => e.to !== 'PENDING' && e.to !== 'WITHDRAWN');
    if (r !== undefined) response.push(Math.max(0, (r - a.createdAt.getTime()) / DAY));
    const h = firstAt(a, (e) => e.to === 'ACCEPTED');
    if (h !== undefined) hire.push(Math.max(0, (h - a.createdAt.getTime()) / DAY));
  }
  // Time to fill: from publishing a job to its first hire.
  const fill = new Map<string, number>();
  for (const a of apps) {
    const h = firstAt(a, (e) => e.to === 'ACCEPTED');
    if (h === undefined || !a.jobPublishedAt) continue;
    const d = Math.max(0, (h - a.jobPublishedAt.getTime()) / DAY);
    fill.set(a.jobId, Math.min(fill.get(a.jobId) ?? Infinity, d));
  }
  // Applications nobody has touched for a week: a sign employers are not answering.
  const old = apps.filter((a) => now.getTime() - a.createdAt.getTime() > 7 * DAY);
  const stale = old.filter((a) => a.status === 'PENDING').length;
  return {
    firstResponse: dist(response),
    applicationToHire: dist(hire),
    jobTimeToFill: dist([...fill.values()]),
    unansweredAfter7Days: { applications: sup(old.length, stale), outOf: old.length, pct: sup(old.length, pct(stale, old.length)) },
  };
}

// ───────── Categories ─────────

export function buildByCategory(apps: PerfApp[]) {
  const groups = new Map<string, PerfApp[]>();
  for (const a of apps) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  return [...groups.entries()]
    .map(([category, rows]) => {
      const hired = rows.filter((a) => a.status === 'ACCEPTED');
      const hireDays = hired.flatMap((a) => {
        const h = firstAt(a, (e) => e.to === 'ACCEPTED');
        return h === undefined ? [] : [Math.max(0, (h - a.createdAt.getTime()) / DAY)];
      });
      return {
        category,
        applications: sup(rows.length, rows.length),
        hired: sup(rows.length, hired.length),
        hireRatePct: sup(rows.length, pct(hired.length, rows.length)),
        medianDaysToHire: sup(hireDays.length, quantile(hireDays, 0.5)),
        _n: rows.length,
      };
    })
    .sort((a, b) => b._n - a._n)
    .map(({ _n, ...rest }) => rest);
}

// ───────── Match quality ─────────

// Three bands, so that a platform with a few dozen decisions still has groups big enough to show.
const BANDS: [string, number, number][] = [['Below 60', 0, 60], ['60 to 79', 60, 80], ['80 to 100', 80, 101]];

/** Does a higher match score go with being hired? Observational only: many other things decide a hire. */
export function buildMatchQuality(apps: PerfApp[]) {
  const decided = apps.filter((a) => a.score !== null && (a.status === 'ACCEPTED' || a.status === 'REJECTED'));
  const meanScore = (rows: PerfApp[]) => (rows.length ? round1(rows.reduce((s, a) => s + (a.score as number), 0) / rows.length) : null);
  const accepted = decided.filter((a) => a.status === 'ACCEPTED');
  const rejected = decided.filter((a) => a.status === 'REJECTED');
  return {
    decidedWithScore: decided.length,
    averageScoreHired: sup(accepted.length, meanScore(accepted)),
    averageScoreRejected: sup(rejected.length, meanScore(rejected)),
    byScoreBand: BANDS.map(([band, lo, hi]) => {
      const rows = decided.filter((a) => (a.score as number) >= lo && (a.score as number) < hi);
      const hired = rows.filter((a) => a.status === 'ACCEPTED').length;
      return { band, decided: sup(rows.length, rows.length), hiredPct: sup(rows.length, pct(hired, rows.length)) };
    }),
  };
}

export function buildAutoApply(apps: PerfApp[]) {
  const auto = apps.filter((a) => a.autoApplied);
  const manual = apps.filter((a) => !a.autoApplied);
  const rate = (rows: PerfApp[]) => {
    const decided = rows.filter((a) => a.status === 'ACCEPTED' || a.status === 'REJECTED');
    return { decided: sup(decided.length, decided.length), hiredPct: sup(decided.length, pct(decided.filter((a) => a.status === 'ACCEPTED').length, decided.length)) };
  };
  return { shareOfApplicationsPct: pct(auto.length, apps.length), auto: rate(auto), manual: rate(manual) };
}

// ───────── Weekly growth ─────────

/** Monday 00:00 UTC of the week containing the date. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** The last `weeks` weeks ending with the current one, oldest first, each with how many dates fall inside it. */
export function weeklySeries(dates: Date[], weeks: number, now: Date) {
  const first = weekStart(now).getTime() - (weeks - 1) * 7 * DAY;
  const counts = new Array<number>(weeks).fill(0);
  for (const d of dates) {
    const i = Math.floor((weekStart(d).getTime() - first) / (7 * DAY));
    if (i >= 0 && i < weeks) counts[i]++;
  }
  return counts.map((count, i) => ({ weekStart: new Date(first + i * 7 * DAY).toISOString().slice(0, 10), count }));
}

// ───────── Loader ─────────

const MAX_APPLICATIONS = 50_000;
const GROWTH_WEEKS = 12;

/** `scope` narrows which applications are analysed (used by tests; a per-region or per-employer view could use it too). */
export async function hiringPerformance(windowDays: number, now = new Date(), scope: Prisma.ApplicationWhereInput = {}) {
  const since = new Date(now.getTime() - windowDays * DAY);
  const growthSince = new Date(weekStart(now).getTime() - (GROWTH_WEEKS - 1) * 7 * DAY);

  const [rows, users, jobs, appDates] = await Promise.all([
    prisma.application.findMany({
      where: { ...scope, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: MAX_APPLICATIONS,
      select: {
        id: true, createdAt: true, status: true, autoApplied: true, matchSnapshot: true,
        job: { select: { id: true, publishedAt: true, category: { select: { nameEn: true } } } },
        history: { select: { toStatus: true, createdAt: true } },
      },
    }),
    prisma.user.findMany({ where: { createdAt: { gte: growthSince }, role: { in: ['WORKER', 'EMPLOYER'] } }, select: { role: true, createdAt: true } }),
    prisma.job.findMany({ where: { publishedAt: { gte: growthSince } }, select: { publishedAt: true } }),
    prisma.application.findMany({ where: { createdAt: { gte: growthSince } }, select: { createdAt: true } }),
  ]);

  const apps: PerfApp[] = rows.map((r) => {
    const snap = r.matchSnapshot as { score?: unknown } | null;
    return {
      id: r.id, createdAt: r.createdAt, status: r.status, autoApplied: r.autoApplied,
      score: typeof snap?.score === 'number' ? snap.score : null,
      category: r.job.category.nameEn, jobId: r.job.id, jobPublishedAt: r.job.publishedAt,
      events: r.history.map((h) => ({ to: h.toStatus, at: h.createdAt })),
    };
  });

  return {
    windowDays,
    generatedAt: now.toISOString(),
    applicationsInWindow: apps.length,
    truncated: rows.length >= MAX_APPLICATIONS,
    funnel: buildFunnel(apps),
    timing: buildTiming(apps, now),
    byCategory: buildByCategory(apps),
    matchQuality: buildMatchQuality(apps),
    autoApply: buildAutoApply(apps),
    growth: {
      weeks: GROWTH_WEEKS,
      newWorkers: weeklySeries(users.filter((u) => u.role === 'WORKER').map((u) => u.createdAt), GROWTH_WEEKS, now),
      newEmployers: weeklySeries(users.filter((u) => u.role === 'EMPLOYER').map((u) => u.createdAt), GROWTH_WEEKS, now),
      jobsPublished: weeklySeries(jobs.flatMap((j) => (j.publishedAt ? [j.publishedAt] : [])), GROWTH_WEEKS, now),
      applications: weeklySeries(appDates.map((a) => a.createdAt), GROWTH_WEEKS, now),
    },
    privacy: `Figures about groups smaller than ${K_MIN} are hidden (null). Platform-wide totals and weekly growth counts are not.`,
    caveats: [
      'The funnel counts the furthest stage each application reached, from its status history. Applications created before status history was recorded may undercount middle stages.',
      'Response and hiring times only include applications that have had a response or a hire yet, so they lean towards the faster cases while recent applications are still open.',
      'Hire rate by match score is observational: pay, timing and employer preferences also decide who is hired, so it does not prove the score causes better outcomes.',
      ...(rows.length >= MAX_APPLICATIONS ? [`Only the newest ${MAX_APPLICATIONS} applications in the window were analysed.`] : []),
    ],
  };
}
