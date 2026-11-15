/**
 * Validation of sector-criteria input against a criterion definition. Pure functions.
 *
 * Client-facing ("simple") forms:                    Stored forms:
 *   job requirement  BOOLEAN true                     {equals: true}
 *                    NUMBER  n (minimum)              {min: n}
 *                    CHOICE / MULTI_CHOICE  string[]  {oneOf: [...]} / {allOf: [...]}
 *   worker answer    BOOLEAN boolean, NUMBER n, CHOICE "option", MULTI_CHOICE ["option", ...]  (stored as given)
 */
export type CriterionKind = 'BOOLEAN' | 'NUMBER' | 'CHOICE' | 'MULTI_CHOICE';

export interface DefinitionLike {
  type: CriterionKind;
  options: unknown;
  minValue: number | null;
  maxValue: number | null;
  mustHaveAllowed: boolean;
}

export interface CriterionOption { value: string; labelEn: string; labelAm?: string | null; labelOm?: string | null }

export function optionsOf(def: { options: unknown }): CriterionOption[] {
  return Array.isArray(def.options) ? (def.options as CriterionOption[]).filter((o) => o && typeof o.value === 'string') : [];
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

const inRange = (def: DefinitionLike, n: number): string | null => {
  if (!Number.isFinite(n)) return 'Enter a number';
  if (def.minValue !== null && n < def.minValue) return `Must be at least ${def.minValue}`;
  if (def.maxValue !== null && n > def.maxValue) return `Must be at most ${def.maxValue}`;
  return null;
};

/** What a worker says about themselves. */
export function normalizeWorkerValue(def: DefinitionLike, raw: unknown): Result<boolean | number | string | string[]> {
  const valid = new Set(optionsOf(def).map((o) => o.value));
  switch (def.type) {
    case 'BOOLEAN':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : fail('Answer yes or no');
    case 'NUMBER': {
      if (typeof raw !== 'number') return fail('Enter a number');
      const bad = inRange(def, raw);
      return bad ? fail(bad) : { ok: true, value: raw };
    }
    case 'CHOICE':
      return typeof raw === 'string' && valid.has(raw) ? { ok: true, value: raw } : fail('Choose one of the listed options');
    case 'MULTI_CHOICE': {
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) return fail('Choose from the listed options');
      const unique = [...new Set(raw as string[])];
      return unique.every((x) => valid.has(x)) ? { ok: true, value: unique } : fail('Choose only from the listed options');
    }
  }
}

/** What a job asks for. Returns the stored requirement object. */
export function normalizeRequirement(def: DefinitionLike, importance: 'MUST_HAVE' | 'PREFERRED', raw: unknown): Result<Record<string, unknown>> {
  if (importance === 'MUST_HAVE' && !def.mustHaveAllowed) return fail('This criterion can only be a preference, not a requirement');
  const valid = new Set(optionsOf(def).map((o) => o.value));
  switch (def.type) {
    case 'BOOLEAN':
      return raw === true ? { ok: true, value: { equals: true } } : fail('A yes/no requirement must be set to yes');
    case 'NUMBER': {
      if (typeof raw !== 'number') return fail('Enter the minimum as a number');
      const bad = inRange(def, raw);
      return bad ? fail(bad) : { ok: true, value: { min: raw } };
    }
    case 'CHOICE':
    case 'MULTI_CHOICE': {
      const list = typeof raw === 'string' ? [raw] : raw;
      if (!Array.isArray(list) || list.length === 0 || !list.every((x) => typeof x === 'string')) return fail('Choose at least one option');
      const unique = [...new Set(list as string[])];
      if (!unique.every((x) => valid.has(x))) return fail('Choose only from the listed options');
      return { ok: true, value: def.type === 'CHOICE' ? { oneOf: unique } : { allOf: unique } };
    }
  }
}

/** Stored requirement -> the simple form a client sends and displays. */
export function requirementToSimple(type: CriterionKind, stored: unknown): boolean | number | string[] | null {
  const r = (stored ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'BOOLEAN': return r.equals === true ? true : null;
    case 'NUMBER': return typeof r.min === 'number' ? r.min : null;
    case 'CHOICE': return Array.isArray(r.oneOf) ? (r.oneOf as string[]) : null;
    case 'MULTI_CHOICE': return Array.isArray(r.allOf) ? (r.allOf as string[]) : null;
  }
}

/** Human-readable text for an answer or requirement, using option labels. */
export function describeValue(def: { type: CriterionKind; options: unknown; unit: string | null }, simple: unknown): string {
  const labels = new Map(optionsOf(def).map((o) => [o.value, o.labelEn]));
  if (def.type === 'BOOLEAN') return simple === true ? 'Yes' : simple === false ? 'No' : '';
  if (def.type === 'NUMBER') return typeof simple === 'number' ? `${simple}${def.unit ? ` ${def.unit}` : ''}` : '';
  if (Array.isArray(simple)) return simple.map((v) => labels.get(v) ?? v).join(', ');
  return typeof simple === 'string' ? labels.get(simple) ?? simple : '';
}
