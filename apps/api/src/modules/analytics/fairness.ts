// Fairness check for the employer worker search: of the people an employer sees first, are some groups under-shown?
//
// What it measures: the default order of the worker search is "most complete profile first, then most recently updated"
// (see searchWorkers in the talent module). This takes everyone who is visible and active, puts them in that order, and
// counts how many of each group fall in the first page of results. Each group's "shown rate" is compared with the best
// group's rate (the "four-fifths rule": a ratio under 0.8 is flagged for a human to look at).
//
// What it does NOT do: it says nothing about whether the people are equally suitable, it does not look at searches that
// are filtered or ranked against a job, and it cannot cover gender, age, ethnicity or disability because the platform
// does not collect them. Groups smaller than K_MIN people are not shown, so no row points at a handful of individuals.
import { prisma } from '../../lib/prisma';
import { EDUCATION_RANK } from '../matching/types';

export const FAIRNESS_K_MIN = 5;
export const FOUR_FIFTHS = 0.8;
/** The first page of results an employer sees by default (the talent search page size). */
export const FIRST_PAGE = 12;
const MIN_POOL = 30;

export interface FairnessPerson {
  completionPct: number;
  updatedAt: Date;
  yearsExperience: number;
  education: string | null; // highest education level recorded, null when none
  region: string | null;
}
export interface FairnessGroupRow { group: string; people: number; inFirstPage: number; shownRate: number; ratioToBest: number; flagged: boolean }
export interface FairnessReport {
  poolSize: number;
  firstPage: number;
  overallShownRate: number | null;
  attributes: { attribute: string; groups: FairnessGroupRow[]; hiddenSmallGroups: number }[];
  notes: string[];
}

const experienceBand = (y: number) => (y <= 2 ? '0-2 years' : y <= 5 ? '3-5 years' : '6+ years');
const educationBand = (e: string | null) => {
  if (!e || e === 'NONE') return 'No formal education recorded';
  const rank = EDUCATION_RANK[e as keyof typeof EDUCATION_RANK] ?? 0;
  if (rank <= EDUCATION_RANK.SECONDARY) return 'Primary or secondary';
  if (rank <= EDUCATION_RANK.VOCATIONAL_CERTIFICATE) return 'Vocational certificate';
  return 'Diploma or higher';
};
const completionBand = (p: number) => (p < 50 ? 'Profile under 50% complete' : p < 80 ? 'Profile 50-79% complete' : 'Profile 80%+ complete');

/** Pure calculation, so it can be tested without a database. */
export function fairnessReport(people: FairnessPerson[], firstPage = FIRST_PAGE): FairnessReport {
  const notes = [
    'This checks only the default order of the worker search (most complete profile first). Filtered searches and searches ranked against a job are not covered.',
    'It measures who is shown first, not who is more suitable. A gap is a reason to look, not proof of unfairness; a clean result is not proof of fairness.',
    'Gender, age, ethnicity and disability are not collected by the platform and are not evaluated.',
    `Groups with fewer than ${FAIRNESS_K_MIN} people are hidden. A ratio under ${FOUR_FIFTHS} (four-fifths rule) is flagged.`,
    'Profile completeness is the sort key itself, so a gap there is expected: it shows how much the ordering rewards a finished profile.',
  ];
  if (people.length < MIN_POOL) {
    return { poolSize: people.length, firstPage, overallShownRate: null, attributes: [], notes: [`Not enough visible workers yet (${people.length}, need ${MIN_POOL}) for the numbers to mean anything.`, ...notes] };
  }
  const ordered = [...people].sort((a, b) => b.completionPct - a.completionPct || b.updatedAt.getTime() - a.updatedAt.getTime());
  const top = new Set(ordered.slice(0, firstPage));
  const overall = top.size / ordered.length;

  const attrs: [string, (p: FairnessPerson) => string][] = [
    ['Education', (p) => educationBand(p.education)],
    ['Experience', (p) => experienceBand(p.yearsExperience)],
    ['Region', (p) => p.region ?? 'Region not set'],
    ['Profile completeness', (p) => completionBand(p.completionPct)],
  ];
  const attributes = attrs.map(([attribute, of]) => {
    const acc = new Map<string, { n: number; top: number }>();
    for (const p of ordered) {
      const g = of(p);
      const cur = acc.get(g) ?? { n: 0, top: 0 };
      cur.n++;
      if (top.has(p)) cur.top++;
      acc.set(g, cur);
    }
    const shown = [...acc.entries()].filter(([, v]) => v.n >= FAIRNESS_K_MIN);
    const best = Math.max(0, ...shown.map(([, v]) => v.top / v.n));
    const groups = shown
      .map(([group, v]) => {
        const rate = v.top / v.n;
        const ratio = best > 0 ? rate / best : 1;
        return { group, people: v.n, inFirstPage: v.top, shownRate: round(rate), ratioToBest: round(ratio), flagged: ratio < FOUR_FIFTHS };
      })
      .sort((a, b) => b.people - a.people);
    return { attribute, groups, hiddenSmallGroups: acc.size - shown.length };
  });
  return { poolSize: ordered.length, firstPage, overallShownRate: round(overall), attributes, notes };
}
const round = (n: number) => Math.round(n * 100) / 100;

export async function searchFairness(): Promise<FairnessReport> {
  const rows = await prisma.workerProfile.findMany({
    where: { isVisible: true, user: { status: 'ACTIVE' } },
    select: { completionPct: true, updatedAt: true, yearsExperience: true, locationId: true, education: { select: { level: true } } },
    take: 20_000,
  });
  const locs = await prisma.location.findMany({ select: { id: true, parentId: true, nameEn: true, level: true } });
  const byId = new Map(locs.map((l) => [l.id, l]));
  const regionOf = (id: string | null) => {
    let cur = id ? byId.get(id) : undefined;
    while (cur && cur.level !== 'REGION') cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    return cur?.nameEn ?? null;
  };
  const people = rows.map((r) => {
    const best = r.education.reduce<string | null>((acc, e) => (!acc || (EDUCATION_RANK[e.level as keyof typeof EDUCATION_RANK] ?? 0) > (EDUCATION_RANK[acc as keyof typeof EDUCATION_RANK] ?? 0) ? e.level : acc), null);
    return { completionPct: r.completionPct, updatedAt: r.updatedAt, yearsExperience: r.yearsExperience, education: best, region: regionOf(r.locationId) };
  });
  return fairnessReport(people);
}
