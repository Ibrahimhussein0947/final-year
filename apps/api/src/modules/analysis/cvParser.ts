import { findSkills, type IndexedSkill } from './skillIndex';

/**
 * Rule-based reading of CV text. It looks for section headings, date ranges, degree words and skills from the
 * taxonomy. CVs are written in countless layouts, so this will miss things and occasionally misread them:
 * the result is a DRAFT the worker must review and correct before anything is saved.
 * English text only. Scanned (image-only) PDFs and photos are read by OCR first (see ocr.ts).
 */
export const CV_PARSER_VERSION = 'rules-1.0';

export interface ParsedCv {
  method: string;
  summary: string | null;
  skills: { skillId: string; name: string; evidence: string; inSkillsSection: boolean }[];
  unrecognizedSkills: string[];
  experiences: { title: string; employer: string | null; startDate: string; endDate: string | null; description: string | null }[];
  education: { level: string; field: string | null; institution: string | null; year: number | null }[];
  certifications: { name: string; year: number | null }[];
  languages: string[];
  estimatedYearsExperience: number | null;
  sectionsFound: string[];
  warnings: string[];
}

type Section = 'summary' | 'experience' | 'education' | 'skills' | 'certifications' | 'languages' | 'other';

const HEADINGS: [Section, RegExp][] = [
  ['summary', /^(professional |career )?(summary|profile|objective|about me)$/i],
  ['experience', /^((work|professional|employment|relevant|practical) )?(experience|history)$|^employment$|^work$/i],
  ['education', /^(education|academic (background|qualifications?)|qualifications?|education (and|&) (training|qualifications?))$/i],
  ['skills', /^((technical|key|core|professional|practical) )?(skills|competenc(y|ies)|expertise|skills (and|&) (abilities|competenc(y|ies)))$/i],
  ['certifications', /^(certifications?|certificates?|trainings?|courses?|licen[cs]es?|(professional )?(training|development)|trainings? (and|&) certifications?)$/i],
  ['languages', /^languages?( skills)?$/i],
  ['other', /^(references?|interests?|hobbies|projects?|awards?|achievements?|personal (details|information)|declaration|contact( details| information)?)$/i],
];

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DATE = `(?:(?:${MONTHS})\\.?,?\\s+)?\\d{4}|\\d{1,2}\\/\\d{4}`;
const RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|until)\\s*(${DATE}|present|current|now|to date|ongoing|date)`, 'i');

function parseDate(s: string, endOfRange: boolean): Date | null {
  const t = s.trim().toLowerCase().replace(/[.,]/g, '');
  const slash = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (slash) return new Date(Date.UTC(Number(slash[2]), Math.min(11, Math.max(0, Number(slash[1]) - 1)), 1));
  const my = t.match(new RegExp(`^(${MONTHS})\\s+(\\d{4})$`, 'i'));
  if (my) return new Date(Date.UTC(Number(my[2]), MONTH_INDEX[my[1].slice(0, 3)], 1));
  const y = t.match(/^(\d{4})$/);
  // A bare year has no month: a start counts from January, an end counts to the start of that year (conservative).
  if (y) return new Date(Date.UTC(Number(y[1]), 0, 1));
  void endOfRange;
  return null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function parseDateRange(line: string, now = new Date()): { start: Date; end: Date | null; text: string } | null {
  const m = line.match(RANGE);
  if (!m) return null;
  const start = parseDate(m[1], false);
  if (!start || start.getUTCFullYear() < 1960 || start > now) return null;
  const endRaw = m[2].toLowerCase();
  const open = /present|current|now|to date|ongoing|^date$/.test(endRaw);
  const end = open ? null : parseDate(m[2], true);
  if (!open && (!end || end < start || end > new Date(now.getTime() + 366 * 86_400_000))) return null;
  return { start, end, text: m[0] };
}

const EDU: { level: string; re: RegExp }[] = [
  { level: 'DOCTORATE', re: /\b(ph\.?d|doctorate)\b/i },
  { level: 'MASTER', re: /\b(master'?s?|msc|m\.sc|mba|m\.a\.)\b/i },
  { level: 'BACHELOR', re: /\b(bachelor'?s?|bsc|b\.sc|b\.a\.|ba\b|degree)\b/i },
  { level: 'DIPLOMA', re: /\bdiploma\b/i },
  { level: 'VOCATIONAL_CERTIFICATE', re: /\b(tvet|vocational|technical (training|school)|level (i{1,3}|iv|[1-4])\b)/i },
  { level: 'SECONDARY', re: /\b(grade (10|12)|secondary school|high school|preparatory|ethiopian (general )?secondary|eslce|eheece)\b/i },
];
const INSTITUTION = /\b([A-Z][\w'’&.-]*(?:\s+[A-Z][\w'’&.-]*)*\s+(?:University|College|TVET|Institute|Polytechnic|School|Academy)(?:\s+of\s+[A-Z][\w]*(?:\s+[A-Z][\w]*)*)?|(?:University|College|Institute) of [A-Z][\w]*(?:\s+[A-Z][\w]*)*)/;
const LANGS: [string, RegExp][] = [
  ['Amharic', /\bamharic\b/i], ['Afaan Oromoo', /\b(afaan oromo+|oromiffa|oromifa|oromo)\b/i], ['English', /\benglish\b/i],
  ['Tigrinya', /\btigrinya\b/i], ['Somali', /\bsomali\b/i], ['Arabic', /\barabic\b/i], ['French', /\bfrench\b/i],
];

const clean = (s: string) => s.replace(/^[\s\-–—•*·▪●■◦>]+/, '').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function splitSections(lines: string[]): { name: Section | 'top'; lines: string[] }[] {
  const out: { name: Section | 'top'; lines: string[] }[] = [{ name: 'top', lines: [] }];
  for (const raw of lines) {
    const t = clean(raw).replace(/[:：]\s*$/, '');
    const heading = t.length > 0 && t.length <= 45 ? HEADINGS.find(([, re]) => re.test(t)) : undefined;
    if (heading) out.push({ name: heading[0], lines: [] });
    else out[out.length - 1].lines.push(raw);
  }
  return out;
}

function parseExperiences(lines: string[], now: Date): ParsedCv['experiences'] {
  const items: { title: string; employer: string | null; start: Date; end: Date | null; description: string[] }[] = [];
  const nonEmpty = lines.map(clean);
  for (let i = 0; i < nonEmpty.length; i++) {
    const range = parseDateRange(nonEmpty[i], now);
    if (!range) {
      const last = items[items.length - 1];
      if (last && nonEmpty[i] && last.description.length < 6) last.description.push(nonEmpty[i]);
      continue;
    }
    let head = clean(nonEmpty[i].replace(range.text, '').replace(/[()|,;:]+\s*$/, '').replace(/^[(|,;:]+/, ''));
    if (!head) {
      // dates on their own line: the title is the nearest non-empty line above (or below)
      let j = i - 1;
      while (j >= 0 && !nonEmpty[j]) j--;
      head = j >= 0 && !parseDateRange(nonEmpty[j], now) ? nonEmpty[j] : '';
      if (head) {
        // that line was just read as a bullet of the previous job; it belongs to this one
        const prev = items[items.length - 1];
        if (prev && prev.description[prev.description.length - 1] === head) prev.description.pop();
      }
      if (!head) {
        j = i + 1;
        while (j < nonEmpty.length && !nonEmpty[j]) j++;
        head = j < nonEmpty.length && !parseDateRange(nonEmpty[j], now) ? nonEmpty[j] : '';
      }
    }
    if (!head) continue;
    const parts = head.split(/\s+(?:at|@)\s+|\s*\|\s*|\s+[-–—]\s+|,\s+/i).map(clean).filter(Boolean);
    items.push({ title: clip(parts[0] ?? head, 120), employer: parts[1] ? clip(parts.slice(1).join(', '), 150) : null, start: range.start, end: range.end, description: [] });
  }
  return items.map((e) => ({
    title: e.title,
    employer: e.employer,
    startDate: iso(e.start),
    endDate: e.end ? iso(e.end) : null,
    description: e.description.length ? clip(e.description.join(' '), 600) : null,
  }));
}

function parseEducation(lines: string[]): ParsedCv['education'] {
  const out: ParsedCv['education'] = [];
  const text = lines.map(clean);
  let lastEntryLine = -10;
  for (let i = 0; i < text.length; i++) {
    const line = text[i];
    if (!line) continue;
    const level = EDU.find((e) => e.re.test(line));
    if (!level) continue;
    // "Adama TVET College, 2011" right under "Diploma in ..." names the school; it is not a second qualification.
    if (i - lastEntryLine <= 2 && level.level === 'VOCATIONAL_CERTIFICATE' && !/vocational|certificate|level/i.test(line)) continue;
    lastEntryLine = i;
    const next = text[i + 1] ?? ''; // institution and year are often on the next line
    const field = line.match(/\b(?:in|of)\s+([A-Z][A-Za-z&,' -]{2,70}?)(?=\s*(?:[,(\-–—|]|\d{4}|$))/)?.[1]?.trim() ?? null;
    const year = (line.match(/\b(19[6-9]\d|20[0-4]\d)\b/) ?? next.match(/\b(19[6-9]\d|20[0-4]\d)\b/))?.[1];
    const inst = (line.match(INSTITUTION) ?? next.match(INSTITUTION))?.[1] ?? null;
    out.push({
      level: level.level,
      field: field && !/university|college|institute/i.test(field) ? clip(field, 100) : null,
      institution: inst ? clip(inst, 120) : null,
      year: year ? Number(year) : null,
    });
  }
  // The same degree often appears twice (heading plus details): keep one per level and field.
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.level}|${(e.field ?? '').toLowerCase()}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

function parseCertifications(lines: string[], whole: string[], inSection: boolean): ParsedCv['certifications'] {
  const candidates = inSection ? lines : whole.filter((l) => /\b(certificate|certified|certification)\b/i.test(l) && !EDU.some((e) => e.re.test(l)));
  const out: ParsedCv['certifications'] = [];
  for (const raw of candidates) {
    const line = clean(raw);
    if (!line || line.length < 4 || line.length > 140 || parseDateRange(line)) continue;
    const year = line.match(/\b(19[89]\d|20[0-4]\d)\b/)?.[1];
    const name = clean(line.replace(/\(?\b(19[89]\d|20[0-4]\d)\b\)?/, '').replace(/[,\-–—|:]+\s*$/, ''));
    if (name.length >= 4) out.push({ name: clip(name, 150), year: year ? Number(year) : null });
  }
  return out.slice(0, 20);
}

/** Total years covered by the date ranges, counting overlapping periods once. */
export function yearsCovered(ranges: { start: Date; end: Date | null }[], now = new Date()): number {
  const iv = ranges.map((r) => [r.start.getTime(), (r.end ?? now).getTime()] as const).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of iv) {
    if (curStart < 0) { curStart = s; curEnd = e; }
    else if (s <= curEnd) curEnd = Math.max(curEnd, e);
    else { total += curEnd - curStart; curStart = s; curEnd = e; }
  }
  if (curStart >= 0) total += curEnd - curStart;
  return Math.round((total / (365.25 * 86_400_000)) * 10) / 10;
}

export function parseCv(rawText: string, index: IndexedSkill[], now = new Date()): ParsedCv {
  const text = rawText.replace(/\r/g, '').replace(/ /g, ' ');
  const lines = text.split('\n');
  const sections = splitSections(lines);
  const get = (name: Section) => sections.filter((s) => s.name === name).flatMap((s) => s.lines);
  const found = [...new Set(sections.map((s) => s.name).filter((n): n is Section => n !== 'top'))];
  const warnings: string[] = [];
  if (!found.length) warnings.push('No clear section headings (such as Experience, Education, Skills) were found, so the results below may be incomplete.');

  // skills: anywhere in the document, flagging those listed in a Skills section
  const skillsSection = get('skills').join('\n');
  const inSection = new Set(findSkills(skillsSection, index).map((h) => h.skillId));
  const skills = findSkills(text, index).map((h) => ({ skillId: h.skillId, name: h.name, evidence: h.evidence, inSkillsSection: inSection.has(h.skillId) }));

  const recognizedText = new Set(findSkills(skillsSection, index).flatMap((h) => [h.name.toLowerCase()]));
  const unrecognizedSkills = [...new Set(
    skillsSection.split(/[\n,;|•·▪●]/).map(clean).filter((t) => t.length >= 2 && t.length <= 40 && !/[.:]$/.test(t))
      .filter((t) => findSkills(t, index).length === 0 && !recognizedText.has(t.toLowerCase())),
  )].slice(0, 25);

  const expLines = get('experience');
  const experiences = parseExperiences(expLines.length ? expLines : lines, now);
  if (found.length && !expLines.length) warnings.push('No work experience section was found; dates were read from the whole document.');
  const ranges = experiences.map((e) => ({ start: new Date(e.startDate), end: e.endDate ? new Date(e.endDate) : null }));
  const fromDates = ranges.length ? yearsCovered(ranges, now) : null;
  const stated = text.match(/(\d{1,2})\s*\+?\s*years?['’]?\s*(?:of\s+)?(?:(?:relevant|work|practical|professional|hands-on)\s+)*experience/i);
  const statedYears = stated ? Number(stated[1]) : null;
  const estimated = fromDates === null && statedYears === null ? null : Math.max(fromDates ?? 0, statedYears ?? 0);

  const eduLines = get('education');
  const education = parseEducation(eduLines.length ? eduLines : lines.filter((l) => EDU.some((e) => e.re.test(l)) && /\d{4}|university|college|institute|tvet/i.test(l)));

  const certLines = get('certifications');
  const certifications = parseCertifications(certLines, lines, certLines.length > 0);

  const langText = get('languages').join(' ') || (found.includes('languages') ? '' : text);
  const languages = LANGS.filter(([, re]) => re.test(langText)).map(([n]) => n);

  const summaryText = clean(get('summary').join(' '));

  return {
    method: CV_PARSER_VERSION,
    summary: summaryText ? clip(summaryText, 600) : null,
    skills, unrecognizedSkills, experiences, education, certifications, languages,
    estimatedYearsExperience: estimated, sectionsFound: found, warnings,
  };
}
