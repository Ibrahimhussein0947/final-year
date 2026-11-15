import { describe, expect, it } from 'vitest';
import { haversineKm, relevantYears } from '../modules/matching/components';
import { matchPair, strengthOf } from '../modules/matching/scorer';
import { DEFAULT_WEIGHTS, type JobFeatures, type RelationMap, type WorkerFeatures } from '../modules/matching/types';

const NOW = new Date('2026-06-01T00:00:00Z');

const job = (over: Partial<JobFeatures> = {}): JobFeatures => ({
  id: 'j1', categoryId: 'cat-auto', employmentType: 'FULL_TIME', workMode: 'ON_SITE',
  minExperienceYears: 3, requiredEducationLevel: null, salaryMin: 6000, salaryMax: 9000, startDate: null,
  lat: null, lng: null, locationPath: ['R1', 'Z1'], embedding: null,
  skills: [
    { skillId: 'engine', name: 'Engine Repair', importance: 'REQUIRED', minProficiency: null },
    { skillId: 'brakes', name: 'Brake Systems', importance: 'REQUIRED', minProficiency: null },
    { skillId: 'welding', name: 'Welding', importance: 'PREFERRED', minProficiency: null },
  ],
  ...over,
});

const worker = (over: Partial<WorkerFeatures> = {}): WorkerFeatures => ({
  id: 'w1', categoryId: 'cat-auto', yearsExperience: 5, experiences: [], educationLevels: [], certificationCount: 0,
  skills: [{ skillId: 'engine', name: 'Engine Repair', proficiency: 4 }, { skillId: 'brakes', name: 'Brake Systems', proficiency: 4 }],
  availability: 'IMMEDIATELY', availableFrom: null, lat: null, lng: null, maxTravelKm: null, willingToRelocate: false,
  locationPath: ['R1', 'Z1'], preferredTypes: ['FULL_TIME'], preferredWorkModes: [], expectedSalaryMin: 6000, expectedSalaryMax: 8000,
  embedding: null,
  ...over,
});

const relations: RelationMap = new Map([
  ['brakes', new Map([['engine', 0.5], ['panel', 0.3]])],
  ['engine', new Map([['brakes', 0.5]])],
]);

const score = (j = job(), w = worker(), weights = DEFAULT_WEIGHTS) => matchPair(j, w, weights, relations, NOW);

describe('overall score', () => {
  it('matches a hand calculation, with missing components renormalized', () => {
    // skills (2 of 2.5 weight) .8, experience 1, location .95, availability 1, preferences 1, qualification not assessed
    // = (.35*.8 + .2*1 + .15*.95 + .1*1 + .1*1) / .9 = .8225 / .9
    const r = score();
    expect(r.score).toBe(91.4);
    expect(r.confidence).toBe(0.9);
    expect(r.strength).toBe('strong');
    expect(r.components.skills.score).toBe(0.8);
    expect(r.components.location.score).toBe(0.95);
    expect(r.notAssessed.map((n) => n.component)).toEqual(['qualification']);
  });

  it('is deterministic and always within 0..100', () => {
    expect(score()).toEqual(score());
    for (const w of [worker({ skills: [] }), worker({ availability: 'NOT_AVAILABLE' }), worker({ locationPath: ['R9'] })]) {
      const r = score(job(), w);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('can reach 100 for a perfect fit', () => {
    const r = score(job({ skills: [{ skillId: 'engine', name: 'Engine Repair', importance: 'REQUIRED', minProficiency: null }], salaryMin: null, salaryMax: null }), worker({ preferredTypes: [], expectedSalaryMin: null, expectedSalaryMax: null, locationPath: ['R1', 'Z1', 'W1'] }));
    expect(r.score).toBeGreaterThan(95);
  });

  it('follows the configured weights', () => {
    const skillsOnly = { skills: 1, experience: 0, location: 0, qualification: 0, availability: 0, preferences: 0, criteria: 0 };
    expect(score(job(), worker(), skillsOnly).score).toBe(80);
    const locationOnly = { skills: 0, experience: 0, location: 1, qualification: 0, availability: 0, preferences: 0, criteria: 0 };
    expect(score(job(), worker(), locationOnly).score).toBe(95);
  });

  it('reports zero confidence, not an invented score, when nothing can be assessed', () => {
    const r = score(
      job({ skills: [], minExperienceYears: null, locationPath: [], salaryMin: null, salaryMax: null }),
      worker({ locationPath: [], preferredTypes: [], expectedSalaryMin: null, expectedSalaryMax: null, availability: 'IMMEDIATELY' }),
    );
    // availability is always assessable, experience has a neutral base, so confidence is not zero here:
    expect(r.confidence).toBeGreaterThan(0);
    const weightsOnlyMissing = { skills: 1, experience: 0, location: 0, qualification: 0, availability: 0, preferences: 0, criteria: 0 };
    const none = score(job({ skills: [] }), worker(), weightsOnlyMissing);
    expect(none.confidence).toBe(0);
    expect(none.score).toBe(0);
  });

  it('labels strength bands', () => {
    expect([90, 80, 79.9, 60, 59.9, 40, 39.9, 0].map(strengthOf)).toEqual(['strong', 'strong', 'good', 'good', 'partial', 'partial', 'weak', 'weak']);
  });
});

describe('required skills gate the label', () => {
  const otherSkills = [{ skillId: 'other', name: 'Cooking', proficiency: 5 }];

  it('caps the label at partial when none of the required skills are covered, but keeps the formula score', () => {
    const r = score(job(), worker({ skills: otherSkills, yearsExperience: 10 }));
    expect(r.score).toBeGreaterThanOrEqual(60); // experience, location and availability alone lift the number
    expect(r.strength).toBe('partial');
    expect(r.requiredCoverage).toEqual({ required: 2, covered: 0 });
    expect(r.explanation).toMatch(/^Partial match/);
    expect(r.explanation).toContain('None of the required skills are listed');
  });

  it('does not cap when a required skill is covered, exactly or through a related skill', () => {
    const exact = score(job(), worker({ skills: [{ skillId: 'engine', name: 'Engine Repair', proficiency: 4 }] }));
    expect(exact.requiredCoverage).toEqual({ required: 2, covered: 2 }); // brakes is covered through engine
    expect(exact.explanation).not.toContain('None of the required');
    const relatedOnly = score(job(), worker({ skills: [{ skillId: 'panel', name: 'Panel Beating', proficiency: 4 }] }));
    expect(relatedOnly.requiredCoverage).toEqual({ required: 2, covered: 1 });
  });

  it('does not apply when the job has no required skills or the worker lists no skills', () => {
    expect(score(job({ skills: [{ skillId: 'welding', name: 'Welding', importance: 'PREFERRED', minProficiency: null }] }), worker({ skills: otherSkills })).requiredCoverage).toEqual({ required: 0, covered: 0 });
    expect(score(job(), worker({ skills: [] })).explanation).not.toContain('None of the required');
  });
});

describe('skills', () => {
  it('gives related skills partial credit and names them', () => {
    const w = worker({ skills: [{ skillId: 'engine', name: 'Engine Repair', proficiency: 4 }] });
    const r = score(job(), w);
    // engine 1 + brakes via engine .5 + welding 0 = 1.5 of 2.5
    expect(r.components.skills.score).toBe(0.6);
    expect(r.relatedSkills).toEqual([{ required: 'Brake Systems', has: 'Engine Repair', credit: 0.5 }]);
    expect(r.matchedSkills).toEqual(['Engine Repair']);
    expect(r.missingSkills).toEqual([]);
    expect(r.explanation).toContain('1 of 2 required skills (1 more through related skills)');
  });

  it('lists required skills the worker lacks', () => {
    const r = score(job(), worker({ skills: [{ skillId: 'other', name: 'Cooking', proficiency: 5 }] }));
    expect(r.components.skills.score).toBe(0);
    expect(r.missingSkills).toEqual(['Engine Repair', 'Brake Systems']);
  });

  it('scales credit down when the worker is below the required level', () => {
    const j = job({ skills: [{ skillId: 'engine', name: 'Engine Repair', importance: 'REQUIRED', minProficiency: 4 }] });
    expect(score(j, worker({ skills: [{ skillId: 'engine', name: 'Engine Repair', proficiency: 2 }] })).components.skills.score).toBe(0.5);
    expect(score(j, worker({ skills: [{ skillId: 'engine', name: 'Engine Repair', proficiency: 5 }] })).components.skills.score).toBe(1);
  });

  it('is not assessed (never zero) when the worker lists no skills or the job lists none', () => {
    const noWorkerSkills = score(job(), worker({ skills: [] }));
    expect(noWorkerSkills.components.skills.score).toBeNull();
    expect(noWorkerSkills.notAssessed.find((n) => n.component === 'skills')?.reason).toMatch(/not listed any skills/);
    expect(noWorkerSkills.confidence).toBeLessThan(0.7);
    expect(score(job({ skills: [] })).components.skills.score).toBeNull();
  });
});

describe('experience', () => {
  it('does not penalize inexperience when the job has no minimum', () => {
    const j = job({ minExperienceYears: null });
    expect(score(j, worker({ yearsExperience: 0 })).components.experience.score).toBe(0.7);
    expect(score(j, worker({ yearsExperience: 5 })).components.experience.score).toBe(1);
    expect(score(j, worker({ yearsExperience: 0 })).components.experience.note).toContain('no minimum');
  });

  it('measures progress towards a stated minimum', () => {
    expect(score(job(), worker({ yearsExperience: 1 })).components.experience.score).toBeCloseTo(0.333, 2);
    expect(score(job(), worker({ yearsExperience: 3 })).components.experience.score).toBe(1);
    expect(score(job(), worker({ yearsExperience: 20 })).components.experience.score).toBe(1);
  });

  it('counts work history in the job category and discounts other fields', () => {
    const w = worker({ yearsExperience: 0, categoryId: null, experiences: [
      { categoryId: 'cat-auto', start: new Date('2022-06-01T00:00:00Z'), end: new Date('2024-06-01T00:00:00Z') },
      { categoryId: 'cat-cook', start: new Date('2010-01-01T00:00:00Z'), end: new Date('2020-01-01T00:00:00Z') },
    ] });
    expect(relevantYears(job(), w, NOW)).toBe(2);
    expect(relevantYears(job(), worker({ yearsExperience: 10, categoryId: 'cat-cook' }), NOW)).toBe(4); // 40% transferable
  });
});

describe('location', () => {
  it('computes real distances', () => {
    const km = haversineKm(9.03, 38.74, 8.54, 39.27); // Addis Ababa to Adama
    expect(km).toBeGreaterThan(70);
    expect(km).toBeLessThan(95);
  });

  it('scores by distance against the worker travel limit', () => {
    const at = (lat: number, lng: number, over: Partial<WorkerFeatures> = {}) =>
      score(job({ lat: 9.0, lng: 38.7 }), worker({ lat, lng, maxTravelKm: 20, ...over }));
    expect(at(9.0, 38.7).components.location.score).toBe(1);
    expect(at(9.0, 38.7).distanceKm).toBe(0);
    expect(at(9.0, 38.7).components.location.note).toContain('within 1 km');
    const near = at(9.08, 38.7); // ~9 km
    expect(near.components.location.score).toBe(1);
    const edge = at(9.16, 38.7); // ~17.8 km of a 20 km limit: 1 - 0.5 * (17.8 - 10) / 10 = 0.61
    expect(edge.distanceKm).toBe(18);
    expect(edge.components.location.score!).toBeLessThan(0.65);
    expect(edge.components.location.score!).toBeGreaterThan(0.5);
    const far = at(9.8, 38.7); // ~89 km
    expect(far.components.location.score!).toBeLessThan(0.1);
    expect(at(9.8, 38.7, { willingToRelocate: true }).components.location.score).toBe(0.4);
    expect(far.components.location.note).toContain('beyond their travel limit');
  });

  it('reports whole-kilometre distance only', () => {
    const r = score(job({ lat: 9.0, lng: 38.7 }), worker({ lat: 9.0123456, lng: 38.7654321 }));
    expect(Number.isInteger(r.distanceKm)).toBe(true);
  });

  it('is always 1 for remote jobs', () => {
    expect(score(job({ workMode: 'REMOTE', locationPath: [] }), worker({ locationPath: ['R9'] })).components.location.score).toBe(1);
  });

  it('falls back to administrative areas', () => {
    const loc = (jobPath: string[], workerPath: string[], over: Partial<WorkerFeatures> = {}) =>
      score(job({ locationPath: jobPath }), worker({ locationPath: workerPath, ...over })).components.location.score;
    expect(loc(['R1', 'Z1', 'W1'], ['R1', 'Z1', 'W1'])).toBe(1);
    expect(loc(['R1', 'Z1'], ['R1', 'Z1'])).toBe(0.95);
    expect(loc(['R1', 'Z1'], ['R1', 'Z2'])).toBe(0.5);
    expect(loc(['R1', 'Z1', 'W1'], ['R1', 'Z1', 'W2'])).toBe(0.8);
    expect(loc(['R1'], ['R2'])).toBe(0.05);
    expect(loc(['R1'], ['R2'], { willingToRelocate: true })).toBe(0.3);
  });

  it('is not assessed when either side has no location', () => {
    expect(score(job({ locationPath: [] })).components.location.score).toBeNull();
    expect(score(job(), worker({ locationPath: [] })).components.location.score).toBeNull();
  });

  it('keeps hybrid jobs from scoring below 0.5', () => {
    expect(score(job({ workMode: 'HYBRID', locationPath: ['R1'] }), worker({ locationPath: ['R2'] })).components.location.score).toBe(0.5);
  });
});

describe('qualification', () => {
  it('is skipped when the job requires none', () => {
    expect(score().components.qualification.score).toBeNull();
  });

  it('compares education levels', () => {
    const j = job({ requiredEducationLevel: 'BACHELOR' });
    // A worker whose skills do not match the job, so the practical-skills substitute cannot apply.
    const noPractical = { skills: [{ skillId: 'other', name: 'Cooking', proficiency: 3 }] };
    const q = (over: Partial<WorkerFeatures>) => score(j, worker({ ...noPractical, ...over })).components.qualification.score;
    expect(q({ educationLevels: ['MASTER'] })).toBe(1);
    expect(q({ educationLevels: ['DIPLOMA'] })).toBe(0.75);
    expect(q({ educationLevels: ['SECONDARY'] })).toBe(0.25);
    expect(q({ educationLevels: ['DIPLOMA'], certificationCount: 1 })).toBe(0.85);
    // The default fixture worker is practically strong (2 of 2 required skills, 5 years), so the substitute lifts a diploma to 0.8.
    expect(score(j, worker({ educationLevels: ['DIPLOMA'] })).components.qualification.score).toBe(0.8);
  });

  it('lets practical skill and experience stand in for a certificate', () => {
    const j = job({ requiredEducationLevel: 'DIPLOMA' });
    const strong = worker({ skills: [{ skillId: 'engine', name: 'Engine Repair', proficiency: 5 }, { skillId: 'brakes', name: 'Brake Systems', proficiency: 5 }, { skillId: 'welding', name: 'Welding', proficiency: 5 }], yearsExperience: 6 });
    expect(score(j, strong).components.qualification.score).toBe(0.8);
    expect(score(j, strong).components.qualification.note).toContain('practical');
    // not enough practical evidence: unknown, not zero
    expect(score(j, worker({ yearsExperience: 1 })).components.qualification.score).toBeNull();
  });
});

describe('availability', () => {
  it('rewards being ready when the job starts', () => {
    const start = new Date('2026-06-20T00:00:00Z'); // 19 days after NOW
    expect(score(job({ startDate: start }), worker({ availability: 'IMMEDIATELY' })).components.availability.score).toBe(1);
    expect(score(job({ startDate: start }), worker({ availability: 'WITHIN_TWO_WEEKS' })).components.availability.score).toBe(1);
    const late = score(job({ startDate: start }), worker({ availability: 'WITHIN_ONE_MONTH' })).components.availability.score!;
    expect(late).toBeCloseTo(1 - 11 / 30, 2);
  });

  it('respects an explicit available-from date and unavailability', () => {
    const start = new Date('2026-06-10T00:00:00Z');
    const r = score(job({ startDate: start }), worker({ availableFrom: new Date('2026-07-10T00:00:00Z') }));
    expect(r.components.availability.score).toBeLessThan(0.2 + 0.001);
    expect(score(job(), worker({ availability: 'NOT_AVAILABLE' })).components.availability.score).toBe(0);
  });

  it('uses simple levels when the job has no start date', () => {
    const v = (a: WorkerFeatures['availability']) => score(job(), worker({ availability: a })).components.availability.score;
    expect([v('IMMEDIATELY'), v('FLEXIBLE'), v('WITHIN_TWO_WEEKS'), v('WITHIN_ONE_MONTH')]).toEqual([1, 0.9, 0.85, 0.7]);
  });
});

describe('salary and preferences', () => {
  it('checks salary fit, job type and work arrangement', () => {
    expect(score().components.preferences.score).toBe(1);
    const underpaid = score(job({ salaryMin: 2000, salaryMax: 3000 }), worker({ expectedSalaryMin: 6000, expectedSalaryMax: 8000, preferredTypes: [] }));
    expect(underpaid.components.preferences.score).toBeCloseTo(0.5, 2); // 1 - (6000-3000)/6000
    expect(score(job(), worker({ preferredTypes: ['DAILY'] })).components.preferences.score).toBe((1 + 0.3) / 2);
    expect(score(job(), worker({ preferredWorkModes: ['REMOTE'] })).components.preferences.score).toBeCloseTo((1 + 1 + 0.4) / 3, 3);
  });

  it('is not assessed when no preference data exists', () => {
    const r = score(job({ salaryMin: null, salaryMax: null }), worker({ expectedSalaryMin: null, expectedSalaryMax: null, preferredTypes: [] }));
    expect(r.components.preferences.score).toBeNull();
  });
});

describe('explanation', () => {
  it('is built from the same facts as the score and flags what was not assessed', () => {
    const r = score();
    expect(r.explanation).toMatch(/^Strong match: /);
    expect(r.explanation).toContain('2 of 2 required skills');
    expect(r.explanation).toContain('5 years of relevant experience');
    expect(r.explanation).toContain('in the same zone or city');
    expect(r.explanation).toContain('Not assessed: qualification.');
    expect(r.explanation).not.toContain('limited information'); // confidence 0.9
  });

  it('warns when confidence is low', () => {
    const r = score(job(), worker({ skills: [], locationPath: [], preferredTypes: [], expectedSalaryMin: null, expectedSalaryMax: null }));
    expect(r.confidence).toBeLessThan(0.6);
    expect(r.explanation).toContain('limited information');
  });
});
