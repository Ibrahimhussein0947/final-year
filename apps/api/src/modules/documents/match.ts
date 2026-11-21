// Compares what a person typed (name, father's name, date of birth, education details) with the text read from the
// document they uploaded. Pure functions, no database and no files, so every rule can be tested.
//
// This checks CONSISTENCY, not authenticity. A forged certificate with the right name on it will pass; only an
// administrator looking at the document (and, ideally, the issuing school or office) can decide whether it is genuine.

// ───────── text ─────────

/** Lower case, accents removed, anything that is not a letter or digit becomes a space. Ethiopic (Ge'ez) letters are kept. */
export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export const tokensOf = (s: string): string[] => normalize(s).split(' ').filter((t) => t.length >= 2);
export const hasEthiopic = (s: string) => /[ሀ-፿]/.test(s);

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** Reading a scan makes small mistakes (rn for m, 0 for o), so longer names may differ by a letter or two. */
const tolerance = (len: number) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

export type TokenHit = 'exact' | 'close' | null;
export function findToken(token: string, doc: readonly string[]): TokenHit {
  let best: TokenHit = null;
  const tol = tolerance(token.length);
  for (const d of doc) {
    if (d === token) return 'exact';
    if (tol > 0 && distance(token, d, tol) <= tol) best = 'close';
  }
  return best;
}

/** CLOSE: differs from what was typed by a single digit, which is what a misread scan looks like. A person must look. */
export type FieldStatus = 'FOUND' | 'CLOSE' | 'NOT_FOUND';
/** `read` is what the document itself says for this detail (a short line), so the person and the reviewer can see what was understood. */
export interface FieldResult { field: string; expected: string; status: FieldStatus; required: boolean; note?: string; read?: string }

/** Every word of `expected` must appear in the document (allowing small reading mistakes). */
export function nameResult(field: string, expected: string, docTokens: readonly string[], required: boolean): FieldResult {
  const want = tokensOf(expected);
  const missing = want.filter((t) => !findToken(t, docTokens));
  return { field, expected, status: want.length > 0 && missing.length === 0 ? 'FOUND' : 'NOT_FOUND', required, ...(missing.length ? { note: `not found: ${missing.join(', ')}` } : {}) };
}

/** The line of the document that shares the most words with `expected`: what the document says about it. */
export function bestLine(expected: string, text: string): string | null {
  const want = tokensOf(expected);
  let best: { line: string; hits: number } | null = null;
  for (const line of text.split(/\n+/)) {
    const toks = tokensOf(line);
    const hits = want.filter((t) => findToken(t, toks)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { line, hits };
  }
  return best ? best.line.replace(/\s+/g, ' ').trim().slice(0, 80) : null;
}

/** The first few dates as they are written on the document. */
export function datesRead(text: string, max = 3): string[] {
  return extractDates(text).slice(0, max).map((c) => c.raw ?? `${c.a}/${c.b}/${c.y}`);
}

const occurrences = (token: string, doc: readonly string[]) => doc.filter((d) => findToken(token, [d])).length;

/**
 * The father's name. In Ethiopia a person's own name usually includes the father's ("Abebe Kebede"), so the child's own
 * line on the certificate would satisfy a plain search. A word that is also part of the person's own name therefore has
 * to appear twice: once as the child's name and once on the father's line.
 */
export function fatherResult(field: string, expected: string, ownName: string, docTokens: readonly string[], required: boolean): FieldResult {
  const own = tokensOf(ownName);
  const want = tokensOf(expected);
  const short = want.filter((t) => occurrences(t, docTokens) < (findToken(t, own) ? 2 : 1));
  return {
    field, expected, status: want.length > 0 && short.length === 0 ? 'FOUND' : 'NOT_FOUND', required,
    ...(short.length ? { note: `not found${short.some((t) => findToken(t, own)) ? ' as a separate father line' : ''}: ${short.join(', ')}` } : {}),
  };
}

// ───────── dates, Gregorian and Ethiopian ─────────

const JD_OFFSET_ETHIOPIAN = 1723856;
/** Ethiopian calendar (12 months of 30 days and Pagume of 5 or 6) to a Julian day number. */
export const ethiopianToJdn = (y: number, m: number, d: number) => JD_OFFSET_ETHIOPIAN + 365 + 365 * (y - 1) + Math.floor(y / 4) + 30 * m + d - 31;
export function jdnToGregorian(jdn: number): { y: number; m: number; d: number } {
  let l = jdn + 68569;
  const n = Math.floor((4 * l) / 146097);
  l -= Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const d = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  return { y: 100 * (n - 49) + i + l, m: j + 2 - 12 * l, d };
}
export function ethiopianToGregorian(y: number, m: number, d: number) {
  if (m < 1 || m > 13 || d < 1 || d > (m === 13 ? (y % 4 === 3 ? 6 : 5) : 30)) return null;
  return jdnToGregorian(ethiopianToJdn(y, m, d));
}
const validGregorian = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1850 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export interface DateCandidate { a: number; b: number; y: number; ethiopianMonth?: boolean; named?: boolean; raw?: string }

const GREG_MONTHS: Record<string, number> = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const ETH_MONTHS: Record<string, number> = { meskerem: 1, maskaram: 1, tikimt: 2, tekemt: 2, teqemt: 2, hidar: 3, hedar: 3, tahsas: 4, tahisas: 4, tir: 5, yekatit: 6, megabit: 7, miazia: 8, miyazya: 8, ginbot: 9, sene: 10, hamle: 11, nehase: 12, nehasse: 12, pagume: 13, pagumen: 13 };

/** Pull every date-looking piece out of the text. Numeric dates keep both readings (day first or month first). */
export function extractDates(text: string): DateCandidate[] {
  const t = text.replace(/[,]/g, ' ');
  const out: DateCandidate[] = [];
  for (const m of t.matchAll(/\b(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})\b/g)) out.push({ a: +m[1], b: +m[2], y: +m[3], raw: m[0].replace(/\s+/g, '') });
  for (const m of t.matchAll(/\b(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\b/g)) out.push({ a: +m[3], b: +m[2], y: +m[1], raw: m[0].replace(/\s+/g, '') });
  const names = [...Object.keys(GREG_MONTHS), ...Object.keys(ETH_MONTHS)].sort((x, y) => y.length - x.length).join('|');
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${names})\\.?\\s+(\\d{4})\\b`, 'gi'))) {
    const k = m[2].toLowerCase();
    out.push(k in ETH_MONTHS ? { a: +m[1], b: ETH_MONTHS[k], y: +m[3], ethiopianMonth: true, named: true, raw: m[0] } : { a: +m[1], b: GREG_MONTHS[k], y: +m[3], named: true, raw: m[0] });
  }
  for (const m of t.matchAll(new RegExp(`\\b(${names})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(\\d{4})\\b`, 'gi'))) {
    const k = m[1].toLowerCase();
    out.push(k in ETH_MONTHS ? { a: +m[2], b: ETH_MONTHS[k], y: +m[3], ethiopianMonth: true, named: true, raw: m[0] } : { a: +m[2], b: GREG_MONTHS[k], y: +m[3], named: true, raw: m[0] });
  }
  return out;
}

export interface DobResult { found: boolean; close: boolean; via: 'gregorian' | 'ethiopian' | null; datesSeen: number }
const two = (n: number) => String(n).padStart(2, '0');
const digitsApart = (a: string, b: string) => (a.length === b.length ? [...a].filter((c, i) => c !== b[i]).length : 9);
/** Does any date in the text equal the date of birth, read as a Gregorian date or as an Ethiopian-calendar date? */
export function dateOfBirthFound(expected: { y: number; m: number; d: number }, candidates: readonly DateCandidate[]): DobResult {
  const same = (g: { y: number; m: number; d: number } | null) => !!g && g.y === expected.y && g.m === expected.m && g.d === expected.d;
  const want = `${two(expected.d)}${two(expected.m)}${expected.y}`;
  let close = false;
  for (const c of candidates) {
    if (!c.ethiopianMonth) {
      // day/month/year, or month/day/year when the first number cannot be a day... either order is accepted
      for (const [d, m] of [[c.a, c.b], [c.b, c.a]]) {
        if (validGregorian(c.y, m, d) && same({ y: c.y, m, d })) return { found: true, close: false, via: 'gregorian', datesSeen: candidates.length };
        if (digitsApart(`${two(d)}${two(m)}${c.y}`, want) === 1) close = true;
      }
    }
    if (!c.named || c.ethiopianMonth) {
      for (const [d, m] of [[c.a, c.b], [c.b, c.a]]) if (same(ethiopianToGregorian(c.y, m, d))) return { found: true, close: false, via: 'ethiopian', datesSeen: candidates.length };
    }
  }
  return { found: false, close, via: null, datesSeen: candidates.length };
}

/** A graduation year may be written in either calendar: 2021 in Gregorian is 2013 or 2014 in Ethiopian. */
export function yearFound(year: number, text: string): boolean {
  const years = new Set([...text.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])));
  return [year, year - 7, year - 8].some((y) => years.has(y));
}

// ───────── education ─────────

const LEVEL_WORDS: Record<string, RegExp> = {
  PRIMARY: /\b(primary|grade\s*8|elementary)\b/i,
  SECONDARY: /\b(secondary|grade\s*(10|12)|eslce|eheece|preparatory|entrance)\b/i,
  VOCATIONAL_CERTIFICATE: /\b(certificate|vocational|tvet|level\s*(i|ii|iii|iv|1|2|3|4)|coc)\b/i,
  DIPLOMA: /\bdiploma\b/i,
  BACHELOR: /\b(bachelor|degree|b\.?\s?sc|b\.?\s?a|b\.?\s?ed)\b/i,
  MASTER: /\b(master|m\.?\s?sc|m\.?\s?a|mba)\b/i,
  DOCTORATE: /\b(doctor|ph\.?\s?d|doctorate)\b/i,
};
export const levelFound = (level: string, text: string) => (LEVEL_WORDS[level] ? LEVEL_WORDS[level].test(text) : false);

const SCHOOL_WORDS = new Set(['company', 'share', 'plc', 'ltd', 'limited', 'pvt', 'sc', 'private', 'public', 'enterprise', 'enterprises', 'corporation', 'group', 'association', 'organization', 'organisation', 'ngo', 'agency', 'trading', 'general', 'import', 'export', 'university', 'college', 'school', 'institute', 'institution', 'of', 'the', 'and', 'technical', 'vocational', 'training', 'tvet', 'polytechnic', 'academy', 'center', 'centre', 'ethiopia', 'ethiopian', 'higher', 'education', 'secondary', 'preparatory', 'primary', 'high']);
/** The distinctive words of a school's name (Hawassa, Jimma...) must be found; the common words are ignored. */
export function institutionResult(expected: string, docTokens: readonly string[], opts: { field?: string; required?: boolean; threshold?: number } = {}): FieldResult {
  const all = tokensOf(expected);
  const key = all.filter((t) => !SCHOOL_WORDS.has(t));
  const want = key.length ? key : all;
  const hits = want.filter((t) => findToken(t, docTokens)).length;
  return { field: opts.field ?? 'Institution', expected, status: want.length > 0 && hits / want.length >= (opts.threshold ?? 0.6) ? 'FOUND' : 'NOT_FOUND', required: opts.required ?? false };
}

// ───────── decision ─────────

export type Outcome = 'CONSISTENT' | 'PARTIAL' | 'MISMATCH' | 'UNREADABLE';
const MIN_CHARS = 40;
const MIN_CONFIDENCE = 45; // below this the reading is mostly guesses
const SURE_CONFIDENCE = 60; // below this a missing detail may be a reading mistake, so no verdict

export function decide(input: { chars: number; confidence: number | null; fields: readonly FieldResult[] }): { outcome: Outcome; reason: string | null } {
  const conf = input.confidence ?? 100; // text read straight from a PDF is exact
  if (input.chars < MIN_CHARS) return { outcome: 'UNREADABLE', reason: 'Almost no text could be read from this file.' };
  if (conf < MIN_CONFIDENCE) return { outcome: 'UNREADABLE', reason: 'The picture is too blurry or dark to read reliably.' };
  const required = input.fields.filter((f) => f.required);
  if (required.every((f) => f.status === 'FOUND')) return { outcome: input.fields.every((f) => f.status === 'FOUND') ? 'CONSISTENT' : 'PARTIAL', reason: null };
  if (required.every((f) => f.status !== 'NOT_FOUND')) return { outcome: 'PARTIAL', reason: 'A detail differs from what you typed by a single digit. That is often a reading mistake, so an administrator will look at the document.' };
  if (conf < SURE_CONFIDENCE) return { outcome: 'UNREADABLE', reason: 'The picture was hard to read, so a missing detail may be a reading mistake rather than a difference.' };
  return { outcome: 'MISMATCH', reason: null };
}

// ───────── numbers (TIN, licence, registration and ID numbers) ─────────

/** Letters and digits only, upper case; the letters a scan confuses with digits (O, I, L) are read as digits in mostly-numeric values. */
export function compactNumber(s: string): string {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.replace(/[^0-9]/g, '').length >= c.length * 0.6 ? c.replace(/O/g, '0').replace(/[IL]/g, '1') : c;
}

/**
 * Is this number on the document? Spaces, dashes and slashes are ignored. A value of 8 or more characters that differs
 * by exactly one character is "close", which is what a misread digit looks like; a person looks at it.
 */
export function numberResult(field: string, expected: string, text: string, required: boolean): FieldResult {
  const want = compactNumber(expected);
  const hay = compactNumber(text);
  if (want.length < 4) return { field, expected, status: 'NOT_FOUND', required, note: 'too short to compare' };
  if (hay.includes(want)) return { field, expected, status: 'FOUND', required };
  if (want.length >= 8) {
    for (let i = 0; i + want.length <= hay.length; i++) {
      let diff = 0;
      for (let j = 0; j < want.length && diff < 2; j++) if (hay[i + j] !== want[j]) diff++;
      if (diff === 1) return { field, expected, status: 'CLOSE', required, note: 'a number differing by one character was read; it may be a reading mistake' };
    }
  }
  return { field, expected, status: 'NOT_FOUND', required };
}
