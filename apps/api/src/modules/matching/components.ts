import {
  EDUCATION_RANK,
  type ComponentOutcome, type JobFeatures, type RelationMap, type WorkerFeatures,
} from './types';
import { typeAccepted } from '../jobs/classification';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const DAY = 86_400_000;

// ───────── Semantic similarity ─────────

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * Calibration of the raw cosine similarity between a posting and a profile.
 * PROVISIONAL. Bounds 0.25 -> 0 and 0.70 -> 1, checked (not tuned) against the English calibration pairs of
 * apps/ai/evaluation/multilingual_probe.py with paraphrase-multilingual-MiniLM-L12-v2: unrelated pairs median 0.23,
 * p90 0.35, max 0.42 (n=50); related pairs p10 0.55, median 0.69, min 0.27 (n=10). Ten related pairs is too few to
 * call this calibrated. The scale is meaningful for English only: Amharic and Afaan Oromoo similarities were measured
 * as unreliable (different occupations scored 0.56-0.59 vs 0.69-0.73 for the same one), so Ethiopic-script text is
 * not embedded at all (see embeddingText.ts).
 */
export const SEMANTIC_LOW = 0.25;
export const SEMANTIC_HIGH = 0.7;
export const SEMANTIC_ALPHA = 0.5;
export const semanticScore = (cos: number) => clamp01((cos - SEMANTIC_LOW) / (SEMANTIC_HIGH - SEMANTIC_LOW));

// ───────── Skills ─────────

export interface SkillDetail {
  outcome: ComponentOutcome;
  matched: string[];
  related: { required: string; has: string; credit: number }[];
  missing: string[];
  /** True when the taxonomy comparison itself could be made (both sides list skills). */
  taxonomyAssessed: boolean;
  semantic: { similarity: number | null; score: number | null; lift: number };
}

/** How well the worker's level meets the job's minimum level for a skill (1 when no minimum). */
const levelFactor = (have: number, min: number | null) => (min ? Math.min(1, have / min) : 1);

/**
 * Every job skill earns credit: exact skill = 1, a related skill = the relation's weight, nothing = 0.
 * Credit is scaled down when the worker's level is below the job's minimum level.
 * Required skills count double compared with nice-to-have ones.
 */
export function skillsComponent(job: JobFeatures, worker: WorkerFeatures, relations: RelationMap): SkillDetail {
  const base = taxonomySkills(job, worker, relations);
  const cos = job.embedding && worker.embedding ? cosine(job.embedding, worker.embedding) : null;
  if (cos === null) return { ...base, semantic: { similarity: null, score: null, lift: 0 } };

  const sem = semanticScore(cos);
  const sim = Math.round(cos * 1000) / 1000;
  const taxonomy = base.outcome.score;
  // Semantic evidence can only fill part of the gap that exact and related skills leave. It never lowers a score,
  // so a worker with the right skills is not penalized because their free text is worded differently.
  if (taxonomy !== null) {
    const lifted = clamp01(taxonomy + SEMANTIC_ALPHA * (1 - taxonomy) * sem);
    const lift = Math.round((lifted - taxonomy) * 1000) / 1000;
    const note = lift >= 0.02 ? `${base.outcome.note}; profile wording is similar to the job (${Math.round(sem * 100)}% semantic similarity)` : base.outcome.note;
    return { ...base, outcome: { score: lifted, note }, semantic: { similarity: sim, score: sem, lift } };
  }
  // No listed skills to compare, but the profile text can still be compared. Kept conservative (at most half credit).
  if (job.skills.length > 0 && worker.skills.length === 0) {
    const score = SEMANTIC_ALPHA * sem;
    return {
      ...base,
      outcome: { score, note: `no skills listed, so this is based only on the wording of the profile (${Math.round(sem * 100)}% semantic similarity)` },
      semantic: { similarity: sim, score: sem, lift: Math.round(score * 1000) / 1000 },
    };
  }
  return { ...base, semantic: { similarity: sim, score: sem, lift: 0 } };
}

function taxonomySkills(job: JobFeatures, worker: WorkerFeatures, relations: RelationMap): Omit<SkillDetail, 'semantic'> {
  const empty = { matched: [], related: [], missing: [], taxonomyAssessed: false };
  if (job.skills.length === 0) return { ...empty, outcome: { score: null, note: '', missingReason: 'the job lists no skills' } };
  if (worker.skills.length === 0) return { ...empty, outcome: { score: null, note: '', missingReason: 'the worker has not listed any skills' } };

  const have = new Map(worker.skills.map((s) => [s.skillId, s]));
  const matched: string[] = [];
  const related: SkillDetail['related'] = [];
  const missing: string[] = [];
  let earned = 0;
  let total = 0;

  for (const js of job.skills) {
    const weight = js.importance === 'REQUIRED' ? 1 : 0.5;
    total += weight;
    const exact = have.get(js.skillId);
    if (exact) {
      earned += weight * levelFactor(exact.proficiency, js.minProficiency);
      matched.push(js.name);
      continue;
    }
    let best: { credit: number; has: string } | null = null;
    for (const [relId, w] of relations.get(js.skillId) ?? []) {
      const ws = have.get(relId);
      if (!ws) continue;
      const credit = w * levelFactor(ws.proficiency, js.minProficiency);
      if (!best || credit > best.credit) best = { credit, has: ws.name };
    }
    if (best) {
      earned += weight * best.credit;
      related.push({ required: js.name, has: best.has, credit: Math.round(best.credit * 100) / 100 });
    } else if (js.importance === 'REQUIRED') {
      missing.push(js.name);
    }
  }

  const requiredCount = job.skills.filter((s) => s.importance === 'REQUIRED').length;
  const requiredHeld = job.skills.filter((s) => s.importance === 'REQUIRED' && have.has(s.skillId)).length;
  const relatedRequired = related.filter((r) => job.skills.some((s) => s.name === r.required && s.importance === 'REQUIRED')).length;
  let note: string;
  if (requiredCount > 0) {
    note = `${requiredHeld} of ${requiredCount} required skill${requiredCount === 1 ? '' : 's'}`;
    if (relatedRequired > 0) note += ` (${relatedRequired} more through related skills)`;
  } else {
    note = `${matched.length} of ${job.skills.length} nice-to-have skills`;
  }
  return { outcome: { score: clamp01(earned / total), note }, matched, related, missing, taxonomyAssessed: true };
}

// ───────── Experience ─────────

export interface ExperienceDetail { outcome: ComponentOutcome; relevantYears: number }

const yearsBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / (365.25 * DAY));

/** Years in the job's category, from work history when present, otherwise from the declared total. */
export function relevantYears(job: JobFeatures, worker: WorkerFeatures, now = new Date()): number {
  const fromHistory = worker.experiences
    .filter((e) => e.categoryId !== null && e.categoryId === job.categoryId)
    .reduce((sum, e) => sum + yearsBetween(e.start, e.end ?? now), 0);
  const sameCategory = worker.categoryId !== null && worker.categoryId === job.categoryId;
  // Experience in a different field still counts a little (transferable), never zero.
  const fromDeclared = sameCategory ? worker.yearsExperience : 0.4 * worker.yearsExperience;
  return Math.round(Math.max(fromHistory, fromDeclared) * 10) / 10;
}

/**
 * With no stated minimum, inexperienced people are NOT penalized: everyone starts at 0.7 and experience adds
 * up to 0.3 (reached at 5 relevant years). With a minimum, the score is the share of it the worker has.
 */
export function experienceComponent(job: JobFeatures, worker: WorkerFeatures, now = new Date()): ExperienceDetail {
  const years = relevantYears(job, worker, now);
  const min = job.minExperienceYears;
  if (!min) {
    return { relevantYears: years, outcome: { score: 0.7 + 0.3 * clamp01(years / 5), note: `${years} year${years === 1 ? '' : 's'} of relevant experience (no minimum required)` } };
  }
  return { relevantYears: years, outcome: { score: clamp01(years / min), note: `${years} year${years === 1 ? '' : 's'} of relevant experience (job asks for ${min})` } };
}

// ───────── Location ─────────

const toRad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export interface LocationDetail { outcome: ComponentOutcome; distanceKm: number | null }

const DEFAULT_TRAVEL_KM = 40;

export function locationComponent(job: JobFeatures, worker: WorkerFeatures): LocationDetail {
  if (job.workMode === 'REMOTE') return { distanceKm: null, outcome: { score: 1, note: 'the job is remote' } };

  // 1) Real distance when both sides have coordinates.
  if (job.lat !== null && job.lng !== null && worker.lat !== null && worker.lng !== null) {
    const d = haversineKm(job.lat, job.lng, worker.lat, worker.lng);
    const max = worker.maxTravelKm && worker.maxTravelKm > 0 ? worker.maxTravelKm : DEFAULT_TRAVEL_KM;
    let score: number;
    if (d <= 0.5 * max) score = 1;
    else if (d <= max) score = 1 - 0.5 * ((d - 0.5 * max) / (0.5 * max));
    else score = worker.willingToRelocate ? 0.4 : Math.max(0, 0.5 * (1 - (d - max) / (2 * max)));
    if (job.workMode === 'HYBRID') score = Math.max(score, 0.5);
    const km = Math.round(d);
    const note = km < 1 ? 'within 1 km of the workplace' : `about ${km} km from the workplace`;
    return { distanceKm: km, outcome: { score: clamp01(score), note: d > max ? `${note}, beyond their travel limit` : note } };
  }

  // 2) Administrative areas (region > zone > woreda > kebele).
  if (job.locationPath.length === 0 || worker.locationPath.length === 0) {
    return { distanceKm: null, outcome: { score: null, note: '', missingReason: job.locationPath.length === 0 ? 'the job has no location' : 'the worker has not set a location' } };
  }
  let common = 0;
  while (common < job.locationPath.length && common < worker.locationPath.length && job.locationPath[common] === worker.locationPath[common]) common++;
  const shallow = Math.min(job.locationPath.length, worker.locationPath.length);
  let score: number;
  let note: string;
  if (common >= 3) { score = 1; note = 'in the same woreda'; }
  else if (common === shallow && common >= 2) { score = 0.95; note = 'in the same zone or city'; }
  else if (common === 2) { score = 0.8; note = 'in the same zone or city'; }
  else if (common === 1) { score = 0.5; note = 'in the same region'; }
  else { score = worker.willingToRelocate ? 0.3 : 0.05; note = worker.willingToRelocate ? 'in another region but willing to relocate' : 'in a different region'; }
  if (job.workMode === 'HYBRID') score = Math.max(score, 0.5);
  return { distanceKm: null, outcome: { score, note } };
}

// ───────── Qualification ─────────

export function qualificationComponent(job: JobFeatures, worker: WorkerFeatures, skillScore: number | null, years: number): ComponentOutcome {
  if (!job.requiredEducationLevel) return { score: null, note: '', missingReason: 'the job does not require a formal qualification' };
  const need = EDUCATION_RANK[job.requiredEducationLevel] ?? 0;
  const best = worker.educationLevels.reduce((m, l) => Math.max(m, EDUCATION_RANK[l] ?? 0), -1);

  // Practical skills can stand in for a certificate: strong skills plus real experience.
  const practical = skillScore !== null && skillScore >= 0.8 && years >= 3;

  if (best >= need) return { score: 1, note: 'meets the required qualification' };
  if (best < 0 && worker.certificationCount === 0) {
    return practical
      ? { score: 0.8, note: 'no formal qualification listed, but strong practical skills and experience' }
      : { score: null, note: '', missingReason: 'the worker has not listed any education or certificates' };
  }
  const gap = need - Math.max(best, 0);
  let score = clamp01(1 - 0.25 * gap);
  if (worker.certificationCount > 0) score = Math.min(1, score + 0.1);
  if (practical) score = Math.max(score, 0.8);
  return { score, note: practical ? 'below the listed qualification, offset by strong practical skills' : 'below the required qualification level' };
}

// ───────── Availability ─────────

const READY_DAYS: Record<string, number> = { IMMEDIATELY: 0, FLEXIBLE: 7, WITHIN_TWO_WEEKS: 14, WITHIN_ONE_MONTH: 30 };
const NO_START_SCORE: Record<string, number> = { IMMEDIATELY: 1, FLEXIBLE: 0.9, WITHIN_TWO_WEEKS: 0.85, WITHIN_ONE_MONTH: 0.7 };

export function availabilityComponent(job: JobFeatures, worker: WorkerFeatures, now = new Date()): ComponentOutcome {
  if (worker.availability === 'NOT_AVAILABLE') return { score: 0, note: 'not available right now' };
  let readyAt = new Date(now.getTime() + READY_DAYS[worker.availability] * DAY);
  if (worker.availableFrom && worker.availableFrom > readyAt) readyAt = worker.availableFrom;

  const label = worker.availability === 'IMMEDIATELY' ? 'available immediately' : worker.availability === 'FLEXIBLE' ? 'flexible availability' : 'available soon';
  if (!job.startDate) {
    const base = NO_START_SCORE[worker.availability];
    return { score: worker.availableFrom && worker.availableFrom > now ? Math.min(base, 0.7) : base, note: label };
  }
  if (readyAt <= job.startDate) return { score: 1, note: `${label}, in time for the start date` };
  const lateDays = (readyAt.getTime() - job.startDate.getTime()) / DAY;
  return { score: Math.max(0.2, 1 - lateDays / 30), note: `could start about ${Math.round(lateDays)} days after the planned start date` };
}

// ───────── Salary and preferences ─────────

export function preferencesComponent(job: JobFeatures, worker: WorkerFeatures): ComponentOutcome {
  const parts: { score: number; note: string }[] = [];

  const wMin = worker.expectedSalaryMin;
  const wMax = worker.expectedSalaryMax ?? worker.expectedSalaryMin;
  const jMin = job.salaryMin ?? job.salaryMax;
  const jMax = job.salaryMax ?? job.salaryMin;
  if (wMin !== null && wMax !== null && jMin !== null && jMax !== null) {
    if (jMax >= wMin) parts.push({ score: 1, note: 'expected salary fits the offered range' });
    else parts.push({ score: clamp01(1 - (wMin - jMax) / wMin), note: 'offered salary is below what the worker expects' });
  }
  if (worker.preferredTypes.length > 0) {
    const ok = typeAccepted(worker.preferredTypes, job.employmentType);
    parts.push({ score: ok ? 1 : 0.3, note: ok ? 'matches their preferred job type' : 'different from their preferred job type' });
  }
  if (worker.preferredWorkModes.length > 0) {
    const ok = worker.preferredWorkModes.includes(job.workMode);
    parts.push({ score: ok ? 1 : 0.4, note: ok ? 'matches their preferred work arrangement' : 'different from their preferred work arrangement' });
  }
  if (parts.length === 0) return { score: null, note: '', missingReason: 'salary and job-type preferences are not set on both sides' };
  return { score: parts.reduce((s, p) => s + p.score, 0) / parts.length, note: parts.map((p) => p.note).join('; ') };
}
