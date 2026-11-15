/**
 * Sector criteria in matching (Phase 15). Pure functions, no database.
 *
 * A job lists criteria, each MUST_HAVE or PREFERRED, with a requirement:
 *   BOOLEAN {equals: true}   NUMBER {min: n}   CHOICE {oneOf: [...]}   MULTI_CHOICE {allOf: [...]}
 * A worker states a value per criterion. For each job criterion the outcome is:
 *   met      the worker's value satisfies the requirement
 *   partial  a number below the minimum, or only some of the required options (credit in the score, but NOT "met")
 *   unmet    the worker's value does not satisfy it
 *   unknown  the worker has not answered: left out of the score (never counted as zero) and reported
 *
 * Eligibility is separate from the score because some conditions are not a matter of degree (a driving licence, a
 * professional registration): a MUST_HAVE that is known to be unmet makes the person "not eligible" and they are not
 * recommended; an unanswered MUST_HAVE makes eligibility "unknown" and the person is shown as unconfirmed.
 * Self-reported values count, but are shown as not verified; only an administrator's review sets "verified".
 */
export type CriterionKind = 'BOOLEAN' | 'NUMBER' | 'CHOICE' | 'MULTI_CHOICE';

export interface JobCriterionFeature {
  id: string;
  key: string;
  label: string;
  type: CriterionKind;
  importance: 'MUST_HAVE' | 'PREFERRED';
  requirement: unknown;
  /** option value -> label, for readable messages */
  optionLabels?: Record<string, string>;
}
export interface WorkerCriterionValue { value: unknown; verified: boolean }

export type Eligibility = 'eligible' | 'not_eligible' | 'unknown' | 'n/a';

export interface CriteriaDetail {
  met: { label: string; verified: boolean }[];
  unmet: { label: string; mustHave: boolean }[];
  unknown: { label: string; mustHave: boolean }[];
  eligibility: Eligibility;
}

export const EMPTY_CRITERIA: CriteriaDetail = { met: [], unmet: [], unknown: [], eligibility: 'n/a' };

type State = 'met' | 'partial' | 'unmet' | 'unknown';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strArray = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null);

/** Judge one criterion. Malformed stored data is treated as "unknown", never as a pass or a fail. */
export function evaluateCriterion(c: JobCriterionFeature, have: WorkerCriterionValue | undefined): { state: State; fraction: number } {
  if (!have || have.value === null || have.value === undefined) return { state: 'unknown', fraction: 0 };
  const req = (c.requirement ?? {}) as Record<string, unknown>;
  const v = have.value;
  switch (c.type) {
    case 'BOOLEAN': {
      if (typeof v !== 'boolean') return { state: 'unknown', fraction: 0 };
      return v ? { state: 'met', fraction: 1 } : { state: 'unmet', fraction: 0 };
    }
    case 'NUMBER': {
      if (!isNum(v) || !isNum(req.min)) return { state: 'unknown', fraction: 0 };
      if (v >= req.min) return { state: 'met', fraction: 1 };
      return req.min > 0 && v > 0 ? { state: 'partial', fraction: Math.min(1, v / req.min) } : { state: 'unmet', fraction: 0 };
    }
    case 'CHOICE': {
      const allowed = strArray(req.oneOf);
      if (typeof v !== 'string' || !allowed || allowed.length === 0) return { state: 'unknown', fraction: 0 };
      return allowed.includes(v) ? { state: 'met', fraction: 1 } : { state: 'unmet', fraction: 0 };
    }
    case 'MULTI_CHOICE': {
      const needed = strArray(req.allOf);
      const got = strArray(v);
      if (!needed || needed.length === 0 || !got) return { state: 'unknown', fraction: 0 };
      const share = needed.filter((n) => got.includes(n)).length / needed.length;
      return share === 1 ? { state: 'met', fraction: 1 } : share === 0 ? { state: 'unmet', fraction: 0 } : { state: 'partial', fraction: share };
    }
  }
}

export interface CriteriaOutcome {
  /** 0..1, or null when nothing could be assessed */
  score: number | null;
  note: string;
  missingReason?: string;
  detail: CriteriaDetail;
}

export function criteriaComponent(jobCriteria: JobCriterionFeature[] | undefined, workerValues: Record<string, WorkerCriterionValue> | undefined): CriteriaOutcome {
  const list = jobCriteria ?? [];
  if (list.length === 0) return { score: null, note: '', missingReason: 'the job lists no sector requirements', detail: EMPTY_CRITERIA };

  const detail: CriteriaDetail = { met: [], unmet: [], unknown: [], eligibility: 'n/a' };
  let earned = 0;
  let total = 0;
  let mustFailed = 0;
  let mustUnknown = 0;
  let mustTotal = 0;
  for (const c of list) {
    const must = c.importance === 'MUST_HAVE';
    if (must) mustTotal++;
    const have = workerValues?.[c.id];
    const r = evaluateCriterion(c, have);
    if (r.state === 'unknown') {
      detail.unknown.push({ label: c.label, mustHave: must });
      if (must) mustUnknown++;
      continue;
    }
    const weight = must ? 1 : 0.5;
    total += weight;
    earned += weight * r.fraction;
    if (r.state === 'met') detail.met.push({ label: c.label, verified: !!have?.verified });
    else {
      detail.unmet.push({ label: c.label, mustHave: must });
      if (must) mustFailed++;
    }
  }
  detail.eligibility = mustTotal === 0 ? 'n/a' : mustFailed > 0 ? 'not_eligible' : mustUnknown > 0 ? 'unknown' : 'eligible';

  if (total === 0) {
    return { score: null, note: '', missingReason: 'the worker has not answered the sector questions for this job', detail };
  }
  const answered = detail.met.length + detail.unmet.length;
  let note = `${detail.met.length} of ${list.length} sector requirement${list.length === 1 ? '' : 's'} met`;
  if (answered < list.length) note += ` (${list.length - answered} not answered)`;
  return { score: earned / total, note, detail };
}
