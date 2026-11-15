/**
 * Ranking metrics. A ranking is a list of candidate ids, best first. `grades` maps candidate id -> graded
 * relevance (0..3). Candidates missing from `grades` count as grade 0.
 *
 * "Relevant" for precision/recall/MRR means grade >= RELEVANT_GRADE.
 */
export const RELEVANT_GRADE = 2;

export type Grades = Record<string, number>;

const grade = (g: Grades, id: string) => g[id] ?? 0;
const isRelevant = (g: Grades, id: string) => grade(g, id) >= RELEVANT_GRADE;
export const totalRelevant = (g: Grades) => Object.values(g).filter((v) => v >= RELEVANT_GRADE).length;

/** Share of the top K that is relevant. Divides by K even when fewer than K were returned (a short list is not rewarded). */
export function precisionAtK(ranking: string[], g: Grades, k: number): number {
  if (k <= 0) return 0;
  return ranking.slice(0, k).filter((id) => isRelevant(g, id)).length / k;
}

/** Share of all relevant candidates found in the top K. null when nobody is relevant (undefined, not zero). */
export function recallAtK(ranking: string[], g: Grades, k: number): number | null {
  const total = totalRelevant(g);
  if (total === 0) return null;
  return ranking.slice(0, k).filter((id) => isRelevant(g, id)).length / total;
}

/** Gain 2^grade - 1, discounted by log2(rank + 1), divided by the best possible ordering. null when nobody has grade > 0. */
export function ndcgAtK(ranking: string[], g: Grades, k: number): number | null {
  const gain = (v: number) => 2 ** v - 1;
  const dcg = ranking.slice(0, k).reduce((s, id, i) => s + gain(grade(g, id)) / Math.log2(i + 2), 0);
  const ideal = Object.values(g).filter((v) => v > 0).sort((a, b) => b - a).slice(0, k)
    .reduce((s, v, i) => s + gain(v) / Math.log2(i + 2), 0);
  return ideal === 0 ? null : dcg / ideal;
}

/** 1 / rank of the first relevant candidate; 0 if none is ranked; null if nobody is relevant. */
export function reciprocalRank(ranking: string[], g: Grades): number | null {
  if (totalRelevant(g) === 0) return null;
  const i = ranking.findIndex((id) => isRelevant(g, id));
  return i === -1 ? 0 : 1 / (i + 1);
}

/** Fraction of candidates that appear in at least one list (how much of the catalogue the system can ever surface). */
export function coverage(lists: string[][], universe: string[]): number {
  if (universe.length === 0) return 0;
  const seen = new Set(lists.flat());
  return universe.filter((id) => seen.has(id)).length / universe.length;
}

export const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
};

/** Percentile (nearest rank) of a list of durations. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/**
 * Paired bootstrap confidence interval for the mean of per-query differences (A - B), so a small gain
 * is not reported as a real one. Deterministic (seeded) so the report is reproducible.
 */
export function bootstrapDiffCI(diffs: number[], iterations = 2000, seed = 7): { mean: number; low: number; high: number } {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const n = diffs.length;
  if (n === 0) return { mean: 0, low: 0, high: 0 };
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += diffs[Math.floor(rnd() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { mean: diffs.reduce((a, b) => a + b, 0) / n, low: means[Math.floor(0.025 * iterations)], high: means[Math.floor(0.975 * iterations)] };
}
