import type { DocumentType, OrganizationType } from '@prisma/client';

// What each kind of user has to upload. Plain data, so it can be read and changed in one place.
// "Required" means the action it gates (applying for a job, publishing a job) is refused until a document of that kind has
// been submitted. Submitting is not the same as being verified: an administrator still reviews every document.

export type ItemKey = DocumentType | 'PHOTO' | 'CV';
/** Which details the person must save first so there is something to compare the document with. */
export type Needs = 'worker-dob' | 'worker-birth' | 'org-tin' | 'org-license' | null;

export interface Requirement {
  key: ItemKey;
  label: string;
  /** One sentence in plain words: what this is and where to get it. */
  description: string;
  required: boolean;
  /** What we look for on the document. */
  checks: string[];
  needs: Needs;
  /** "education": one upload for each education entry on the profile. */
  perEntry?: 'education' | 'experience' | 'certification';
  audience: 'WORKER' | 'EMPLOYER';
}

export const DOC_LABEL: Record<DocumentType, string> = {
  BIRTH_CERTIFICATE: 'Birth certificate',
  EDUCATION_CERTIFICATE: 'Education certificate',
  NATIONAL_ID: 'ID document',
  EXPERIENCE_LETTER: 'Experience or reference letter',
  PROFESSIONAL_CERTIFICATE: 'Professional or training certificate',
  BUSINESS_LICENSE: 'Business licence',
  TIN_CERTIFICATE: 'Tax (TIN) certificate',
  COMMERCIAL_REGISTRATION: 'Commercial registration certificate',
  REPRESENTATIVE_ID: "Your ID (the person who manages the account)",
  AUTHORIZATION_LETTER: 'Letter authorising you to act for the organization',
  ORG_REGISTRATION: 'Registration or accreditation certificate',
  GOVERNMENT_LETTER: 'Official letter from the office',
  AGENCY_LICENSE: 'Employment-agency licence',
};

export const WORKER_DOC_TYPES: DocumentType[] = ['NATIONAL_ID', 'BIRTH_CERTIFICATE', 'EDUCATION_CERTIFICATE', 'EXPERIENCE_LETTER', 'PROFESSIONAL_CERTIFICATE'];
export const EMPLOYER_DOC_TYPES: DocumentType[] = ['BUSINESS_LICENSE', 'TIN_CERTIFICATE', 'COMMERCIAL_REGISTRATION', 'REPRESENTATIVE_ID', 'AUTHORIZATION_LETTER', 'ORG_REGISTRATION', 'GOVERNMENT_LETTER', 'AGENCY_LICENSE'];

const W = 'WORKER' as const;
const E = 'EMPLOYER' as const;

export function workerRequirements(): Requirement[] {
  return [
    { key: 'NATIONAL_ID', audience: W, required: true, needs: 'worker-dob', label: DOC_LABEL.NATIONAL_ID, description: 'Your kebele ID, national (Fayda) ID, passport or driving licence. Front side, or the page with your photo and name.', checks: ['Your name', 'Date of birth', 'ID number (if you entered it)'] },
    { key: 'PHOTO', audience: W, required: true, needs: null, label: 'Profile photo', description: 'A clear photo of your face. Employers see it when you apply.', checks: [] },
    { key: 'BIRTH_CERTIFICATE', audience: W, required: false, needs: 'worker-birth', label: DOC_LABEL.BIRTH_CERTIFICATE, description: 'Adds proof of your date of birth and your father\'s name.', checks: ['Your name', "Father's name", 'Date of birth'] },
    { key: 'EDUCATION_CERTIFICATE', audience: W, required: false, needs: null, perEntry: 'education', label: DOC_LABEL.EDUCATION_CERTIFICATE, description: 'A certificate, diploma, degree or transcript for each school or training you list.', checks: ['Your name', 'School', 'Year', 'Level'] },
    { key: 'CV', audience: W, required: false, needs: null, label: 'CV', description: 'Your CV (PDF or a photo). It is compared with your profile; a CV that contradicts it is declined.', checks: ['Your name', 'Education', 'Years of experience'] },
    { key: 'EXPERIENCE_LETTER', audience: W, required: false, needs: null, label: DOC_LABEL.EXPERIENCE_LETTER, perEntry: 'experience', description: 'A letter from the employer (or a reference) that confirms you worked there. Upload one for each job you list.', checks: ['Your name', 'Employer', 'Job title', 'Years'] },
    { key: 'PROFESSIONAL_CERTIFICATE', audience: W, required: false, needs: null, perEntry: 'certification', label: DOC_LABEL.PROFESSIONAL_CERTIFICATE, description: 'A trade, competence (COC), training or professional certificate or licence for each one you list.', checks: ['Your name', 'Certificate name', 'Issuer', 'Year'] },
  ];
}

const REP = (required = true): Requirement => ({ key: 'REPRESENTATIVE_ID', audience: E, required, needs: null, label: DOC_LABEL.REPRESENTATIVE_ID, description: 'Your kebele or national ID, passport or driving licence. It must show the name on your account.', checks: ['Your name'] });
const LICENSE = (required = true): Requirement => ({ key: 'BUSINESS_LICENSE', audience: E, required, needs: 'org-license', label: DOC_LABEL.BUSINESS_LICENSE, description: 'The current trade or business licence from the trade bureau. It must be in date.', checks: ['Organization name', 'Licence number', 'Not expired'] });
const TIN = (required = true): Requirement => ({ key: 'TIN_CERTIFICATE', audience: E, required, needs: 'org-tin', label: DOC_LABEL.TIN_CERTIFICATE, description: 'The tax identification number certificate from the Ministry of Revenues.', checks: ['Organization name', 'TIN (10 digits)'] });
const COMMERCIAL: Requirement = { key: 'COMMERCIAL_REGISTRATION', audience: E, required: false, needs: null, label: DOC_LABEL.COMMERCIAL_REGISTRATION, description: 'The commercial registration certificate, if you have one.', checks: ['Organization name', 'Registration number (if you entered it)'] };
const AUTH = (required: boolean): Requirement => ({ key: 'AUTHORIZATION_LETTER', audience: E, required, needs: null, label: DOC_LABEL.AUTHORIZATION_LETTER, description: 'A signed letter from the organization saying you may recruit for it.', checks: ['Organization name', 'Your name'] });
const REGISTRATION = (label: string, required = true): Requirement => ({ key: 'ORG_REGISTRATION', audience: E, required, needs: null, label, description: 'The certificate that shows the organization is registered or accredited.', checks: ['Organization name', 'Registration number (if you entered it)'] });
const GOV_LETTER: Requirement = { key: 'GOVERNMENT_LETTER', audience: E, required: true, needs: null, label: DOC_LABEL.GOVERNMENT_LETTER, description: 'An official letter on the office letterhead, signed and stamped, authorising you to recruit.', checks: ['Organization name', 'Your name'] };
const AGENCY: Requirement = { key: 'AGENCY_LICENSE', audience: E, required: true, needs: null, label: DOC_LABEL.AGENCY_LICENSE, description: 'The private employment agency licence from the labour and skills bureau.', checks: ['Organization name'] };

/** The documents an employer must (and may) upload, by organization type. Mirrors the plain-words list in hiring/catalog.ts. */
export function employerRequirements(type: OrganizationType): Requirement[] {
  switch (type) {
    case 'PRIVATE_COMPANY': return [LICENSE(), TIN(), REP(), COMMERCIAL, AUTH(false)];
    case 'SME': return [LICENSE(), REP(), TIN(false)];
    case 'COOPERATIVE': return [REGISTRATION('Cooperative or association registration certificate'), REP(), TIN(false)];
    case 'PUBLIC_ENTERPRISE': return [REGISTRATION('Establishment or registration document'), AUTH(true), REP(), TIN(false)];
    case 'GOVERNMENT': return [GOV_LETTER, REP()];
    case 'NGO': return [REGISTRATION('Registration or accreditation certificate'), AUTH(true), REP(), TIN(false)];
    case 'INDIVIDUAL':
    case 'HOUSEHOLD': return [REP()];
    case 'RECRUITMENT_AGENCY': return [AGENCY, LICENSE(), REP(), TIN(false)];
    case 'TRAINING_INSTITUTION': return [REGISTRATION('Accreditation or registration document'), REP(), LICENSE(false)];
    default: return [LICENSE(), TIN(), REP()]; // older industry-flavoured types (construction, factory, hotel, agriculture)
  }
}

/** Documents are enforced unless DOCUMENTS_REQUIRED=false. Read at call time so a test or an operator can switch it. */
export const documentsRequired = () => (process.env.DOCUMENTS_REQUIRED ?? 'true').toLowerCase() !== 'false';

/** How an uploaded document becomes a review request: the kind shown to administrators and what it is about. */
export function requestFor(docType: DocumentType, forEntry = false): { kind: 'IDENTITY' | 'QUALIFICATION' | 'EMPLOYER'; targetType: string; audience: 'WORKER' | 'EMPLOYER' } {
  if (docType === 'BIRTH_CERTIFICATE') return { kind: 'IDENTITY', targetType: 'IDENTITY', audience: 'WORKER' }; // unchanged: older uploads use it
  if (docType === 'NATIONAL_ID') return { kind: 'IDENTITY', targetType: 'NATIONAL_ID', audience: 'WORKER' };
  if (docType === 'EDUCATION_CERTIFICATE') return { kind: 'QUALIFICATION', targetType: 'EDUCATION', audience: 'WORKER' };
  if (docType === 'PROFESSIONAL_CERTIFICATE') return { kind: 'QUALIFICATION', targetType: 'CERTIFICATION', audience: 'WORKER' };
  if (docType === 'EXPERIENCE_LETTER' && forEntry) return { kind: 'QUALIFICATION', targetType: 'EXPERIENCE', audience: 'WORKER' };
  if (docType === 'EXPERIENCE_LETTER') return { kind: 'QUALIFICATION', targetType: 'EXPERIENCE_LETTER', audience: 'WORKER' };
  return { kind: 'EMPLOYER', targetType: docType, audience: 'EMPLOYER' };
}
