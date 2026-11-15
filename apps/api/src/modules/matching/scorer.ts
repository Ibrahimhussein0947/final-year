import { criteriaComponent } from './criteria';
import {
  availabilityComponent, experienceComponent, locationComponent, preferencesComponent, qualificationComponent, skillsComponent,
} from './components';
import {
  COMPONENT_KEYS, ENGINE_VERSION, HYBRID_VERSION,
  type ComponentKey, type JobFeatures, type MatchResult, type MatchWeights, type RelationMap, type WorkerFeatures,
} from './types';

export const MIN_RECOMMENDED_SCORE = 25;

/**
 * Worth recommending: above the minimum, something could be assessed, and at least one required skill is covered
 * when the job has any (or the profile text is clearly about this kind of work).
 */
export const recommendable = (r: MatchResult) =>
  r.eligibility !== 'not_eligible' &&
  r.score >= MIN_RECOMMENDED_SCORE &&
  r.confidence > 0 &&
  (r.requiredCoverage.required === 0 || r.requiredCoverage.covered > 0 || (r.semantic.score ?? 0) >= 0.5);
/** Highest score shown for someone who is known to lack a must-have sector requirement (below the "partial" band). */
export const NOT_ELIGIBLE_CAP = 39;

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Calibrated semantic score at or above which the "no required skill listed" cap is not applied. */
const SEMANTIC_GATE_RELIEF = 0.5;

export function strengthOf(score: number): MatchResult['strength'] {
  return score >= 80 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'partial' : 'weak';
}

/**
 * Weighted match between one job and one worker.
 *
 *   score      = 100 * sum(weight_i * s_i) / sum(weight_i)   over the components that could be assessed
 *   confidence = sum(weight of assessed components) / sum(all weights)
 *
 * A component with missing data is left out and the remaining weights are renormalized, so missing
 * information never counts as a zero. The confidence value tells the reader how much the score rests on.
 * Every number in the explanation comes from the same calculation as the score.
 */
export function matchPair(job: JobFeatures, worker: WorkerFeatures, weights: MatchWeights, relations: RelationMap, now = new Date()): MatchResult {
  const sk = skillsComponent(job, worker, relations);
  const ex = experienceComponent(job, worker, now);
  const lo = locationComponent(job, worker);
  const qu = qualificationComponent(job, worker, sk.outcome.score, ex.relevantYears);
  const av = availabilityComponent(job, worker, now);
  const pr = preferencesComponent(job, worker);
  const cr = criteriaComponent(job.criteria, worker.criteria);

  const outcomes = { skills: sk.outcome, experience: ex.outcome, location: lo.outcome, qualification: qu, availability: av, preferences: pr, criteria: cr };

  let weighted = 0;
  let known = 0;
  let totalWeight = 0;
  const components = {} as MatchResult['components'];
  const notAssessed: MatchResult['notAssessed'] = [];
  for (const key of COMPONENT_KEYS) {
    const w = weights[key];
    const o = outcomes[key];
    // A job with no sector requirements has nothing to assess here: that is "not applicable", not "missing
    // information", so it must neither lower the confidence nor be listed as not assessed.
    const notApplicable = key === 'criteria' && !job.criteria?.length;
    if (!notApplicable) totalWeight += w;
    components[key] = { score: o.score === null ? null : Math.round(o.score * 1000) / 1000, weight: w, note: o.note };
    if (notApplicable) continue;
    if (o.score === null) {
      notAssessed.push({ component: key, reason: o.missingReason ?? 'not enough information' });
    } else {
      weighted += w * o.score;
      known += w;
    }
  }

  // Nothing assessable at all: report a neutral zero with zero confidence rather than inventing a number.
  const formulaScore = known > 0 ? round1((100 * weighted) / known) : 0;
  const confidence = totalWeight > 0 ? Math.round((known / totalWeight) * 100) / 100 : 0;

  // Required skills are the core of a job. If the worker covers none of them, the number still follows the
  // formula, but the label is capped so a pleasant location or long experience cannot read as a "good match".
  const required = job.skills.filter((s) => s.importance === 'REQUIRED').length;
  // With no listed skills nothing was compared, so nothing is covered (otherwise an empty profile would look like full coverage).
  const requiredCoverage = { required, covered: sk.taxonomyAssessed ? required - sk.missing.length : 0 };
  // The gate looks at listed skills only. Strong semantic similarity (the profile text clearly describes this kind
  // of work) lifts it, because the worker may simply have worded their skills differently from the taxonomy.
  const semanticallyRelevant = sk.semantic.score !== null && sk.semantic.score >= SEMANTIC_GATE_RELIEF;
  const noCoreSkills = sk.taxonomyAssessed && required > 0 && requiredCoverage.covered === 0 && !semanticallyRelevant;
  // A must-have sector requirement is not a matter of degree. Known to be unmet: the score is limited to
  // NOT_ELIGIBLE_CAP (so lists sorted by score cannot put such a person near the top) and the explanation says so.
  // Not yet confirmed: the person cannot be rated "strong".
  const eligibility = cr.detail.eligibility;
  const score = eligibility === 'not_eligible' ? Math.min(formulaScore, NOT_ELIGIBLE_CAP) : formulaScore;
  let strength = strengthOf(score);
  if (noCoreSkills && (strength === 'strong' || strength === 'good')) strength = 'partial';
  if (eligibility === 'unknown' && strength === 'strong') strength = 'good';

  return {
    engineVersion: sk.semantic.similarity !== null ? HYBRID_VERSION : ENGINE_VERSION,
    semantic: sk.semantic,
    score,
    confidence,
    strength,
    components,
    matchedSkills: sk.matched,
    relatedSkills: sk.related,
    missingSkills: sk.missing,
    requiredCoverage,
    notAssessed,
    criteria: cr.detail,
    eligibility,
    distanceKm: lo.distanceKm,
    explanation: explain(strength, components, notAssessed, confidence, noCoreSkills, cr.detail, score < formulaScore ? formulaScore : null),
  };
}

const ORDER: ComponentKey[] = ['skills', 'experience', 'location', 'availability', 'qualification', 'preferences', 'criteria'];

/** Plain-language reason built directly from the component facts. */
function explain(strength: MatchResult['strength'], c: MatchResult['components'], notAssessed: MatchResult['notAssessed'], confidence: number, noCoreSkills: boolean, crit: MatchResult['criteria'], cappedFrom: number | null): string {
  const label = crit.eligibility === 'not_eligible' ? 'Not eligible' : { strong: 'Strong', good: 'Good', partial: 'Partial', weak: 'Weak' }[strength];
  const facts = ORDER.filter((k) => c[k].score !== null && c[k].note).map((k) => c[k].note);
  let text = facts.length ? `${label}${crit.eligibility === 'not_eligible' ? '' : ' match'}: ${facts.join(', ')}.` : `${label}${crit.eligibility === 'not_eligible' ? '' : ' match'}: not enough information to compare.`;
  if (noCoreSkills) text += ' None of the required skills are listed, so this is rated no higher than partial.';
  const mustUnmet = crit.unmet.filter((u) => u.mustHave).map((u) => u.label);
  const mustUnknown = crit.unknown.filter((u) => u.mustHave).map((u) => u.label);
  if (mustUnmet.length) text += ` Does not meet a required condition: ${mustUnmet.join('; ')}.${cappedFrom !== null ? ` The score is limited to ${NOT_ELIGIBLE_CAP}; it would be ${cappedFrom} otherwise.` : ''}`;
  else if (mustUnknown.length) text += ` Not yet confirmed: ${mustUnknown.join('; ')}.`;
  if (crit.met.some((m) => !m.verified)) text += ' Sector answers are self-reported unless marked verified.';
  if (notAssessed.length > 0) text += ` Not assessed: ${notAssessed.map((n) => n.component).join(', ')}.`;
  if (confidence < 0.6) text += ' This score is based on limited information.';
  return text;
}
