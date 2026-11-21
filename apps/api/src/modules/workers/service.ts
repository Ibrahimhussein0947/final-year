import { trustOf } from './trust';
import { listPortfolio } from './portfolio';
import { workerCriteriaForEmployer } from '../criteria/service';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/errors';
import { scoreProfile } from './completion';
import { queueWorkerEmbedding } from '../matching/embeddings';
import { deleteFileAsset } from '../files/storage';

const counts = { select: { skills: true, education: true, certifications: true, experiences: true, activities: true } } as const;

export async function workerIdFor(userId: string): Promise<string> {
  const w = await prisma.workerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!w) throw notFound('Worker profile not found');
  return w.id;
}

export async function recomputeCompletion(workerId: string) {
  const p = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, include: { _count: counts } });
  const { pct } = scoreProfile(p);
  if (pct !== p.completionPct) await prisma.workerProfile.update({ where: { id: workerId }, data: { completionPct: pct } });
  // Called after every profile change, so this is also where the semantic embedding is kept fresh.
  queueWorkerEmbedding(workerId);
}

const locationInclude = {
  include: { parent: { include: { parent: { include: { parent: true } } } } },
} as const;

type LocWithParents = Prisma.LocationGetPayload<typeof locationInclude> | null;

/** Region > zone > woreda > kebele names, shallowest first. */
function locationChain(loc: LocWithParents, maxDepth = 4) {
  const chain: { id: string; level: string; name: string }[] = [];
  for (let cur: any = loc; cur; cur = cur.parent) chain.unshift({ id: cur.id, level: cur.level, name: cur.nameEn });
  return chain.slice(0, maxDepth);
}

const profileInclude = {
  _count: counts,
  location: locationInclude,
  category: true,
  skills: { include: { skill: { select: { id: true, nameEn: true, nameAm: true, nameOm: true, categoryId: true } } }, orderBy: { skill: { nameEn: 'asc' } } },
  education: { orderBy: { year: 'desc' } },
  certifications: { orderBy: { year: 'desc' } },
  experiences: { orderBy: { startDate: 'desc' } },
  activities: { orderBy: [{ kind: 'asc' }, { endDate: 'desc' }] },
} satisfies Prisma.WorkerProfileInclude;

const fileUrl = (id: string | null) => (id ? `/api/v1/files/${id}` : null);

const skillOut = (s: {
  skillId: string;
  proficiency: number;
  years: number | null;
  source: 'SELF_REPORTED' | 'VERIFIED';
  testedScore: number | null;
  testedAt: Date | null;
  skill: { nameEn: string; categoryId: string };
}) => ({
  skillId: s.skillId,
  name: s.skill.nameEn,
  categoryId: s.skill.categoryId,
  proficiency: s.proficiency,
  years: s.years,
  source: s.source, // SELF_REPORTED or VERIFIED: the UI must show the difference
  // Passed the skill test: shows what they could answer on the day. Different from VERIFIED, and not used in matching.
  tested: s.testedAt ? { score: s.testedScore, at: s.testedAt } : null,
});

/** The owner's own view: includes exact GPS, completion checklist and CV link. */
export async function getOwnProfile(workerId: string) {
  const p = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, include: profileInclude });
  const completion = scoreProfile(p);
  const { embedding: _e, embeddingModel: _m, _count: _c, location, category, skills, education, certifications, activities, ...rest } = p;
  return {
    ...rest,
    photoUrl: fileUrl(p.photoFileId),
    cvUrl: fileUrl(p.cvFileId),
    category: category ? { id: category.id, name: category.nameEn } : null,
    locationPath: locationChain(location),
    skills: skills.map(skillOut),
    education: education.map(({ evidenceFileId, ...e }) => ({ ...e, documentUrl: fileUrl(evidenceFileId) })),
    certifications: certifications.map(({ evidenceFileId, ...c }) => ({ ...c, documentUrl: fileUrl(evidenceFileId) })),
    activities: activities.map(({ evidenceFileId, ...a }) => ({ ...a, documentUrl: fileUrl(evidenceFileId) })),
    completion,
  };
}

/** What an employer or admin may see. No contact details, no exact coordinates, no CV. */
export async function getPublicProfile(
  workerId: string,
  viewerUserId: string,
  opts: { /** the worker applied to this employer, so a hidden profile is still shown */ viaApplication?: boolean; showPhone?: boolean } = {},
) {
  const p = await prisma.workerProfile.findFirst({
    where: { id: workerId, ...(opts.viaApplication ? {} : { isVisible: true }), user: { status: 'ACTIVE' } },
    include: { ...profileInclude, user: { select: { id: true, fullName: true, phone: true, phoneVerifiedAt: true } } },
  });
  if (!p) throw notFound('Worker not found');
  if (p.userId !== viewerUserId) {
    await prisma.workerProfile.update({ where: { id: p.id }, data: { profileViews: { increment: 1 } } });
  }
  return {
    id: p.id,
    fullName: p.user.fullName,
    phoneVerified: !!p.user.phoneVerifiedAt,
    trust: await trustOf(p.id),
    portfolio: await listPortfolio(p.id),
    // Only revealed by the caller once the worker has applied and been shortlisted (see applications/transitions.ts).
    contact: opts.showPhone ? { phone: p.user.phone } : null,
    headline: p.headline,
    bio: p.bio,
    occupation: p.occupation,
    category: p.category ? { id: p.category.id, name: p.category.nameEn } : null,
    yearsExperience: p.yearsExperience,
    expectedSalaryMin: p.expectedSalaryMin,
    expectedSalaryMax: p.expectedSalaryMax,
    preferredTypes: p.preferredTypes,
    preferredWorkModes: p.preferredWorkModes,
    availability: p.availability,
    availableFrom: p.availableFrom,
    willingToRelocate: p.willingToRelocate,
    maxTravelKm: p.maxTravelKm,
    languages: p.languages,
    portfolioUrls: p.portfolioUrls,
    photoUrl: fileUrl(p.photoFileId),
    // Administrative area only (down to woreda), never kebele.
    locationPath: locationChain(p.location, 3),
    // Approximate position, rounded to 2 decimals (about 1 km). Exact coordinates are never shared.
    approxLocation: p.lat !== null && p.lng !== null ? { lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 } : null,
    skills: p.skills.map(skillOut),
    // A document link is given only when the worker applied to this employer; the file route enforces the same rule.
    education: p.education.map(({ id, level, field, institution, department, gpa, gpaScale, year, source, evidenceFileId }) => ({ id, level, field, institution, department, gpa, gpaScale, year, source, hasDocument: !!evidenceFileId, documentUrl: opts.viaApplication ? fileUrl(evidenceFileId) : null })),
    certifications: p.certifications.map(({ id, name, issuer, year, source, evidenceFileId }) => ({ id, name, issuer, year, source, hasDocument: !!evidenceFileId, documentUrl: opts.viaApplication ? fileUrl(evidenceFileId) : null })),
    activities: p.activities.map(({ id, kind, title, organization, startDate, endDate, hours, description, source, evidenceFileId }) => ({ id, kind, title, organization, startDate, endDate, hours, description, source, hasDocument: !!evidenceFileId, documentUrl: opts.viaApplication ? fileUrl(evidenceFileId) : null })),
    experiences: p.experiences.map(({ id, title, employer, startDate, endDate, description, source, evidenceFileId }) => ({ id, title, employer, startDate, endDate, description, source, hasDocument: !!evidenceFileId, documentUrl: opts.viaApplication ? fileUrl(evidenceFileId) : null })),
    // Answers to the sector questions, with verified marks (self-reported otherwise).
    sectorAnswers: await workerCriteriaForEmployer(p.id),
  };
}

export async function updateProfile(workerId: string, data: Prisma.WorkerProfileUncheckedUpdateInput & { locationId?: string | null; categoryId?: string | null }) {
  if (data.locationId) {
    const loc = await prisma.location.findUnique({ where: { id: data.locationId as string }, select: { id: true } });
    if (!loc) throw badRequest('Unknown location', { locationId: ['Choose a valid location'] });
  }
  if (data.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: data.categoryId as string }, select: { id: true } });
    if (!cat) throw badRequest('Unknown category', { categoryId: ['Choose a valid category'] });
  }
  await prisma.workerProfile.update({ where: { id: workerId }, data });
  await recomputeCompletion(workerId);
}

const MAX_SKILLS = 50;

export async function upsertSkill(workerId: string, skillId: string, proficiency: number, years?: number | null) {
  const skill = await prisma.skill.findFirst({ where: { id: skillId, isActive: true }, select: { id: true } });
  if (!skill) throw notFound('Skill not found');
  const existing = await prisma.workerSkill.findUnique({ where: { workerId_skillId: { workerId, skillId } } });
  if (!existing && (await prisma.workerSkill.count({ where: { workerId } })) >= MAX_SKILLS) {
    throw badRequest(`You can list at most ${MAX_SKILLS} skills`);
  }
  // `source` is never writable here: users cannot mark their own skills as verified.
  await prisma.workerSkill.upsert({
    where: { workerId_skillId: { workerId, skillId } },
    update: { proficiency, years: years ?? null },
    create: { workerId, skillId, proficiency, years: years ?? null, source: 'SELF_REPORTED' },
  });
  await recomputeCompletion(workerId);
}

export async function removeSkill(workerId: string, skillId: string) {
  await prisma.workerSkill.deleteMany({ where: { workerId, skillId } });
  await recomputeCompletion(workerId);
}

// ── Education, certifications, work history: owner-scoped CRUD ──

type Child = 'education' | 'certification' | 'workExperience' | 'profileActivity';

function delegate(kind: Child) {
  return prisma[kind] as unknown as {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
}

export async function createChild(kind: Child, workerId: string, data: Record<string, unknown>) {
  if (kind === 'workExperience' && data.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: data.categoryId as string }, select: { id: true } });
    if (!cat) throw badRequest('Unknown category', { categoryId: ['Choose a valid category'] });
  }
  // `source` defaults to SELF_REPORTED in the schema and is not part of the input.
  const row = await delegate(kind).create({ data: { ...data, workerId } });
  await recomputeCompletion(workerId);
  return row;
}

export async function updateChild(kind: Child, workerId: string, id: string, data: Record<string, unknown>) {
  // workerId in the filter enforces ownership: someone else's row simply matches nothing.
  if (kind === 'workExperience') {
    // A verified job that is then edited is no longer what the administrator looked at.
    const before = await prisma.workExperience.findFirst({ where: { id, workerId }, select: { source: true, title: true, employer: true, startDate: true, endDate: true } });
    const same = before && data.title === before.title && (data.employer ?? null) === before.employer
      && (data.startDate as Date | undefined)?.getTime() === before.startDate.getTime()
      && ((data.endDate as Date | null | undefined)?.getTime() ?? null) === (before.endDate?.getTime() ?? null);
    if (before && before.source === 'VERIFIED' && !same) data = { ...data, source: 'SELF_REPORTED', evidenceFileId: null };
  }
  const { count } = await delegate(kind).updateMany({ where: { id, workerId }, data });
  if (!count) throw notFound();
}

type WithEvidence = { findFirst(a: unknown): Promise<{ evidenceFileId: string | null } | null> };

/** Attach (or replace) a supporting document. The item stays self-reported: only an administrator's review marks anything verified. */
export async function attachDocument(kind: Exclude<Child, 'workExperience'>, workerId: string, id: string, fileId: string): Promise<string | null> {
  const row = await (prisma[kind] as unknown as WithEvidence).findFirst({ where: { id, workerId }, select: { evidenceFileId: true } });
  if (!row) throw notFound();
  await delegate(kind).updateMany({ where: { id, workerId }, data: { evidenceFileId: fileId } });
  return row.evidenceFileId; // the replaced file, for the caller to delete
}

export async function deleteChild(kind: Child, workerId: string, id: string) {
  if (kind !== 'workExperience') {
    const old = await (prisma[kind] as unknown as WithEvidence).findFirst({ where: { id, workerId }, select: { evidenceFileId: true } });
    await deleteFileAsset(old?.evidenceFileId ?? null);
  }
  const { count } = await delegate(kind).deleteMany({ where: { id, workerId } });
  if (!count) throw notFound();
  await recomputeCompletion(workerId);
}
