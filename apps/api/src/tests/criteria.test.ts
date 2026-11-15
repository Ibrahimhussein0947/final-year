import { describe, expect, it } from 'vitest';
import { criteriaComponent, evaluateCriterion, type JobCriterionFeature } from '../modules/matching/criteria';
import { matchPair, recommendable } from '../modules/matching/scorer';
import { parseStoredWeights } from '../modules/matching/weights';
import { DEFAULT_WEIGHTS, type JobFeatures, type WorkerFeatures } from '../modules/matching/types';
import { jobs, workers } from '../evaluation/dataset';

const NOW = new Date('2026-11-01T00:00:00Z');
const REL = new Map();
// Truck driver job and a truck driver, with the benchmark's own sector criteria removed: these tests add their own.
const job0: JobFeatures = { ...jobs.find((j) => j.features.id === 'J11')!.features, criteria: undefined };
const w34: WorkerFeatures = { ...workers.find((w) => w.features.id === 'W34')!.features, criteria: undefined };

const crit = (over: Partial<JobCriterionFeature> & Pick<JobCriterionFeature, 'id' | 'type' | 'requirement'>): JobCriterionFeature => ({
  key: over.id, label: over.label ?? `Criterion ${over.id}`, importance: 'PREFERRED', ...over,
});
const withJob = (criteria: JobCriterionFeature[]): JobFeatures => ({ ...job0, criteria });
const withWorker = (values: WorkerFeatures['criteria']): WorkerFeatures => ({ ...w34, criteria: values });
const have = (value: unknown, verified = false) => ({ value, verified });

describe('evaluateCriterion', () => {
  it('BOOLEAN: true meets, false does not, missing is unknown (never a failure)', () => {
    const c = crit({ id: 'a', type: 'BOOLEAN', requirement: { equals: true } });
    expect(evaluateCriterion(c, have(true)).state).toBe('met');
    expect(evaluateCriterion(c, have(false)).state).toBe('unmet');
    expect(evaluateCriterion(c, undefined).state).toBe('unknown');
    expect(evaluateCriterion(c, have('yes')).state).toBe('unknown'); // wrong type stored: not a pass, not a fail
  });
  it('NUMBER: meets the minimum, earns partial credit below it, unmet at zero', () => {
    const c = crit({ id: 'n', type: 'NUMBER', requirement: { min: 4 } });
    expect(evaluateCriterion(c, have(5)).state).toBe('met');
    expect(evaluateCriterion(c, have(2))).toEqual({ state: 'partial', fraction: 0.5 });
    expect(evaluateCriterion(c, have(0)).state).toBe('unmet');
  });
  it('CHOICE: value must be one of the allowed options', () => {
    const c = crit({ id: 'c', type: 'CHOICE', requirement: { oneOf: ['good', 'fluent'] } });
    expect(evaluateCriterion(c, have('fluent')).state).toBe('met');
    expect(evaluateCriterion(c, have('basic')).state).toBe('unmet');
    expect(evaluateCriterion(crit({ id: 'c', type: 'CHOICE', requirement: { oneOf: [] } }), have('x')).state).toBe('unknown');
  });
  it('MULTI_CHOICE: all required options met, some = partial, none = unmet', () => {
    const c = crit({ id: 'm', type: 'MULTI_CHOICE', requirement: { allOf: ['truck', 'trailer'] } });
    expect(evaluateCriterion(c, have(['truck', 'trailer', 'light'])).state).toBe('met');
    expect(evaluateCriterion(c, have(['truck']))).toEqual({ state: 'partial', fraction: 0.5 });
    expect(evaluateCriterion(c, have(['light'])).state).toBe('unmet');
  });
});

describe('criteriaComponent and eligibility', () => {
  const licence = crit({ id: 'lic', type: 'MULTI_CHOICE', requirement: { allOf: ['truck'] }, importance: 'MUST_HAVE', label: 'Heavy truck licence' });
  const record = crit({ id: 'rec', type: 'BOOLEAN', requirement: { equals: true }, label: 'Clean record' });

  it('is not applicable (null, no reason to worry) when the job has no sector requirements', () => {
    const r = criteriaComponent(undefined, {});
    expect(r.score).toBeNull();
    expect(r.detail.eligibility).toBe('n/a');
  });
  it('unanswered criteria are left out of the score and reported, not counted as zero', () => {
    const r = criteriaComponent([licence, record], { lic: have(['truck']) });
    expect(r.score).toBe(1); // only the answered, met criterion is scored
    expect(r.detail.unknown.map((u) => u.label)).toEqual(['Clean record']);
    expect(r.note).toContain('1 of 2');
    expect(r.note).toContain('1 not answered');
  });
  it('a known-unmet MUST_HAVE makes the person not eligible; an unanswered one makes it unknown', () => {
    expect(criteriaComponent([licence], { lic: have(['light']) }).detail.eligibility).toBe('not_eligible');
    expect(criteriaComponent([licence], {}).detail.eligibility).toBe('unknown');
    expect(criteriaComponent([licence], { lic: have(['truck']) }).detail.eligibility).toBe('eligible');
    expect(criteriaComponent([record], { rec: have(false) }).detail.eligibility).toBe('n/a'); // PREFERRED only: never blocks
  });
  it('must-have counts double the weight of a preference in the score', () => {
    const r = criteriaComponent([licence, record], { lic: have(['truck']), rec: have(false) });
    expect(r.score).toBeCloseTo(1 / 1.5, 6);
  });
  it('reports verification status of met criteria', () => {
    const r = criteriaComponent([licence], { lic: have(['truck'], true) });
    expect(r.detail.met).toEqual([{ label: 'Heavy truck licence', verified: true }]);
  });
});

describe('criteria inside the match', () => {
  const licence = crit({ id: 'lic', type: 'MULTI_CHOICE', requirement: { allOf: ['truck'] }, importance: 'MUST_HAVE', label: 'Heavy truck licence' });

  it('jobs without sector criteria score and report confidence exactly as before', () => {
    const plain = matchPair(job0, w34, DEFAULT_WEIGHTS, REL, NOW);
    const emptyList = matchPair({ ...job0, criteria: [] }, { ...w34, criteria: {} }, DEFAULT_WEIGHTS, REL, NOW);
    expect(emptyList).toEqual(plain);
    expect(plain.eligibility).toBe('n/a');
    expect(plain.notAssessed.map((n) => n.component)).not.toContain('criteria');
  });

  it('a person who lacks a must-have licence is rated weak, flagged, and not recommended, whatever else they have', () => {
    const r = matchPair(withJob([licence]), withWorker({ lic: have(['light']) }), DEFAULT_WEIGHTS, REL, NOW);
    expect(r.eligibility).toBe('not_eligible');
    expect(r.strength).toBe('weak');
    expect(r.score).toBeLessThanOrEqual(39); // limited, so it cannot sit near the top of a list sorted by score
    expect(r.explanation).toContain('Does not meet a required condition: Heavy truck licence');
    expect(r.explanation).toMatch(/limited to 39; it would be \d/);
    expect(r.explanation.startsWith('Not eligible:')).toBe(true);
    expect(recommendable(r)).toBe(false);
  });

  it('an unanswered must-have keeps the person visible but unconfirmed (never "strong")', () => {
    const r = matchPair(withJob([licence]), withWorker({}), DEFAULT_WEIGHTS, REL, NOW);
    expect(r.eligibility).toBe('unknown');
    expect(r.strength).not.toBe('strong');
    expect(r.explanation).toContain('Not yet confirmed: Heavy truck licence');
    expect(recommendable(r)).toBe(true);
  });

  it('a verified match is eligible, and the explanation says answers are self-reported otherwise', () => {
    const verified = matchPair(withJob([licence]), withWorker({ lic: have(['truck'], true) }), DEFAULT_WEIGHTS, REL, NOW);
    expect(verified.eligibility).toBe('eligible');
    expect(verified.explanation).not.toContain('self-reported');
    const selfReported = matchPair(withJob([licence]), withWorker({ lic: have(['truck'], false) }), DEFAULT_WEIGHTS, REL, NOW);
    expect(selfReported.explanation).toContain('self-reported');
  });

  it('the criteria component carries weight only when assessed and changes the score in the right direction', () => {
    const base = matchPair(job0, w34, DEFAULT_WEIGHTS, REL, NOW).score;
    const pref = crit({ id: 'rec', type: 'BOOLEAN', requirement: { equals: true } });
    const good = matchPair(withJob([pref]), withWorker({ rec: have(true) }), DEFAULT_WEIGHTS, REL, NOW).score;
    const bad = matchPair(withJob([pref]), withWorker({ rec: have(false) }), DEFAULT_WEIGHTS, REL, NOW).score;
    expect(good).toBeGreaterThanOrEqual(base);
    expect(bad).toBeLessThan(base);
  });
});

describe('weights saved before sector criteria existed', () => {
  it('keep their ratios and give criteria the default share; invalid data is rejected', () => {
    const legacy = { skills: 0.35, experience: 0.2, location: 0.15, qualification: 0.1, availability: 0.1, preferences: 0.1 };
    const w = parseStoredWeights(legacy)!;
    expect(w.criteria).toBe(DEFAULT_WEIGHTS.criteria);
    expect(Object.values(w).reduce((s, n) => s + n, 0)).toBeCloseTo(1, 2);
    expect(w.skills / w.experience).toBeCloseTo(0.35 / 0.2, 1);
    expect(parseStoredWeights({ skills: 1 })).toBeNull();
    expect(parseStoredWeights(DEFAULT_WEIGHTS)).toEqual(DEFAULT_WEIGHTS);
  });
});
