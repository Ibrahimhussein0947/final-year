import { findSkills, type IndexedSkill } from './skillIndex';

/**
 * Rule-based reading of a job advertisement. It uses keyword and pattern rules plus the skill taxonomy.
 * It is NOT a language model and does not "understand" the text: every suggestion carries the sentence it came
 * from and a confidence level so the employer can check it, and nothing is saved until they approve.
 */
export const JOB_ANALYZER_VERSION = 'rules-1.0';

export type Confidence = 'high' | 'medium' | 'low';
export interface Suggestion<T> { value: T; confidence: Confidence; evidence: string | null }

export interface JobAnalysis {
  method: string;
  skills: { skillId: string; name: string; importance: 'REQUIRED' | 'PREFERRED'; confidence: Confidence; evidence: string }[];
  minExperienceYears: Suggestion<number | null> | null;
  requiredEducationLevel: Suggestion<string | null> | null;
  employmentType: Suggestion<string>;
  workMode: Suggestion<string>;
  category: Suggestion<{ id: string; name: string }> | null;
  languages: Suggestion<string[]> | null;
  salary: Suggestion<{ min: number | null; max: number | null }> | null;
  notes: string[];
}

const clip = (s: string, n = 140) => (s.trim().length > n ? `${s.trim().slice(0, n - 1)}…` : s.trim());
const find = (text: string, re: RegExp): { match: RegExpMatchArray; line: string } | null => {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) return { match: m, line };
  }
  return null;
};

// ── Skills and their importance ──

const PREFERRED_CUE = /\b(preferred|prefer|nice to have|desirable|an? (?:advantage|asset|plus|bonus)|is a plus|optional|would be (?:an? )?(?:advantage|plus|asset)|not required)\b/i;
const REQUIRED_CUE = /\b(must|required|requires?|essential|need(?:s|ed)?|minimum|mandatory|should have|proven|strong)\b/i;
const PREFERRED_HEADING = /^\W*(preferred|nice to have|desirable|advantages?|bonus|plus points?|additional skills|good to have)\b[^.]{0,40}:?\W*$/i;
const REQUIRED_HEADING = /^\W*(requirements?|qualifications?|must[- ]have|essential|what you need|what we require|skills? required|you must)\b[^.]{0,40}:?\W*$/i;

function skillImportances(text: string, hits: ReturnType<typeof findSkills>) {
  const lines = text.split(/\r?\n/);
  const sectionAt: ('required' | 'preferred' | null)[] = [];
  let section: 'required' | 'preferred' | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length > 0 && line.length <= 70) {
      if (PREFERRED_HEADING.test(line)) section = 'preferred';
      else if (REQUIRED_HEADING.test(line)) section = 'required';
      else if (/:\s*$/.test(line)) section = null; // some other heading ends the section
    }
    sectionAt.push(section);
  }
  return hits.map((h) => {
    // Judge by the sentence the skill sits in, not the whole line: "Welding is a plus. Engine repair is required."
    const line = h.sentence;
    let importance: 'REQUIRED' | 'PREFERRED';
    let confidence: Confidence;
    if (PREFERRED_CUE.test(line)) { importance = 'PREFERRED'; confidence = 'high'; }
    else if (sectionAt[h.line] === 'preferred') { importance = 'PREFERRED'; confidence = 'medium'; }
    else if (REQUIRED_CUE.test(line) || sectionAt[h.line] === 'required') { importance = 'REQUIRED'; confidence = 'high'; }
    else { importance = 'REQUIRED'; confidence = 'medium'; } // mentioned without a cue: assume it matters
    return { skillId: h.skillId, name: h.name, importance, confidence, evidence: h.evidence };
  });
}

// ── Experience ──

const NO_EXPERIENCE = /\b(no (?:prior |previous |work )?experience (?:is |are )?(?:required|needed|necessary)|experience (?:is )?not (?:required|necessary)|entry[- ]level|fresh(?:ly)? graduates? (?:are )?(?:welcome|encouraged)|fresh graduates?|no experience)\b/i;
const YEARS = [
  /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*)?(?:or more\s+)?years?['’]?\s*(?:of\s+)?(?:(?:relevant|work(?:ing)?|practical|related|proven|hands-on|professional)\s+)*experience/i,
  /experience\s*(?:of|:)?\s*(?:at least|minimum(?: of)?|min\.?)?\s*(\d{1,2})\s*(?:\+|plus)?\s*years?/i,
  /(?:at least|minimum(?: of)?|min\.?)\s*(\d{1,2})\s*years?/i,
];

function experience(text: string): Suggestion<number | null> | null {
  const no = find(text, NO_EXPERIENCE);
  const yrs = YEARS.map((re) => find(text, re)).find(Boolean) ?? null;
  if (yrs) {
    const years = Math.min(50, Number(yrs.match[1]));
    return { value: years, confidence: 'high', evidence: clip(yrs.line) };
  }
  if (no) return { value: null, confidence: 'high', evidence: clip(no.line) };
  return null;
}

// ── Education ──

const EDU: { level: string; re: RegExp }[] = [
  { level: 'DOCTORATE', re: /\b(ph\.?d|doctorate|doctoral)\b/i },
  { level: 'MASTER', re: /\b(master'?s?|msc|m\.sc|mba|ma degree)\b/i },
  { level: 'BACHELOR', re: /\b(bachelor'?s?|bsc|b\.sc|ba degree|first degree|university degree|degree in)\b/i },
  { level: 'DIPLOMA', re: /\b(diploma|level (?:iii|iv|3|4))\b/i },
  { level: 'VOCATIONAL_CERTIFICATE', re: /\b(tvet|vocational|technical (?:training|school)|certificate (?:in|of)|level (?:i|ii|1|2) certificate)\b/i },
  { level: 'SECONDARY', re: /\b(grade (?:10|12)|10th grade|12th grade|secondary school|high school|preparatory|completed grade)\b/i },
];
const NO_EDU = /\b(no (?:formal )?(?:education|certificates?|qualifications?|degree)(?: is)? (?:required|needed|necessary)|(?:education|certificates?) (?:is )?not required|no certificate)\b/i;
const EDU_ORDER = ['DOCTORATE', 'MASTER', 'BACHELOR', 'DIPLOMA', 'VOCATIONAL_CERTIFICATE', 'SECONDARY'];

function education(text: string): { s: Suggestion<string | null> | null; note?: string } {
  const none = find(text, NO_EDU);
  if (none) return { s: { value: null, confidence: 'high', evidence: clip(none.line) } };
  let found = EDU.map((e) => ({ level: e.level, hit: find(text, e.re) })).filter((e) => e.hit);
  // "Diploma in welding (TVET)" is one requirement (a diploma), not a diploma and a vocational certificate.
  const diploma = found.find((e) => e.level === 'DIPLOMA');
  if (diploma && /tvet|vocational/i.test(diploma.hit!.line)) found = found.filter((e) => e.level !== 'VOCATIONAL_CERTIFICATE' || !/diploma/i.test(e.hit!.line));
  if (!found.length) return { s: null };
  // When several are named ("Diploma or Bachelor's degree"), the lowest one is what the employer would accept.
  const lowest = [...found].sort((a, b) => EDU_ORDER.indexOf(b.level) - EDU_ORDER.indexOf(a.level))[0];
  return {
    s: { value: lowest.level, confidence: found.length === 1 ? 'high' : 'medium', evidence: clip(lowest.hit!.line) },
    note: found.length > 1 ? `The text mentions several qualification levels; the lowest (${lowest.level.toLowerCase().replace(/_/g, ' ')}) was suggested.` : undefined,
  };
}

// ── Employment type and work mode ──

const TYPES: { value: string; re: RegExp }[] = [
  { value: 'VOLUNTEER', re: /\b(volunteer(?:s|ing)?|unpaid (?:role|position|work)|voluntary (?:service|work|position))\b/i },
  { value: 'APPRENTICESHIP', re: /\b(apprentice(?:ship)?s?|learn(?:ing)? (?:a|the) trade)\b/i },
  { value: 'INTERNSHIP', re: /\b(internship|intern|trainee)\b/i },
  { value: 'SEASONAL', re: /\b(seasonal|harvest season|during the season)\b/i },
  { value: 'GIG', re: /\b(gig work|gig|one[- ]off (?:task|job))\b/i },
  { value: 'ON_CALL', re: /\bon[- ]call (?:basis|work|position|staff|role)\b/i },
  { value: 'DAILY', re: /\b(daily (?:work|wages?|labou?rers?|paid|jobs?)|day labou?rers?|per day|paid daily|casual labou?rers?)\b/i },
  { value: 'CASUAL', re: /\b(casual (?:work|job|staff|position|basis)|irregular work)\b/i },
  { value: 'TEMPORARY', re: /\b(temporary|temp(?:orary)? position|short[- ]term)\b/i },
  { value: 'CONTRACT', re: /\b(contract(?: position| basis| role)?|fixed[- ]term|\d+[- ]month contract)\b/i },
  { value: 'FREELANCE', re: /\b(freelance|freelancer|self[- ]employed|per project|project basis)\b/i },
  { value: 'PART_TIME', re: /\b(part[- ]time|half[- ]day|few hours|weekends only)\b/i },
  { value: 'FULL_TIME', re: /\bfull[- ]time\b/i },
  { value: 'PERMANENT', re: /\b(permanent(?: position| role| job| employment)?|long[- ]term employment)\b/i },
];
const MODES: { value: string; re: RegExp }[] = [
  { value: 'HYBRID', re: /\bhybrid\b/i },
  { value: 'REMOTE', re: /\b(remote(?:ly)?|work from home|home[- ]based|telecommut\w*)\b/i },
];

function pick(text: string, table: { value: string; re: RegExp }[]) {
  for (const t of table) {
    const hit = find(text, t.re);
    if (hit) return { value: t.value, evidence: clip(hit.line) };
  }
  return null;
}

// ── Languages and salary ──

const LANGS: [string, RegExp][] = [
  ['Amharic', /\bamharic\b|አማርኛ/i], ['Afaan Oromoo', /\b(afaan oromo+|oromiffa|oromo language|oromifa)\b/i], ['English', /\benglish\b/i],
  ['Tigrinya', /\btigrinya\b|ትግርኛ/i], ['Somali', /\bsomali\b/i], ['Afar', /\bafar(?:af)?\b/i], ['Arabic', /\barabic\b/i],
];
const MONEY = /(\d{1,3}(?:[,\s]\d{3})+|\d{3,6})\s*(?:-|–|—|to)\s*(\d{1,3}(?:[,\s]\d{3})+|\d{3,6})\s*(?:etb|birr|br\b)/i;
const SINGLE_MONEY = /(?:salary|pay|wage)[^\d\n]{0,20}(\d{1,3}(?:[,\s]\d{3})+|\d{3,6})\s*(?:etb|birr|br\b)/i;
const num = (s: string) => Number(s.replace(/[,\s]/g, ''));

// ── The analyzer ──

export function analyzeJob(
  input: { title?: string; description: string },
  index: IndexedSkill[],
  categories: { id: string; slug: string; nameEn: string }[],
): JobAnalysis {
  const text = [input.title, input.description].filter(Boolean).join('\n');
  const notes: string[] = [];

  const hits = findSkills(text, index);
  const skills = skillImportances(text, hits);
  if (skills.length === 0) notes.push('No skills from our list were recognised. Add the skills you need by hand; the list covers about 90 common skills.');

  const ex = experience(text);
  const ed = education(text);
  if (ed.note) notes.push(ed.note);

  const type = pick(text, TYPES);
  const mode = pick(text, MODES);

  const langs = LANGS.filter(([, re]) => re.test(text)).map(([n]) => n);

  const money = find(text, MONEY);
  const single = money ? null : find(text, SINGLE_MONEY);
  const salary: JobAnalysis['salary'] = money
    ? { value: { min: num(money.match[1]), max: num(money.match[2]) }, confidence: 'high', evidence: clip(money.line) }
    : single ? { value: { min: num(single.match[1]), max: null }, confidence: 'low', evidence: clip(single.line) } : null;
  if (salary?.value.min !== null && salary?.value.max !== null && salary && salary.value.min! > salary.value.max!) {
    notes.push('The salary range looks reversed; please check it.');
  }

  // Category: skills vote (each recognised skill counts once for its category), the title can break ties.
  const votes = new Map<string, number>();
  for (const h of hits) votes.set(h.categoryId, (votes.get(h.categoryId) ?? 0) + 1);
  const titleLower = (input.title ?? '').toLowerCase();
  let best: { id: string; votes: number } | null = null;
  for (const [id, v] of votes) {
    const bonus = categories.find((c) => c.id === id && c.nameEn.toLowerCase().split(/[\s,&]+/).some((w) => w.length > 3 && titleLower.includes(w))) ? 0.5 : 0;
    if (!best || v + bonus > best.votes) best = { id, votes: v + bonus };
  }
  const cat = best ? categories.find((c) => c.id === best!.id)! : null;
  const share = best && hits.length ? best.votes / hits.length : 0;

  return {
    method: JOB_ANALYZER_VERSION,
    skills,
    minExperienceYears: ex,
    requiredEducationLevel: ed.s,
    employmentType: type
      ? { value: type.value, confidence: 'high', evidence: type.evidence }
      : { value: 'FULL_TIME', confidence: 'low', evidence: null },
    workMode: mode
      ? { value: mode.value, confidence: 'high', evidence: mode.evidence }
      : { value: 'ON_SITE', confidence: 'low', evidence: null },
    category: cat ? { value: { id: cat.id, name: cat.nameEn }, confidence: share >= 0.6 && hits.length >= 2 ? 'high' : 'medium', evidence: `${best!.votes >= 1 ? Math.floor(best!.votes) : 0} of ${hits.length} recognised skills belong to this category` } : null,
    languages: langs.length ? { value: langs, confidence: 'high', evidence: null } : null,
    salary,
    notes,
  };
}
