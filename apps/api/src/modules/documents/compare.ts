import type { DocumentType } from '@prisma/client';
import {
  dateOfBirthFound, extractDates, fatherResult, institutionResult, levelFound, nameResult, numberResult, tokensOf, yearFound, type FieldResult,
} from './match';

// What to look for on each kind of document. Pure: the details the person typed and the text read from the file go in,
// the list of "found / not found" details comes out. Required details decide the result; the others only add information.

export interface CompareContext {
  /** The name on the account. */
  fullName: string;
  worker?: { fatherName: string | null; grandfatherName: string | null; dateOfBirth: Date | null; idNumber: string | null; employers: string[] };
  education?: { level: string; institution: string | null; year: number | null } | null;
  experience?: { title: string; employer: string | null; startYear: number; endYear: number | null } | null;
  certification?: { name: string; issuer: string | null; year: number | null } | null;
  org?: { name: string; tin: string | null; licenseNumber: string | null; licenseExpiresAt: Date | null; registrationNumber: string | null };
  today: Date;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

function dobField(dob: Date, text: string, required: boolean): FieldResult {
  const r = dateOfBirthFound({ y: dob.getUTCFullYear(), m: dob.getUTCMonth() + 1, d: dob.getUTCDate() }, extractDates(text));
  return {
    field: 'Date of birth', expected: day(dob), required, status: r.found ? 'FOUND' : r.close ? 'CLOSE' : 'NOT_FOUND',
    note: r.found ? (r.via === 'ethiopian' ? 'matched as an Ethiopian-calendar date' : undefined)
      : r.close ? 'a date differing by one digit was read; it may be a reading mistake'
      : r.datesSeen === 0 ? 'no date could be read' : 'dates were read, but none equals this one',
  };
}

/** The licence must not be past its end date. Uses the date the person typed, which is what the document was compared with. */
function notExpired(expires: Date, today: Date): FieldResult {
  const ok = expires.getTime() >= Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return { field: 'Not expired', expected: `valid until ${day(expires)}`, required: true, status: ok ? 'FOUND' : 'NOT_FOUND', ...(ok ? {} : { note: `expired on ${day(expires)}` }) };
}

export function buildFields(docType: DocumentType, ctx: CompareContext, text: string): FieldResult[] {
  const doc = tokensOf(text);
  const out: FieldResult[] = [];
  const person = () => out.push(nameResult('Your name', ctx.fullName, doc, true));
  // A company's legal-form words (PLC, Share Company...) are written many ways, so its distinctive words must be there, not every word.
  const orgName = () => ctx.org && out.push(institutionResult(ctx.org.name, doc, { field: 'Organization name', required: true, threshold: 0.8 }));
  const w = ctx.worker;
  const o = ctx.org;

  switch (docType) {
    case 'NATIONAL_ID':
      person();
      if (w?.dateOfBirth) out.push(dobField(w.dateOfBirth, text, true));
      if (w?.idNumber) out.push(numberResult('ID number', w.idNumber, text, true));
      break;
    case 'BIRTH_CERTIFICATE':
      person();
      if (w?.fatherName) out.push(fatherResult("Father's name", w.fatherName, ctx.fullName, doc, true));
      if (w?.grandfatherName) out.push(fatherResult("Grandfather's name", w.grandfatherName, ctx.fullName, doc, false));
      if (w?.dateOfBirth) out.push(dobField(w.dateOfBirth, text, true));
      break;
    case 'EDUCATION_CERTIFICATE':
      person();
      if (ctx.education?.institution) out.push(institutionResult(ctx.education.institution, doc));
      if (ctx.education?.year) out.push({ field: 'Year', expected: String(ctx.education.year), required: false, status: yearFound(ctx.education.year, text) ? 'FOUND' : 'NOT_FOUND' });
      if (ctx.education) out.push({ field: 'Level', expected: ctx.education.level.replace(/_/g, ' ').toLowerCase(), required: false, status: levelFound(ctx.education.level, text) ? 'FOUND' : 'NOT_FOUND' });
      break;
    case 'EXPERIENCE_LETTER': {
      person();
      if (ctx.experience) {
        const x = ctx.experience;
        if (x.employer) out.push(institutionResult(x.employer, doc, { field: 'Employer', required: true, threshold: 0.6 }));
        out.push(institutionResult(x.title, doc, { field: 'Job title', required: false, threshold: 0.6 }));
        const years = [x.startYear, x.endYear].filter((y): y is number => y !== null);
        const seen = new Set([...text.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])));
        // a letter dated in the Ethiopian calendar is 7 or 8 years behind
        const hit = years.some((y) => [y, y - 7, y - 8].some((c) => seen.has(c)));
        out.push({ field: 'Years', expected: years.join(' to '), required: false, status: hit ? 'FOUND' : 'NOT_FOUND' });
        break;
      }
      const employers = (w?.employers ?? []).filter(Boolean);
      if (employers.length) {
        const hit = employers.find((e) => institutionResult(e, doc).status === 'FOUND');
        out.push({ field: 'Employer', expected: hit ?? employers.join(', '), required: false, status: hit ? 'FOUND' : 'NOT_FOUND' });
      }
      break;
    }
    case 'PROFESSIONAL_CERTIFICATE':
      person();
      if (ctx.certification) {
        const c = ctx.certification;
        out.push(institutionResult(c.name, doc, { field: 'Certificate name', required: true, threshold: 0.6 }));
        if (c.issuer) out.push(institutionResult(c.issuer, doc, { field: 'Issuer', required: false }));
        if (c.year) out.push({ field: 'Year', expected: String(c.year), required: false, status: yearFound(c.year, text) ? 'FOUND' : 'NOT_FOUND' });
      }
      break;
    case 'REPRESENTATIVE_ID':
      person();
      break;
    case 'BUSINESS_LICENSE':
      orgName();
      if (o?.licenseNumber) out.push(numberResult('Licence number', o.licenseNumber, text, true));
      if (o?.licenseExpiresAt) out.push(notExpired(o.licenseExpiresAt, ctx.today));
      out.push({ ...nameResult('Owner or manager', ctx.fullName, doc, false) });
      break;
    case 'AGENCY_LICENSE':
      orgName();
      if (o?.licenseExpiresAt) out.push(notExpired(o.licenseExpiresAt, ctx.today));
      break;
    case 'TIN_CERTIFICATE':
      orgName();
      if (o?.tin) out.push(numberResult('TIN', o.tin, text, true));
      break;
    case 'COMMERCIAL_REGISTRATION':
    case 'ORG_REGISTRATION':
      orgName();
      if (o?.registrationNumber) out.push(numberResult('Registration number', o.registrationNumber, text, true));
      break;
    case 'AUTHORIZATION_LETTER':
    case 'GOVERNMENT_LETTER':
      orgName();
      person();
      break;
  }
  return out;
}
