import { z } from 'zod';
import { Prisma, type DocumentType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { deleteFileAsset, saveUpload } from '../files/storage';
import { workerIdFor } from '../workers/service';
import { orgIdFor } from '../jobs/service';
import { ocrLanguages } from '../analysis/ocr';
import { buildFields } from './compare';
import { integrityFlags, readDocument, type Flag } from './inspect';
import { bestLine, datesRead, decide, hasEthiopic, tokensOf, type FieldResult, type Outcome } from './match';
import { syncOrgVerification } from './orgVerification';
import { EMPLOYER_DOC_TYPES, WORKER_DOC_TYPES, employerRequirements, requestFor, type Needs } from './requirements';

// ───────── a worker's private details ─────────

const nameText = z.string().trim().min(2, 'Enter at least 2 letters').max(60).regex(/^[\p{L}\p{M}'’.\- ]+$/u, 'Use letters only');
const blankToNull = <T extends z.ZodTypeAny>(s: T) => z.union([z.literal('').transform(() => null), s, z.null()]);
export const ID_TYPES = ['KEBELE_ID', 'NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENCE'] as const;
const refNumber = z.string().trim().min(4, 'Enter at least 4 characters').max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 /\-.]*$/, 'Use letters, digits, spaces, / and - only');

export const identitySchema = z
  .object({
    fatherName: blankToNull(nameText),
    grandfatherName: blankToNull(nameText),
    dateOfBirth: blankToNull(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')),
    idType: blankToNull(z.enum(ID_TYPES)),
    idNumber: blankToNull(refNumber),
  })
  .partial()
  .strict();

const MIN_AGE = 14;
function parseDay(v: string, field: string): Date {
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw badRequest('That date does not exist', { [field]: ['Enter a real date'] });
  return d;
}
function parseBirthDate(v: string): Date {
  const d = parseDay(v, 'dateOfBirth');
  const age = (Date.now() - d.getTime()) / (365.25 * 86_400_000);
  if (age < MIN_AGE || age > 100) throw badRequest('Check the date of birth', { dateOfBirth: [`The date must be between ${MIN_AGE} and 100 years ago`] });
  return d;
}

type IdentityRow = { fatherName: string | null; grandfatherName: string | null; dateOfBirth: Date | null; idType: string | null; idNumber: string | null; verifiedAt: Date | null };
const identityView = (i: IdentityRow | null) => ({
  fatherName: i?.fatherName ?? null, grandfatherName: i?.grandfatherName ?? null,
  dateOfBirth: i?.dateOfBirth ? i.dateOfBirth.toISOString().slice(0, 10) : null,
  idType: i?.idType ?? null, idNumber: i?.idNumber ?? null, verified: !!i?.verifiedAt,
});

export async function getIdentity(userId: string) {
  const workerId = await workerIdFor(userId);
  return identityView(await prisma.workerIdentity.findUnique({ where: { workerId } }));
}

export async function saveIdentity(userId: string, input: z.infer<typeof identitySchema>) {
  const workerId = await workerIdFor(userId);
  const before = await prisma.workerIdentity.findUnique({ where: { workerId } });
  const data: Prisma.WorkerIdentityUncheckedUpdateInput = {};
  for (const k of ['fatherName', 'grandfatherName', 'idType', 'idNumber'] as const) if (input[k] !== undefined) data[k] = input[k];
  if (input.dateOfBirth !== undefined) data.dateOfBirth = input.dateOfBirth ? parseBirthDate(input.dateOfBirth) : null;
  // A verified identity that is then edited is no longer what the administrator looked at.
  const changed = (['fatherName', 'grandfatherName', 'idType', 'idNumber'] as const).some((k) => k in data && data[k] !== (before?.[k] ?? null))
    || ('dateOfBirth' in data && (data.dateOfBirth as Date | null)?.getTime() !== (before?.dateOfBirth?.getTime() ?? undefined));
  if (before?.verifiedAt && changed) data.verifiedAt = null;
  const row = await prisma.workerIdentity.upsert({ where: { workerId }, create: { ...(data as Prisma.WorkerIdentityUncheckedCreateInput), workerId }, update: data });
  return identityView(row);
}

// ───────── an employer's legal details ─────────

export const legalSchema = z
  .object({
    tin: blankToNull(z.string().trim().regex(/^[\d\s-]{10,14}$/, 'A TIN has 10 digits').transform((v) => v.replace(/\D/g, '')).refine((v) => v.length === 10, 'A TIN has 10 digits')),
    licenseNumber: blankToNull(refNumber),
    licenseExpiresAt: blankToNull(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')),
    registrationNumber: blankToNull(refNumber),
  })
  .partial()
  .strict();

const legalView = (l: { tin: string | null; licenseNumber: string | null; licenseExpiresAt: Date | null; registrationNumber: string | null } | null) => ({
  tin: l?.tin ?? null, licenseNumber: l?.licenseNumber ?? null, licenseExpiresAt: l?.licenseExpiresAt ? l.licenseExpiresAt.toISOString().slice(0, 10) : null, registrationNumber: l?.registrationNumber ?? null,
});

export async function getLegal(userId: string) {
  return legalView(await prisma.organizationLegal.findUnique({ where: { organizationId: await orgIdFor(userId) } }));
}
export async function saveLegal(userId: string, input: z.infer<typeof legalSchema>) {
  const organizationId = await orgIdFor(userId);
  const data: Prisma.OrganizationLegalUncheckedUpdateInput = {};
  for (const k of ['tin', 'licenseNumber', 'registrationNumber'] as const) if (input[k] !== undefined) data[k] = input[k];
  if (input.licenseExpiresAt !== undefined) {
    if (input.licenseExpiresAt) {
      const d = parseDay(input.licenseExpiresAt, 'licenseExpiresAt');
      if (d.getUTCFullYear() > new Date().getUTCFullYear() + 25) throw badRequest('Check the licence end date', { licenseExpiresAt: ['That date is too far ahead'] });
      data.licenseExpiresAt = d;
    } else data.licenseExpiresAt = null;
  }
  return legalView(await prisma.organizationLegal.upsert({ where: { organizationId }, create: { ...(data as Prisma.OrganizationLegalUncheckedCreateInput), organizationId }, update: data }));
}

// ───────── checking an upload ─────────

export interface CheckView {
  id: string; docType: DocumentType; educationId: string | null; experienceId: string | null; certificationId: string | null; outcome: Outcome; reason: string | null;
  fields: FieldResult[]; requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null; reviewNote: string | null; createdAt: Date;
}
type Stored = { items: FieldResult[]; reason: string | null };

/** What the person sees: the comparison and the review status, but not the administrators' warning signs. */
function viewOf(c: { id: string; docType: DocumentType; educationId: string | null; experienceId: string | null; certificationId: string | null; outcome: Outcome; fields: Prisma.JsonValue; createdAt: Date }, req: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; note: string | null } | null): CheckView {
  const stored = c.fields as unknown as Stored;
  return { id: c.id, docType: c.docType, educationId: c.educationId, experienceId: c.experienceId, certificationId: c.certificationId, outcome: c.outcome, reason: stored.reason, fields: stored.items, requestStatus: req?.status ?? null, reviewNote: req?.note ?? null, createdAt: c.createdAt };
}

/** The saved details a document is compared with must exist first, or there would be nothing to compare. */
function requireDetails(needs: Needs, w: { fatherName: string | null; dateOfBirth: Date | null } | null, legal: { tin: string | null; licenseNumber: string | null; licenseExpiresAt: Date | null } | null) {
  const missing: Record<string, string[]> = {};
  if ((needs === 'worker-dob' || needs === 'worker-birth') && !w?.dateOfBirth) missing.dateOfBirth = ['Enter your date of birth first'];
  if (needs === 'worker-birth' && !w?.fatherName) missing.fatherName = ["Enter your father's name first"];
  if (needs === 'org-tin' && !legal?.tin) missing.tin = ['Enter your organization\'s TIN first'];
  if (needs === 'org-license') {
    if (!legal?.licenseNumber) missing.licenseNumber = ['Enter the licence number first'];
    if (!legal?.licenseExpiresAt) missing.licenseExpiresAt = ['Enter the date the licence ends first'];
  }
  if (Object.keys(missing).length) throw badRequest('Fill in these details before uploading the document, so we can compare them', missing);
}

export async function submitDocument(userId: string, role: 'WORKER' | 'EMPLOYER', input: { docType: DocumentType; educationId?: string; experienceId?: string; certificationId?: string }, file: Express.Multer.File | undefined) {
  const audience = requestFor(input.docType).audience;
  if ((input.experienceId && input.docType !== 'EXPERIENCE_LETTER') || (input.certificationId && input.docType !== 'PROFESSIONAL_CERTIFICATE')) throw badRequest('This entry does not match the kind of document', { docType: ['Choose the document that fits this entry'] });
  if (audience !== role || !(role === 'WORKER' ? WORKER_DOC_TYPES : EMPLOYER_DOC_TYPES).includes(input.docType)) throw badRequest('This kind of document is not for your kind of account', { docType: ['Choose one of the documents listed for you'] });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
  let targetId: string;
  const ctx: Parameters<typeof buildFields>[1] = { fullName: user.fullName, today: new Date() };
  let educationId: string | null = null;
  let experienceId: string | null = null;
  let certificationId: string | null = null;
  let organizationId: string | null = null;

  if (role === 'WORKER') {
    const workerId = await workerIdFor(userId);
    const [identity, experiences] = await Promise.all([
      prisma.workerIdentity.findUnique({ where: { workerId } }),
      prisma.workExperience.findMany({ where: { workerId }, select: { employer: true } }),
    ]);
    ctx.worker = { fatherName: identity?.fatherName ?? null, grandfatherName: identity?.grandfatherName ?? null, dateOfBirth: identity?.dateOfBirth ?? null, idNumber: identity?.idNumber ?? null, employers: experiences.map((e) => e.employer ?? '').filter(Boolean) };
    requireDetails(input.docType === 'NATIONAL_ID' ? 'worker-dob' : input.docType === 'BIRTH_CERTIFICATE' ? 'worker-birth' : null, identity, null);
    targetId = workerId;
    if (input.docType === 'EDUCATION_CERTIFICATE') {
      if (!input.educationId) throw badRequest('Choose which education entry this certificate is for', { educationId: ['Required'] });
      const edu = await prisma.education.findFirst({ where: { id: input.educationId, workerId }, select: { id: true, level: true, institution: true, year: true, source: true } });
      if (!edu) throw notFound('That education entry is not on your profile');
      if (edu.source === 'VERIFIED') throw conflict('This education entry is already verified');
      ctx.education = edu;
      educationId = edu.id;
      targetId = edu.id;
    }
    if (input.docType === 'EXPERIENCE_LETTER' && input.experienceId) {
      const x = await prisma.workExperience.findFirst({ where: { id: input.experienceId, workerId }, select: { id: true, title: true, employer: true, startDate: true, endDate: true, source: true } });
      if (!x) throw notFound('That job is not on your profile');
      if (x.source === 'VERIFIED') throw conflict('This job is already verified');
      ctx.experience = { title: x.title, employer: x.employer, startYear: x.startDate.getUTCFullYear(), endYear: x.endDate ? x.endDate.getUTCFullYear() : null };
      experienceId = x.id;
      targetId = x.id;
    }
    if (input.docType === 'PROFESSIONAL_CERTIFICATE') {
      if (!input.certificationId) throw badRequest('Choose which certificate entry this is for', { certificationId: ['Required'] });
      const c = await prisma.certification.findFirst({ where: { id: input.certificationId, workerId }, select: { id: true, name: true, issuer: true, year: true, source: true } });
      if (!c) throw notFound('That certificate is not on your profile');
      if (c.source === 'VERIFIED') throw conflict('This certificate is already verified');
      ctx.certification = { name: c.name, issuer: c.issuer, year: c.year };
      certificationId = c.id;
      targetId = c.id;
    }
  } else {
    organizationId = await orgIdFor(userId);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, type: true, legal: true } });
    if (!employerRequirements(org.type).some((r) => r.key === input.docType)) throw badRequest('This document is not needed for your type of organization', { docType: ['Choose one of the documents listed for you'] });
    ctx.org = { name: org.name, tin: org.legal?.tin ?? null, licenseNumber: org.legal?.licenseNumber ?? null, licenseExpiresAt: org.legal?.licenseExpiresAt ?? null, registrationNumber: org.legal?.registrationNumber ?? null };
    const need = employerRequirements(org.type).find((r) => r.key === input.docType)!.needs;
    requireDetails(need, null, org.legal);
    targetId = organizationId;
  }

  const { kind, targetType } = requestFor(input.docType, !!experienceId);
  const approved = await prisma.verificationRequest.findFirst({ where: { userId, kind, targetType, targetId, status: 'APPROVED' }, select: { id: true } });
  if (approved) throw conflict('This document has already been approved');

  const asset = await saveUpload(userId, 'VERIFICATION_EVIDENCE', file);
  try {
    const read = await readDocument(file!.buffer, asset.mime);
    const items = buildFields(input.docType, ctx, read.text);
    // What the document itself says for each detail, so the result can be read side by side with what was typed.
    for (const f of items) {
      if (f.field === 'Date of birth') { const d = datesRead(read.text); if (d.length) f.read = d.join(', '); }
      else if (!['Year', 'Years', 'Level', 'Not expired', 'ID number', 'TIN', 'Licence number', 'Registration number'].includes(f.field)) { const l = bestLine(f.expected, read.text); if (l) f.read = l; }
    }

    // A name written in Ethiopic script cannot be compared unless the reader was given Amharic.
    const ethiopic = items.some((f) => f.required && hasEthiopic(f.expected));
    const decided = ethiopic && !ocrLanguages().includes('amh') && read.source === 'ocr'
      ? { outcome: 'UNREADABLE' as Outcome, reason: 'A name here is written in Amharic script, which this server cannot read from pictures yet. An administrator will compare it by eye.' }
      : read.problem && read.source === 'none'
        ? { outcome: 'UNREADABLE' as Outcome, reason: read.problem }
        : decide({ chars: tokensOf(read.text).join('').length, confidence: read.confidence, fields: items });

    const flags: Flag[] = await integrityFlags({ buffer: file!.buffer, mime: asset.mime, sha256: asset.sha256, userId, fileId: asset.id });

    // A new upload for the same item replaces the one still waiting for review.
    const waiting = await prisma.verificationRequest.findMany({ where: { userId, kind, targetType, targetId, status: 'PENDING' }, select: { id: true, evidenceFileId: true } });
    const [check, request] = await prisma.$transaction([
      prisma.documentCheck.create({
        data: {
          userId, fileId: asset.id, docType: input.docType, educationId, experienceId, certificationId, organizationId, outcome: decided.outcome,
          ocrConfidence: read.confidence, textChars: read.text.replace(/\s/g, '').length,
          fields: { items, reason: decided.reason } as unknown as Prisma.InputJsonValue, flags: flags as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.verificationRequest.create({ data: { userId, kind, targetType, targetId, evidenceFileId: asset.id } }),
      prisma.verificationRequest.deleteMany({ where: { id: { in: waiting.map((w) => w.id) } } }),
    ]);
    for (const w of waiting) await deleteFileAsset(w.evidenceFileId); // its check goes with the file
    if (organizationId) await syncOrgVerification(organizationId);
    return { check: viewOf(check, { status: request.status, note: null }), requestId: request.id };
  } catch (err) {
    await deleteFileAsset(asset.id); // never leave a file behind that is not attached to a request
    throw err;
  }
}

export async function myDocuments(userId: string): Promise<CheckView[]> {
  const rows = await prisma.documentCheck.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 80 });
  const reqs = await prisma.verificationRequest.findMany({ where: { userId, evidenceFileId: { in: rows.map((r) => r.fileId) } }, select: { evidenceFileId: true, status: true, note: true } });
  const byFile = new Map(reqs.map((r) => [r.evidenceFileId, r]));
  return rows.map((r) => viewOf(r, byFile.get(r.fileId) ?? null));
}

/** Withdraw a document that is still waiting for review (the file and its check go too). */
export async function withdrawDocument(userId: string, checkId: string) {
  const c = await prisma.documentCheck.findFirst({ where: { id: checkId, userId }, select: { fileId: true, organizationId: true } });
  if (!c) throw notFound('Document not found');
  const req = await prisma.verificationRequest.findFirst({ where: { userId, evidenceFileId: c.fileId } });
  if (req && req.status !== 'PENDING') throw conflict('This document has already been reviewed');
  if (req) await prisma.verificationRequest.delete({ where: { id: req.id } });
  await deleteFileAsset(c.fileId);
  if (c.organizationId) await syncOrgVerification(c.organizationId);
}
