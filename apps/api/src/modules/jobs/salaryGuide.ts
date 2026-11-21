import { z } from 'zod';
import { prisma } from '../../lib/prisma';

/**
 * "People doing this kind of work around here are offered X to Y." Built only from the pay posted on real jobs in the
 * same category, over the last 12 months, using the narrowest area that has enough jobs. It shows the middle half
 * (25th to 75th percentile) and the median, never one employer's number, and shows nothing below MIN_SAMPLE jobs.
 * It is what employers offered, not what workers were paid, and the pay period is not recorded (monthly is assumed).
 */
export const MIN_SAMPLE = 5;
const WINDOW_DAYS = 365;
const POOL = 3000;

export const salaryGuideQuery = z.object({ categoryId: z.string().uuid(), locationId: z.string().uuid().optional() }).strict();

/** Linear-interpolated percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** One number per job: the middle of its range, or the single figure it states. */
export const offered = (min: number | null, max: number | null): number | null => (min !== null && max !== null ? (min + max) / 2 : min ?? max);

const round50 = (n: number) => Math.round(n / 50) * 50;

export function summarize(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return { sample: s.length, low: round50(percentile(s, 0.25)), median: round50(percentile(s, 0.5)), high: round50(percentile(s, 0.75)) };
}

type Loc = { id: string; level: string; nameEn: string; parent: Loc | null } | null;

export async function salaryGuide(input: z.infer<typeof salaryGuideQuery>) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const jobs = await prisma.job.findMany({
    where: {
      categoryId: input.categoryId, status: { in: ['ACTIVE', 'CLOSED', 'FILLED'] }, currency: 'ETB',
      OR: [{ salaryMin: { not: null } }, { salaryMax: { not: null } }], publishedAt: { gte: since },
    },
    select: { salaryMin: true, salaryMax: true, location: { select: { id: true, level: true, nameEn: true, parent: { select: { id: true, level: true, nameEn: true, parent: { select: { id: true, level: true, nameEn: true, parent: { select: { id: true, level: true, nameEn: true } } } } } } } } },
    take: POOL,
  });
  const rows = jobs.flatMap((j) => { const v = offered(j.salaryMin, j.salaryMax); return v === null || v <= 0 ? [] : [{ v, loc: j.location as Loc }]; });
  const ancestors = (l: Loc): string[] => (l ? [l.id, ...ancestors(l.parent)] : []);

  // Narrowest area first (the person's own place, then up to the region), then the whole country.
  const chain: { id: string; level: string; name: string }[] = [];
  if (input.locationId) {
    for (let cur = await prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true, level: true, nameEn: true, parentId: true } }); cur;
      cur = cur.parentId ? await prisma.location.findUnique({ where: { id: cur.parentId }, select: { id: true, level: true, nameEn: true, parentId: true } }) : null) {
      if (cur.level !== 'KEBELE') chain.push({ id: cur.id, level: cur.level, name: cur.nameEn });
    }
  }
  for (const area of chain) {
    const inArea = rows.filter((r) => ancestors(r.loc).includes(area.id));
    if (inArea.length >= MIN_SAMPLE) return { available: true as const, currency: 'ETB', scope: { level: area.level, name: area.name }, ...summarize(inArea.map((r) => r.v)) };
  }
  if (rows.length >= MIN_SAMPLE) return { available: true as const, currency: 'ETB', scope: { level: 'COUNTRY', name: 'Ethiopia' }, ...summarize(rows.map((r) => r.v)) };
  return { available: false as const, sample: rows.length, needed: MIN_SAMPLE };
}
