// Does a worker's CV agree with the details they typed on their profile?
//
// Pure functions: the text of the CV and a snapshot of the profile go in, a verdict and the reasons come out.
//
// The rule for declining is deliberately narrow. A CV rarely lists everything a person has done, so a missing skill or a
// slightly different number is NOT a reason to decline. Only a clear contradiction is:
//   1. the CV does not carry the worker's name (it may be someone else's CV);
//   2. the profile claims education two or more levels above anything the CV shows;
//   3. the profile claims five or more years of experience beyond what the CV's dates add up to.
// Smaller differences (phone or email that differ, one level of education, three or four years) are shown as warnings
// and go with the application so the employer can see them. A CV that cannot be read is "unchecked", never declined.
import { EDUCATION_RANK } from '../matching/types';
import { findToken, hasEthiopic, tokensOf } from '../documents/match';

export type Severity = 'ok' | 'info' | 'warn' | 'block';
export interface Finding { code: string; severity: Severity; message: string; expected?: string; found?: string }
export type Outcome = 'ACCEPTED' | 'DECLINED' | 'UNCHECKED';

export interface ProfileFacts {
  fullName: string;
  phone: string; // +2519...
  email: string | null;
  yearsExperience: number;
  educationLevels: string[]; // as entered on the profile
  employers: string[]; // employer names entered under work experience
}
export interface CvFacts {
  text: string;
  confidence: number | null; // OCR confidence, null for text read straight from a PDF
  educationLevels: string[]; // as found by the CV reader
  hasEducationSection: boolean;
  estimatedYears: number | null; // from the dates of the jobs listed
  experienceEntries: number;
  /** false when the CV is read from pictures without Amharic support */
  canReadEthiopic: boolean;
}

export const MIN_CHARS = 80;
export const MIN_CONFIDENCE = 45;
export const EDUCATION_GAP_BLOCK = 2;
export const YEARS_GAP_BLOCK = 5;
export const YEARS_GAP_WARN = 3;

const phonesIn = (text: string): string[] => {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:\+?251|0)[\s\-.]?[79](?:[\s\-.]?\d){8}/g)) found.add(`+251${m[0].replace(/\D/g, '').slice(-9)}`);
  return [...found];
};
const emailsIn = (text: string): string[] => [...new Set([...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0].toLowerCase()))];
const rankOf = (levels: string[]) => Math.max(-1, ...levels.map((l) => EDUCATION_RANK[l] ?? -1));
const levelName = (r: number) => Object.entries(EDUCATION_RANK).find(([, v]) => v === r)?.[0].replace(/_/g, ' ').toLowerCase() ?? 'none';

export function checkProfileAgainstCv(profile: ProfileFacts, cv: CvFacts): { outcome: Outcome; findings: Finding[]; reason: string | null } {
  const chars = cv.text.replace(/\s/g, '').length;
  if (chars < MIN_CHARS) return { outcome: 'UNCHECKED', findings: [], reason: 'Not enough text could be read from the CV to compare it with your profile.' };
  if (cv.confidence !== null && cv.confidence < MIN_CONFIDENCE) return { outcome: 'UNCHECKED', findings: [], reason: 'The CV picture is too blurry or dark to read reliably.' };
  if (hasEthiopic(profile.fullName) && !cv.canReadEthiopic) return { outcome: 'UNCHECKED', findings: [], reason: 'Your name is written in Amharic script, which this server cannot read from pictures yet.' };

  const findings: Finding[] = [];
  const doc = tokensOf(cv.text);

  // 1. Name: the first two words (given and father's name) must be on the CV.
  const want = tokensOf(profile.fullName).slice(0, 2);
  const missing = want.filter((t) => !findToken(t, doc));
  if (want.length === 0) findings.push({ code: 'NAME', severity: 'info', message: 'Your account has no name to compare.' });
  else if (missing.length === 0) findings.push({ code: 'NAME', severity: 'ok', message: 'Your name is on the CV.', expected: profile.fullName });
  else findings.push({ code: 'NAME', severity: 'block', message: `The name on your account (${profile.fullName}) was not found on the CV. This CV may belong to someone else.`, expected: profile.fullName, found: `missing: ${missing.join(', ')}` });

  // 2. Phone and email: a different contact on the CV is worth knowing about, not a reason to decline.
  const phones = phonesIn(cv.text);
  if (phones.length === 0) findings.push({ code: 'PHONE', severity: 'info', message: 'The CV shows no phone number.' });
  else if (phones.includes(profile.phone)) findings.push({ code: 'PHONE', severity: 'ok', message: 'The phone number matches your account.' });
  else findings.push({ code: 'PHONE', severity: 'warn', message: 'The phone number on the CV is different from the one on your account.', expected: profile.phone, found: phones.join(', ') });
  const emails = emailsIn(cv.text);
  if (profile.email && emails.length > 0) {
    if (emails.includes(profile.email.toLowerCase())) findings.push({ code: 'EMAIL', severity: 'ok', message: 'The email address matches your account.' });
    else findings.push({ code: 'EMAIL', severity: 'warn', message: 'The email address on the CV is different from the one on your account.', expected: profile.email, found: emails.join(', ') });
  }

  // 3. Education: compare the highest level on the profile with the highest the CV shows.
  const claimed = rankOf(profile.educationLevels);
  if (claimed >= 0 && cv.hasEducationSection) {
    const shown = rankOf(cv.educationLevels);
    const gap = claimed - shown;
    if (gap >= EDUCATION_GAP_BLOCK) findings.push({ code: 'EDUCATION', severity: 'block', message: `Your profile says ${levelName(claimed)} but the highest education on the CV is ${shown >= 0 ? levelName(shown) : 'not stated'}.`, expected: levelName(claimed), found: shown >= 0 ? levelName(shown) : 'none' });
    else if (gap === 1) findings.push({ code: 'EDUCATION', severity: 'warn', message: `Your profile says ${levelName(claimed)} but the CV shows ${levelName(shown)}.`, expected: levelName(claimed), found: levelName(shown) });
    else findings.push({ code: 'EDUCATION', severity: 'ok', message: 'The education on the CV agrees with your profile.' });
  } else if (claimed >= 0) {
    findings.push({ code: 'EDUCATION', severity: 'info', message: 'The CV has no education section to compare with your profile.' });
  }

  // 4. Years of experience: only when the CV lists dated jobs to add up.
  if (cv.estimatedYears !== null && cv.experienceEntries > 0 && profile.yearsExperience > 0) {
    const gap = profile.yearsExperience - cv.estimatedYears;
    const detail = { expected: `${profile.yearsExperience} years`, found: `about ${cv.estimatedYears} years on the CV` };
    if (gap >= YEARS_GAP_BLOCK) findings.push({ code: 'EXPERIENCE', severity: 'block', message: `Your profile says ${profile.yearsExperience} years of experience but the jobs on the CV add up to about ${cv.estimatedYears}.`, ...detail });
    else if (gap >= YEARS_GAP_WARN) findings.push({ code: 'EXPERIENCE', severity: 'warn', message: `Your profile says ${profile.yearsExperience} years of experience; the CV shows about ${cv.estimatedYears}.`, ...detail });
    else findings.push({ code: 'EXPERIENCE', severity: 'ok', message: 'The experience on the CV agrees with your profile.' });
  }

  // 5. Employers named on the profile that the CV never mentions.
  const named = profile.employers.filter((e) => tokensOf(e).length > 0);
  if (named.length >= 2) {
    const absent = named.filter((e) => !tokensOf(e).some((t) => t.length >= 4 && findToken(t, doc)));
    if (absent.length === named.length) findings.push({ code: 'EMPLOYERS', severity: 'warn', message: 'None of the employers on your profile appear on the CV.', expected: named.join(', ') });
  }

  const blocked = findings.filter((f) => f.severity === 'block');
  return { outcome: blocked.length ? 'DECLINED' : 'ACCEPTED', findings, reason: blocked.length ? blocked.map((b) => b.message).join(' ') : null };
}
