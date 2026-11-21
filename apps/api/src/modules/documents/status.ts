import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { orgIdFor } from '../jobs/service';
import { workerIdFor } from '../workers/service';
import { latestCvCheck } from '../verification/service';
import { myDocuments, type CheckView } from './service';
import { documentsRequired, employerRequirements, workerRequirements, requestFor, type ItemKey, type Requirement } from './requirements';

export type ItemStatus = 'MISSING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DONE';
export interface ChecklistItem extends Omit<Requirement, 'audience'> {
  id: string; // unique in the list (an education certificate has one item per education entry)
  status: ItemStatus;
  check: CheckView | null;
  educationId?: string;
  experienceId?: string;
  certificationId?: string;
  detail?: string; // the education entry in words, or why the item cannot be uploaded yet
  /** What must be saved before this document can be uploaded (so there is something to compare). Empty when ready. */
  blockedBy: string[];
  /** CV only: how the last comparison with the profile went. */
  cvOutcome?: 'ACCEPTED' | 'DECLINED' | 'UNCHECKED' | null;
}
export interface Checklist { audience: 'WORKER' | 'EMPLOYER'; required: number; requiredDone: number; complete: boolean; enforced: boolean; items: ChecklistItem[]; organization?: { name: string; type: string; verificationStatus: string } }

const SENT: ItemStatus[] = ['SUBMITTED', 'APPROVED', 'DONE'];

function statusOf(check: CheckView | null): ItemStatus {
  if (!check) return 'MISSING';
  return check.requestStatus === 'APPROVED' ? 'APPROVED' : check.requestStatus === 'REJECTED' ? 'REJECTED' : check.requestStatus === 'PENDING' ? 'SUBMITTED' : 'MISSING';
}
/** The newest upload of this kind (for an education certificate: for this education entry). */
const latest = (docs: CheckView[], type: string, entry?: { educationId?: string; experienceId?: string; certificationId?: string }) =>
  docs.find((d) => d.docType === type && (!entry?.educationId || d.educationId === entry.educationId) && (!entry?.experienceId || d.experienceId === entry.experienceId) && (!entry?.certificationId || d.certificationId === entry.certificationId)) ?? null;

function blockers(needs: Requirement['needs'], w: { fatherName: string | null; dateOfBirth: Date | null } | null, l: { tin: string | null; licenseNumber: string | null; licenseExpiresAt: Date | null } | null): string[] {
  const out: string[] = [];
  if ((needs === 'worker-dob' || needs === 'worker-birth') && !w?.dateOfBirth) out.push('your date of birth');
  if (needs === 'worker-birth' && !w?.fatherName) out.push("your father's name");
  if (needs === 'org-tin' && !l?.tin) out.push('your TIN');
  if (needs === 'org-license') { if (!l?.licenseNumber) out.push('the licence number'); if (!l?.licenseExpiresAt) out.push('the date the licence ends'); }
  return out;
}

export async function workerChecklist(userId: string): Promise<Checklist> {
  const workerId = await workerIdFor(userId);
  const [docs, identity, profile, cv] = await Promise.all([
    myDocuments(userId),
    prisma.workerIdentity.findUnique({ where: { workerId } }),
    prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, select: { photoFileId: true, cvFileId: true, education: { select: { id: true, level: true, institution: true, year: true, source: true }, orderBy: { id: 'asc' } }, experiences: { select: { id: true, title: true, employer: true, startDate: true, endDate: true, source: true }, orderBy: { startDate: 'desc' } }, certifications: { select: { id: true, name: true, issuer: true, year: true, source: true }, orderBy: { id: 'asc' } } } }),
    latestCvCheck(workerId),
  ]);
  const items: ChecklistItem[] = [];
  for (const r of workerRequirements()) {
    const { audience: _a, ...base } = r;
    if (r.key === 'PHOTO') items.push({ ...base, id: 'PHOTO', status: profile.photoFileId ? 'DONE' : 'MISSING', check: null, blockedBy: [] });
    else if (r.key === 'CV') items.push({ ...base, id: 'CV', status: profile.cvFileId ? 'DONE' : 'MISSING', check: null, blockedBy: [], cvOutcome: profile.cvFileId ? cv?.outcome ?? null : null });
    else if (r.perEntry === 'education') {
      if (profile.education.length === 0) items.push({ ...base, id: 'EDUCATION_CERTIFICATE', required: false, status: 'MISSING', check: null, blockedBy: ['an education entry (add it in your profile first)'] });
      for (const e of profile.education) {
        const check = latest(docs, r.key, { educationId: e.id });
        items.push({ ...base, id: `EDUCATION_CERTIFICATE:${e.id}`, educationId: e.id, detail: [e.level.replace(/_/g, ' ').toLowerCase(), e.institution, e.year].filter(Boolean).join(' · '), status: e.source === 'VERIFIED' ? 'APPROVED' : statusOf(check), check, blockedBy: [] });
      }
    } else if (r.perEntry === 'experience' && profile.experiences.length > 0) {
      for (const x of profile.experiences) {
        const check = latest(docs, r.key, { experienceId: x.id });
        const years = [x.startDate.getUTCFullYear(), x.endDate ? x.endDate.getUTCFullYear() : 'now'].join(' to ');
        items.push({ ...base, id: `EXPERIENCE_LETTER:${x.id}`, experienceId: x.id, detail: [x.title, x.employer, years].filter(Boolean).join(' · '), status: x.source === 'VERIFIED' ? 'APPROVED' : statusOf(check), check, blockedBy: [] });
      }
    } else if (r.perEntry === 'certification') {
      if (profile.certifications.length === 0) items.push({ ...base, id: 'PROFESSIONAL_CERTIFICATE', status: 'MISSING', check: null, blockedBy: ['a certificate entry (add it under "Certifications and training" first)'] });
      for (const c of profile.certifications) {
        const check = latest(docs, r.key, { certificationId: c.id });
        items.push({ ...base, id: `PROFESSIONAL_CERTIFICATE:${c.id}`, certificationId: c.id, detail: [c.name, c.issuer, c.year].filter(Boolean).join(' · '), status: c.source === 'VERIFIED' ? 'APPROVED' : statusOf(check), check, blockedBy: [] });
      }
    } else {
      const check = latest(docs, r.key);
      items.push({ ...base, id: r.key, status: statusOf(check), check, blockedBy: blockers(r.needs, identity, null) });
    }
  }
  return summarize('WORKER', items);
}

export async function employerChecklist(userId: string): Promise<Checklist> {
  const orgId = await orgIdFor(userId);
  const [docs, org] = await Promise.all([myDocuments(userId), prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, type: true, verificationStatus: true, legal: true } })]);
  const items = employerRequirements(org.type).map((r): ChecklistItem => {
    const { audience: _a, ...base } = r;
    const check = latest(docs, r.key);
    return { ...base, id: r.key, status: statusOf(check), check, blockedBy: blockers(r.needs, null, org.legal) };
  });
  return { ...summarize('EMPLOYER', items), organization: { name: org.name, type: org.type, verificationStatus: org.verificationStatus } };
}

function summarize(audience: 'WORKER' | 'EMPLOYER', items: ChecklistItem[]): Checklist {
  const required = items.filter((i) => i.required);
  const done = required.filter((i) => SENT.includes(i.status));
  return { audience, required: required.length, requiredDone: done.length, complete: done.length === required.length, enforced: documentsRequired(), items };
}

export const checklistFor = (userId: string, role: 'WORKER' | 'EMPLOYER') => (role === 'WORKER' ? workerChecklist(userId) : employerChecklist(userId));

// ───────── the gates ─────────

const ACTIVE = ['PENDING', 'APPROVED'] as const;
const refused = (missing: string[], doing: string) =>
  new AppError(422, 'DOCUMENTS_REQUIRED', `Upload the required documents before ${doing}. Still to send: ${missing.join(', ')}. Open "My documents" in the menu.`, { missing, fix: ['Open "My documents", fill in the details and upload each required document. An administrator reviews them, but you can start as soon as they are sent.'] });

/** A worker must have sent an ID document and have a profile photo before applying for jobs. */
export async function assertWorkerDocuments(workerId: string) {
  if (!documentsRequired()) return;
  const [id, photo] = await Promise.all([
    prisma.verificationRequest.findFirst({ where: { kind: 'IDENTITY', targetType: 'NATIONAL_ID', targetId: workerId, status: { in: [...ACTIVE] } }, select: { id: true } }),
    prisma.workerProfile.findUnique({ where: { id: workerId }, select: { photoFileId: true } }),
  ]);
  const missing: string[] = [];
  if (!id) missing.push('ID document');
  if (!photo?.photoFileId) missing.push('Profile photo');
  if (missing.length) throw refused(missing, 'applying for a job');
}

/** An organization must have sent every required document for its type before it publishes a job. */
export async function assertOrgDocuments(orgId: string) {
  if (!documentsRequired()) return;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { type: true } });
  const sent = new Set((await prisma.verificationRequest.findMany({ where: { kind: 'EMPLOYER', targetId: orgId, status: { in: [...ACTIVE] }, targetType: { not: null } }, select: { targetType: true } })).map((r) => r.targetType));
  // an older organization verified under the single-document rule is not asked again
  const verified = await prisma.organization.count({ where: { id: orgId, verificationStatus: 'VERIFIED' } });
  if (verified) return;
  const missing = employerRequirements(org.type).filter((r) => r.required && !sent.has(requestFor(r.key as never).targetType)).map((r) => r.label);
  if (missing.length) throw refused(missing, 'publishing a job');
}

export type { ItemKey };
