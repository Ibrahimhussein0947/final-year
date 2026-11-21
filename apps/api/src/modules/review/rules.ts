/**
 * Rule-based "look over" for three things: a worker's profile, an employer's job post before publishing, and an
 * applicant seen from the employer's side. Every finding comes from a named rule and says why, so a person can
 * check it. This is NOT a language model: it counts, compares and matches patterns, it does not read for meaning,
 * and it only understands English wording. Findings are suggestions; nothing is changed automatically, and
 * nothing here judges a person.
 */
import { detectDiscrimination, discriminationMessage } from '../criteria/discrimination';
import { scanJobText } from '../jobs/scamCheck';

export const REVIEW_VERSION = 'review-rules-1.0';

/** fix = would hurt or block; improve = would help; good = already fine. */
export type Level = 'fix' | 'improve' | 'good';
export interface Finding { id: string; level: Level; text: string; link?: string }
export interface Review {
  method: string;
  note: string;
  counts: Record<Level, number>;
  findings: Finding[];
}

const NOTE = 'Checked by fixed rules, not by a language model. It counts and compares what you wrote and can miss things or be wrong, so treat it as a checklist, not a verdict.';

const order: Record<Level, number> = { fix: 0, improve: 1, good: 2 };
function pack(findings: Finding[]): Review {
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  const counts: Record<Level, number> = { fix: 0, improve: 0, good: 0 };
  for (const f of sorted) counts[f.level]++;
  return { method: REVIEW_VERSION, note: NOTE, counts, findings: sorted };
}

const DAY = 86_400_000;
const monthsBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / (DAY * 30.44)));
const daysBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / DAY);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const letters = (s: string) => s.replace(/[^A-Za-z]/g, '');
const shouting = (s: string) => {
  const l = letters(s);
  return l.length >= 15 && l.replace(/[^A-Z]/g, '').length / l.length > 0.7;
};
const CONTACT = /(?:\+?251|\b0)[\s-]?9(?:[\s-]?\d){8}\b|[\w.+-]+@[\w-]+\.[a-z]{2,}|\bt\.me\/|\bwhats\s?app\b|\btelegram\b/i;
const VAGUE = /\b(etc\.?|and so on|any other (duties|tasks|work)|as (required|needed|assigned)|other duties|various (tasks|duties))\b/gi;

// ───────────── 1. A worker's own profile ─────────────

export interface ProfileInput {
  headline: string | null;
  bio: string | null;
  yearsExperience: number;
  skills: { years: number | null }[];
  experiences: { title: string; startDate: Date | string; endDate: Date | string | null; description: string | null; achievements: string | null }[];
  educationCount: number;
  certifications: { issuer: string | null }[];
  activityCount: number;
  languages: string[];
  languageLevels: Record<string, string>;
  hasCv: boolean;
  hasPhoto: boolean;
}

/** Months covered by the jobs (overlaps counted once) and the gaps between them, longest first. */
export function workTimeline(jobs: { title: string; startDate: Date | string; endDate: Date | string | null }[], now = new Date()) {
  const spans = jobs
    .map((j) => ({ title: j.title, start: new Date(j.startDate), end: j.endDate ? new Date(j.endDate) : now }))
    .filter((s) => !Number.isNaN(s.start.getTime()) && !Number.isNaN(s.end.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  let coveredDays = 0;
  const gaps: { months: number; after: string; before: string }[] = [];
  let reach: Date | null = null;
  let reachTitle = '';
  for (const s of spans) {
    if (reach === null || s.start > reach) {
      if (reach !== null) {
        const m = monthsBetween(reach, s.start);
        if (m > 12) gaps.push({ months: m, after: reachTitle, before: s.title });
      }
      coveredDays += daysBetween(s.start, s.end);
      reach = s.end;
      reachTitle = s.title;
    } else if (s.end > reach) {
      coveredDays += daysBetween(reach, s.end);
      reach = s.end;
      reachTitle = s.title;
    }
  }
  return { coveredMonths: Math.round(coveredDays / 30.44), gaps: gaps.sort((a, b) => b.months - a.months) };
}

export function reviewProfile(p: ProfileInput, now = new Date()): Review {
  const f: Finding[] = [];
  const add = (id: string, level: Level, text: string, link?: string) => f.push({ id, level, text, link });
  const headline = (p.headline ?? '').trim();
  const bio = (p.bio ?? '').trim();

  if (!headline) add('headline', 'fix', 'Add a headline: one line saying what you do, for example "Experienced minibus mechanic in Adama".', '/profile#section-about');
  else if (headline.length < 15 || /^(worker|job ?seeker|employee|looking for (a )?job|hard ?working( person)?)$/i.test(headline)) add('headline', 'improve', 'Your headline is very short or general. Say what you do and for how long or where.', '/profile#section-about');
  else if (shouting(headline)) add('headline', 'improve', 'Your headline is in capital letters. Normal capitals are easier to read.', '/profile#section-about');
  else add('headline', 'good', 'Your headline says what you do.');

  if (bio.length < 20) add('bio', 'fix', 'Write a short biography (at least a few sentences) about the work you can do.', '/profile#section-about');
  else {
    if (bio.length < 80) add('bio-short', 'improve', 'Your biography is very short. Two or three sentences about your work and strengths help employers.', '/profile#section-about');
    if (!/\d/.test(bio)) add('bio-numbers', 'improve', 'Add something concrete, such as years of work, number of jobs finished or tools you use. Numbers make a biography believable.', '/profile#section-about');
    if (shouting(bio)) add('bio-caps', 'improve', 'Your biography is mostly in capital letters. Normal capitals are easier to read.', '/profile#section-about');
    if (bio.length >= 80 && /\d/.test(bio) && !shouting(bio)) add('bio', 'good', 'Your biography is specific.');
  }
  if (CONTACT.test(bio) || CONTACT.test(headline)) add('contact-in-text', 'fix', 'Remove phone numbers, e-mail or chat links from your headline and biography. Employers reach you through the platform, and public contact details attract scams.', '/profile#section-about');

  if (p.skills.length < 3) add('skills', 'fix', `You list ${p.skills.length} skill${p.skills.length === 1 ? '' : 's'}. Add at least 3 of the skills you really have so you can be matched with jobs.`, '/profile#section-skills');
  else {
    add('skills', 'good', `You list ${p.skills.length} skills.`);
    if (p.skills.every((s) => s.years === null)) add('skill-years', 'improve', 'Add how many years you have used your main skills.', '/profile#section-skills');
  }

  const jobs = p.experiences;
  if (jobs.length === 0 && p.activityCount === 0 && p.educationCount === 0 && p.certifications.length === 0) {
    add('background', 'fix', 'Add some background: a job, an apprenticeship, training, volunteering or education. Informal and daily work counts too.', '/profile#section-experience');
  } else if (jobs.length > 0) {
    const { coveredMonths, gaps } = workTimeline(jobs, now);
    const undescribed = jobs.filter((j) => !(j.description ?? '').trim()).length;
    if (undescribed > 0) add('job-descriptions', 'improve', `${undescribed} of your ${jobs.length} job${jobs.length === 1 ? '' : 's'} ${undescribed === 1 ? 'has' : 'have'} no description. Say what you did there.`, '/profile#section-experience');
    if (jobs.every((j) => !(j.achievements ?? '').trim())) add('achievements', 'improve', 'None of your jobs lists an achievement. One line per job (what you improved, built or finished) stands out.', '/profile#section-experience');
    if (p.yearsExperience >= Math.round(coveredMonths / 12) + 3) {
      add('years-mismatch', 'improve', `Your profile says ${p.yearsExperience} years of experience, but the jobs you listed add up to about ${Math.round(coveredMonths / 12)}. Add the missing jobs, or correct the number.`, '/profile#section-experience');
    }
    for (const g of gaps.slice(0, 2)) {
      add(`gap-${g.after}`, 'improve', `There is a gap of about ${g.months} months between "${g.after}" and "${g.before}". If you studied, farmed, cared for family or did informal work, add it. A gap is not a problem when it is explained.`, '/profile#section-experience');
    }
    if (undescribed === 0 && gaps.length === 0) add('jobs', 'good', 'Your work history is described and continuous.');
  }

  if (p.certifications.some((c) => !(c.issuer ?? '').trim())) add('cert-issuer', 'improve', 'Some certificates have no issuer. Say who gave them (college, ministry, training centre).', '/profile#section-experience');

  const unlevelled = p.languages.filter((l) => !p.languageLevels[l]);
  if (p.languages.length === 0) add('languages', 'improve', 'List the languages you speak.', '/profile#section-about');
  else if (unlevelled.length > 0) add('language-levels', 'improve', `Say how well you speak ${unlevelled.slice(0, 3).join(', ')}${unlevelled.length > 3 ? ' and more' : ''}.`, '/profile#section-cvdetails');

  if (!p.hasPhoto) add('photo', 'improve', 'Add a clear profile photo.', '/profile#photo-and-cv');
  if (!p.hasCv) add('cv', 'improve', 'Upload your CV so employers can see the full picture.', '/profile#photo-and-cv');

  return pack(f);
}

// ───────────── 2. A job post, before it is published ─────────────

export interface JobPostInput {
  title: string;
  description: string;
  salaryMin: number | null;
  salaryMax: number | null;
  deadline: Date | string | null;
  skillCount: number;
  requiredSkillCount: number;
  hasLocation: boolean;
  schedule: string | null;
  benefits: string | null;
  minExperienceYears: number | null;
  remote: boolean;
}

export function reviewJobPost(j: JobPostInput): Review {
  const f: Finding[] = [];
  const add = (id: string, level: Level, text: string) => f.push({ id, level, text });
  const title = j.title.trim();
  const desc = j.description.trim();

  // Hard problems first: the same rules that stop or hold a post at publishing time, shown early.
  const bias = detectDiscrimination(title, desc, j.benefits, j.schedule);
  if (bias.length) add('bias', 'fix', discriminationMessage(bias));
  const scam = scanJobText({ title, description: desc, benefits: j.benefits, schedule: j.schedule });
  for (const s of scam.signals) {
    add(`scam-${s.code}`, s.weight >= 40 ? 'fix' : 'improve', `${s.label}. Found: "${s.evidence}". Posts with this wording can be held for an administrator to check.`);
  }

  if (title.length < 10) add('title', 'improve', 'The title is very short. Name the job and where or what kind, for example "Experienced welder, Adama".');
  else if (shouting(title) || /!{2,}/.test(title)) add('title', 'improve', 'The title is in capital letters or has repeated "!". A plain title looks more trustworthy.');
  else if (/\b(urgent(ly)?|hiring now|apply now)\b/i.test(title)) add('title', 'improve', 'Words like "urgent" in the title do not tell workers what the job is. Put the job name first.');
  else add('title', 'good', 'The title names the job.');

  const lines = desc.split(/\r?\n/).filter((l) => l.trim());
  if (desc.length < 150) add('length', 'improve', 'The description is short. Say what the worker will do each day, what is required, and what you offer.');
  else add('length', 'good', 'The description has enough detail.');
  if (desc.length >= 150 && lines.length < 3 && !/(requirements?|responsibilit|duties|qualifications|what you)/i.test(desc)) {
    add('structure', 'improve', 'The description is one block of text. Short parts such as "Duties" and "Requirements" are easier to read.');
  }
  if (shouting(desc)) add('caps', 'improve', 'Much of the description is in capital letters. Normal capitals are easier to read.');
  const vague = desc.match(VAGUE)?.length ?? 0;
  if (vague >= 2) add('vague', 'improve', `The description uses vague phrases (like "etc." or "any other duties") ${vague} times. Name the actual tasks.`);

  if (j.skillCount === 0) add('skills', 'improve', 'No skills are added. Without them the platform cannot match workers to this job.');
  else if (j.requiredSkillCount === 0) add('skills', 'improve', 'All skills are marked "preferred". Mark the ones that are truly needed as required so matching is accurate.');
  else add('skills', 'good', `${j.skillCount} skills added, ${j.requiredSkillCount} required.`);

  if (j.salaryMin === null && j.salaryMax === null) add('pay', 'improve', 'No pay is shown. Workers cannot compare the job. If pay depends on experience, say so in the description or give a range.');
  else if (j.salaryMin !== null && j.salaryMax !== null && j.salaryMin > 0 && j.salaryMax > j.salaryMin * 4) add('pay', 'improve', 'The pay range is very wide (the top is more than 4 times the bottom). A narrower range is clearer.');
  else add('pay', 'good', 'Pay is shown.');

  if (!j.hasLocation && !j.remote) add('location', 'improve', 'No place is set. Workers search by area, so add the region and town.');
  if (!j.deadline) add('deadline', 'improve', 'No deadline is set. A closing date tells workers how long they have to apply.');
  if (!(j.schedule ?? '').trim() && !j.remote) add('schedule', 'improve', 'No working hours or schedule are given.');
  if (/\b(entry[- ]level|junior|trainee|intern(ship)?|no experience)\b/i.test(`${title} ${desc}`) && (j.minExperienceYears ?? 0) > 2) {
    add('experience', 'improve', `The post sounds like an entry-level job but asks for ${j.minExperienceYears} years of experience. One of them may be a mistake.`);
  }

  return pack(f);
}

// ───────────── 3. An applicant, seen by the employer ─────────────

export interface ApplicantInput {
  match: {
    score: number;
    confidence: number;
    eligibility: string;
    matchedSkills: string[];
    missingSkills: string[];
    requiredCoverage: { required: number; covered: number };
    components: Record<string, { score: number | null; note: string } | undefined>;
    criteria: { met: { label: string }[]; unmet: { label: string; mustHave: boolean }[]; unknown: { label: string; mustHave: boolean }[] };
  } | null;
  coverNote: string | null;
  jobs: { title: string; startDate: Date | string; endDate: Date | string | null }[];
  hasCv: boolean;
}

export interface ApplicantReview {
  method: string;
  note: string;
  strengths: string[];
  gaps: string[];
  questions: string[];
}

const COMPONENT_LABEL: Record<string, string> = { skills: 'skills', experience: 'experience', location: 'location', qualification: 'education', availability: 'availability', preferences: 'pay and job-type preferences', criteria: 'sector requirements' };

export function reviewApplicant(a: ApplicantInput, now = new Date()): ApplicantReview {
  const strengths: string[] = [];
  const gaps: string[] = [];
  const questions: string[] = [];
  const m = a.match;

  if (m) {
    const { required, covered } = m.requiredCoverage;
    if (required > 0) {
      if (covered === required) strengths.push(`Covers all ${required} required skill${required === 1 ? '' : 's'}.`);
      else if (covered > 0) strengths.push(`Covers ${covered} of ${required} required skills.`);
    }
    if (m.matchedSkills.length) strengths.push(`Skills that match the job: ${m.matchedSkills.slice(0, 5).join(', ')}.`);
    for (const [key, c] of Object.entries(m.components)) {
      if (c && c.score !== null && c.score >= 0.85 && ['experience', 'location', 'qualification', 'availability'].includes(key)) strengths.push(`Good fit on ${COMPONENT_LABEL[key]}: ${c.note}`);
    }
    for (const c of m.criteria.met.slice(0, 3)) strengths.push(`Meets a sector requirement: ${c.label}.`);

    if (required > 0 && covered === 0 && m.missingSkills.length === 0) gaps.push('None of the required skills appear on the profile (it may list no skills yet).');
    if (m.missingSkills.length) {
      gaps.push(`No sign of: ${m.missingSkills.slice(0, 5).join(', ')}.`);
      for (const s of m.missingSkills.slice(0, 3)) questions.push(`Have you worked with ${s}? Tell me about a time you used it, or how fast you could learn it.`);
    }
    for (const [key, c] of Object.entries(m.components)) {
      if (c && c.score !== null && c.score < 0.5 && ['experience', 'location', 'qualification', 'availability'].includes(key)) {
        gaps.push(`Weaker fit on ${COMPONENT_LABEL[key]}: ${c.note}`);
        if (key === 'experience') questions.push('The job asks for more experience than the profile shows. What similar work have you done, formal or informal?');
        if (key === 'location') questions.push('How would you get to the workplace, or would you move? Is that realistic for you?');
        if (key === 'availability') questions.push('When exactly could you start?');
        if (key === 'qualification') questions.push('Do you have a certificate or training that is not on your profile?');
      }
    }
    for (const c of m.criteria.unmet.slice(0, 3)) {
      gaps.push(`${c.mustHave ? 'Must-have not met' : 'Not met'}: ${c.label}.`);
    }
    for (const c of m.criteria.unknown.slice(0, 3)) {
      gaps.push(`Not answered yet: ${c.label}.`);
      questions.push(`Can you confirm: ${c.label}? Please bring proof if you have it.`);
    }
    if (m.confidence < 0.6) gaps.push('The profile is incomplete, so the match score is based on little information. Ask for the missing details.');
  } else {
    gaps.push('No match score is available for this application.');
  }

  const { gaps: timeGaps } = workTimeline(a.jobs, now);
  for (const g of timeGaps.slice(0, 1)) {
    questions.push(`There is a gap of about ${g.months} months between "${g.after}" and "${g.before}". What were you doing then? (Ask neutrally: studying, family, farming or informal work are all normal answers.)`);
  }
  const short = a.jobs.filter((j) => j.endDate && monthsBetween(new Date(j.startDate), new Date(j.endDate)) < 6);
  if (a.jobs.length >= 3 && short.length >= 3) questions.push('Several jobs lasted under 6 months. What was each one, and what are you looking for in a longer job?');
  if (!a.hasCv) gaps.push('No CV is attached.');
  if (!(a.coverNote ?? '').trim()) questions.push('Why are you interested in this job in particular?');
  else if ((a.coverNote ?? '').trim().length >= 60) strengths.push('Wrote a real cover note.');

  return {
    method: REVIEW_VERSION,
    note: 'Prompts for your own review and interview, from fixed rules, not a language model. It does not decide anything and is not a reason to reject someone: a gap or a missing skill can have many explanations. Do not use it to ask about age, gender, religion, ethnicity or marital status.',
    strengths,
    gaps,
    questions: [...new Set(questions)].slice(0, 6),
  };
}
