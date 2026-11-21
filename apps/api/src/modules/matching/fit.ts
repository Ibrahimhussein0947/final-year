import type { MatchResult } from './types';

/**
 * A short "you meet 4 of 6 requirements" summary for a job card, taken from the same calculation as the full match.
 * Requirements are the job's required skills (covered exactly or through a related skill) plus its sector requirements.
 * A requirement the worker has not answered yet is counted as not met so far, never silently dropped.
 */
export interface Fit {
  score: number;
  strength: MatchResult['strength'];
  eligibility: MatchResult['eligibility'];
  total: number;
  met: number;
  /** The first few things standing between the worker and a full match, in plain words. */
  missing: string[];
  /** True when there is nothing specific to compare (a job that lists no skills or requirements). */
  nothingListed: boolean;
}

const MAX_MISSING = 3;

export function fitOf(m: MatchResult): Fit {
  const skills = m.requiredCoverage;
  const c = m.criteria;
  const total = skills.required + c.met.length + c.unmet.length + c.unknown.length;
  const met = skills.covered + c.met.length;
  const missing = [
    ...m.missingSkills.map((s) => `Skill: ${s}`),
    ...c.unmet.map((u) => (u.mustHave ? `Must have: ${u.label}` : u.label)),
    ...c.unknown.map((u) => `Answer in your profile: ${u.label}`),
  ].slice(0, MAX_MISSING);
  return { score: m.score, strength: m.strength, eligibility: m.eligibility, total, met, missing, nothingListed: total === 0 };
}
