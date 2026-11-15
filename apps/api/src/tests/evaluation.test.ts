import { describe, expect, it } from 'vitest';
import { bootstrapDiffCI, coverage, mean, ndcgAtK, percentile, precisionAtK, recallAtK, reciprocalRank } from '../evaluation/metrics';
import { bm25Rank, tokenize } from '../evaluation/keyword';
import { jobs, workers } from '../evaluation/dataset';
import { matchPair, recommendable } from '../modules/matching/scorer';
import { DEFAULT_WEIGHTS } from '../modules/matching/types';

const g = { a: 3, b: 2, c: 1 };

describe('ranking metrics (hand-computed)', () => {
  it('precision divides by K even for short lists', () => {
    expect(precisionAtK(['a', 'x', 'b'], g, 3)).toBeCloseTo(2 / 3);
    expect(precisionAtK(['a'], g, 5)).toBeCloseTo(1 / 5);
  });
  it('recall counts relevant (grade>=2) found; null when none exist', () => {
    expect(recallAtK(['a', 'x'], g, 2)).toBeCloseTo(0.5);
    expect(recallAtK(['a'], { c: 1 }, 5)).toBeNull();
  });
  it('NDCG is 1 for the ideal order, lower otherwise, null with no graded items', () => {
    expect(ndcgAtK(['a', 'b', 'c'], g, 3)).toBeCloseTo(1);
    // gains: 7,3,1 ideal -> 7 + 3/log2(3) + 1/2 ; swapped first two -> 3 + 7/log2(3) + 1/2
    const ideal = 7 + 3 / Math.log2(3) + 0.5;
    const swapped = 3 + 7 / Math.log2(3) + 0.5;
    expect(ndcgAtK(['b', 'a', 'c'], g, 3)).toBeCloseTo(swapped / ideal, 6);
    expect(ndcgAtK(['a'], {}, 3)).toBeNull();
  });
  it('reciprocal rank', () => {
    expect(reciprocalRank(['x', 'b'], g)).toBeCloseTo(0.5);
    expect(reciprocalRank(['x', 'y'], g)).toBe(0);
    expect(reciprocalRank(['a'], { c: 1 })).toBeNull();
  });
  it('coverage, mean and percentile', () => {
    expect(coverage([['a', 'b'], ['b']], ['a', 'b', 'c', 'd'])).toBe(0.5);
    expect(mean([1, null, 3])).toBe(2);
    expect(mean([null])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });
  it('bootstrap interval is deterministic and brackets a constant difference', () => {
    const a = bootstrapDiffCI([0.1, 0.1, 0.1, 0.1]);
    expect(a).toEqual(bootstrapDiffCI([0.1, 0.1, 0.1, 0.1]));
    expect(a.low).toBeCloseTo(0.1);
    expect(bootstrapDiffCI([-0.2, 0.2, -0.1, 0.1]).low).toBeLessThan(0);
  });
});

describe('keyword baseline', () => {
  it('tokenizes with stop words and light stemming', () => {
    expect(tokenize('The welders are welding')).toEqual(tokenize('welder welding'));
  });
  it('ranks the document sharing the rare terms first, deterministically', () => {
    const docs = [{ id: 'b', text: 'baker of bread' }, { id: 'a', text: 'engine repair mechanic' }, { id: 'c', text: 'driver' }];
    expect(bm25Rank('mechanic for engine repair', docs)[0]).toBe('a');
    expect(bm25Rank('zzz', docs)).toEqual(['a', 'b', 'c']);
  });
});

describe('benchmark data integrity', () => {
  it('every graded worker exists and grades are 1..3', () => {
    const ids = new Set(workers.map((w) => w.features.id));
    for (const j of jobs) for (const [id, v] of Object.entries(j.grades)) { expect(ids.has(id)).toBe(true); expect([1, 2, 3]).toContain(v); }
  });
  it('ids are unique and every job has at least one relevant worker', () => {
    expect(new Set(workers.map((w) => w.features.id)).size).toBe(workers.length);
    for (const j of jobs) expect(Object.values(j.grades).some((v) => v >= 2)).toBe(true);
  });
});

describe('profiles without listed skills are not recommended for jobs with required skills', () => {
  it('W44/W45 (no skills) fail the recommendable filter for a welding job', () => {
    const job = jobs.find((j) => j.features.id === 'J02')!;
    for (const id of ['W44', 'W45']) {
      const r = matchPair(job.features, workers.find((w) => w.features.id === id)!.features, DEFAULT_WEIGHTS, new Map());
      expect(r.requiredCoverage.covered).toBe(0);
      expect(recommendable(r)).toBe(false);
    }
  });
});
