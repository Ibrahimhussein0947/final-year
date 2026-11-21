import { assertOrgDocuments } from '../documents/status';
import { typesInGroup } from '../hiring/catalog';
import { segmentFilter } from './segments';
import { DAYS_PER_MONTH, HOURS_PER_DAY, WEEKS_PER_MONTH } from './classification';
import { getPolicy, liveJobProblems } from '../hiring/service';
import { jobCriteriaView, validateJobCriteria } from '../criteria/service';
import { detectDiscrimination, discriminationMessage } from '../criteria/discrimination';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { jobFingerprint, similarity } from './similarity';
import { scanJobText } from './scamCheck';
import { queueJobEmbedding } from '../matching/embeddings';
import { notifyNewJobMatches } from '../matching/service';
import { notifySavedSearchMatches } from './savedSearches';
import { assertCanFeature, assertCanPublish } from '../subscriptions/service';
import { logger } from '../../lib/logger';
import type { JobCreateInput, JobUpdateInput } from './schema';
import { listQuerySchema } from './schema';
import type { z } from 'zod';

const NEAR_DUPLICATE_THRESHOLD = 0.85;
const EDITABLE: Prisma.JobWhereInput['status'] = { in: ['DRAFT', 'ACTIVE', 'PENDING_REVIEW'] };

export async function orgIdFor(userId: string): Promise<string> {
  const ep = await prisma.employerProfile.findUnique({ where: { userId }, select: { organizationId: true } });
  if (!ep) throw notFound('Employer profile not found');
  return ep.organizationId;
}

const locInclude = { include: { parent: { include: { parent: { include: { parent: true } } } } } } as const;
export const detailInclude = {
  organization: { select: { id: true, name: true, type: true, description: true, website: true, verificationStatus: true } },
  category: { select: { id: true, slug: true, nameEn: true } },
  location: locInclude,
  skills: { include: { skill: { select: { id: true, nameEn: true } } } },
  criteria: { include: { criterion: true } },
} satisfies Prisma.JobInclude;
type JobFull = Prisma.JobGetPayload<{ include: typeof detailInclude }>;

function locationPath(loc: unknown): { id: string; level: string; name: string }[] {
  const out: { id: string; level: string; name: string }[] = [];
  for (let cur = loc as any; cur; cur = cur.parent) out.unshift({ id: cur.id, level: cur.level, name: cur.nameEn });
  return out;
}

const isExpired = (j: { deadline: Date | null }) => !!j.deadline && j.deadline.getTime() < Date.now();
const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/** Card shown in lists. Job-site coordinates are rounded for anyone but the owner. */
export function toListItem(j: JobFull) {
  return {
    id: j.id,
    title: j.title,
    status: j.status,
    organization: { id: j.organization.id, name: j.organization.name, verified: j.organization.verificationStatus === 'VERIFIED', type: j.organization.type },
    category: { id: j.category.id, slug: j.category.slug, name: j.category.nameEn },
    employmentType: j.employmentType,
    workMode: j.workMode,
    seniority: j.seniority,
    openTo: j.openTo,
    workplace: j.workplace,
    recruitmentMethod: j.recruitmentMethod,
    payBasis: j.payBasis,
    benefitTags: j.benefitTags,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    currency: j.currency,
    vacancies: j.vacancies,
    deadline: j.deadline,
    publishedAt: j.publishedAt,
    featured: j.featuredAt !== null && j.status === 'ACTIVE',
    locationPath: locationPath(j.location),
    skills: j.skills.filter((s) => s.importance === 'REQUIRED').slice(0, 5).map((s) => s.skill.nameEn),
  };
}

export function toDetail(j: JobFull, isOwner: boolean) {
  return {
    ...toListItem(j),
    description: j.description,
    benefits: j.benefits,
    schedule: j.schedule,
    startDate: j.startDate,
    languages: j.languages,
    referenceNumber: j.referenceNumber,
    minExperienceYears: j.minExperienceYears,
    requiredEducationLevel: j.requiredEducationLevel,
    approxLocation: j.lat !== null && j.lng !== null ? { lat: round2(j.lat), lng: round2(j.lng) } : null,
    expired: isExpired(j),
    organization: { ...toListItem(j).organization, description: j.organization.description, website: j.organization.website, type: j.organization.type },
    allSkills: j.skills.map((s) => ({ skillId: s.skillId, name: s.skill.nameEn, importance: s.importance, minProficiency: s.minProficiency })),
    criteria: jobCriteriaView(j.criteria),
    ...(isOwner ? { exact: { lat: j.lat, lng: j.lng }, categoryId: j.categoryId, locationId: j.locationId, extractionApprovedAt: j.extractionApprovedAt } : {}),
  };
}

/** Job text may describe the work, not demand a gender, age range, religion, ethnicity or marital status. */
function assertJobTextIsJobRelated(input: { title?: string; description?: string; benefits?: string | null; schedule?: string | null }) {
  const findings = detectDiscrimination(input.title, input.description, input.benefits, input.schedule);
  if (findings.length) {
    const message = discriminationMessage(findings);
    throw badRequest('This job text contains a requirement that is not allowed', { description: [message] });
  }
}

/** A reference number identifies one vacancy of the organization. */
async function assertReferenceFree(orgId: string, reference: string | null | undefined, exceptJobId?: string) {
  if (!reference) return;
  const clash = await prisma.job.findFirst({ where: { organizationId: orgId, referenceNumber: reference, status: { not: 'REMOVED' }, ...(exceptJobId ? { id: { not: exceptJobId } } : {}) }, select: { id: true } });
  if (clash) throw conflict('Another job of your organization already uses this reference number');
}

async function validateRefs(input: { categoryId?: string; locationId?: string | null; skills?: { skillId: string }[] }) {
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) {
    throw badRequest('Unknown category', { categoryId: ['Choose a valid category'] });
  }
  if (input.locationId && !(await prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true } }))) {
    throw badRequest('Unknown location', { locationId: ['Choose a valid location'] });
  }
  if (input.skills?.length) {
    const found = await prisma.skill.count({ where: { id: { in: input.skills.map((s) => s.skillId) }, isActive: true } });
    if (found !== input.skills.length) throw badRequest('Unknown skill', { skills: ['One or more skills do not exist'] });
  }
}

export async function createJob(orgId: string, userId: string, input: JobCreateInput) {
  assertJobTextIsJobRelated(input);
  await assertReferenceFree(orgId, input.referenceNumber);
  await validateRefs(input);
  const { skills, criteria, extractionReviewed, ...data } = input;
  const checkedCriteria = await validateJobCriteria(input.categoryId, criteria);
  const job = await prisma.job.create({
    data: {
      ...data,
      extractionApprovedAt: extractionReviewed ? new Date() : null,
      organizationId: orgId,
      postedById: userId,
      status: 'DRAFT',
      descriptionHash: jobFingerprint(input.title, input.description),
      skills: { create: skills.map((s) => ({ skillId: s.skillId, importance: s.importance, minProficiency: s.minProficiency ?? null })) },
      criteria: { create: checkedCriteria },
    },
  });
  queueJobEmbedding(job.id);
  return job.id;
}

export async function ownedJob(orgId: string, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, organizationId: orgId, status: { not: 'REMOVED' } } });
  if (!job) throw notFound('Job not found');
  return job;
}

export async function updateJob(orgId: string, jobId: string, input: JobUpdateInput) {
  const job = await ownedJob(orgId, jobId);
  if (!['DRAFT', 'ACTIVE', 'PENDING_REVIEW'].includes(job.status)) throw conflict('Closed jobs cannot be edited. Reopen it first.');
  assertJobTextIsJobRelated(input);
  await assertReferenceFree(orgId, input.referenceNumber, jobId);
  await validateRefs(input);
  const { skills, criteria, extractionReviewed, ...data } = input;
  if (job.status === 'ACTIVE') {
    // A live vacancy keeps obeying the hiring rules of its organization type when it is edited (e.g. the closing date cannot be pulled forward).
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { type: true } });
    const problems = liveJobProblems(await getPolicy(org.type), {
      deadline: data.deadline !== undefined ? data.deadline : job.deadline,
      salaryMin: data.salaryMin !== undefined ? data.salaryMin : job.salaryMin,
      salaryMax: data.salaryMax !== undefined ? data.salaryMax : job.salaryMax,
      referenceNumber: data.referenceNumber !== undefined ? data.referenceNumber : job.referenceNumber,
    }, { startsAt: job.publishedAt ?? new Date(), verified: true, checkVerified: false });
    if (Object.keys(problems).length) throw badRequest('This change breaks the hiring rules for your organization type', problems);
  }
  const nextCategoryId = data.categoryId ?? job.categoryId;
  const checkedCriteria = criteria ? await validateJobCriteria(nextCategoryId, criteria) : null;

  const textChanged =
    (data.title !== undefined && data.title !== job.title) || (data.description !== undefined && data.description !== job.description);
  const next: Prisma.JobUncheckedUpdateInput = { ...data };
  if (extractionReviewed) next.extractionApprovedAt = new Date();
  if (textChanged) {
    next.descriptionHash = jobFingerprint(data.title ?? job.title, data.description ?? job.description);
    // Anti-abuse: a live job from an unverified organization goes back for review when its wording changes.
    if (env.reviewUnverifiedJobs && job.status === 'ACTIVE') {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { verificationStatus: true } });
      if (org.verificationStatus !== 'VERIFIED') next.status = 'PENDING_REVIEW';
    }
    // Rewording a live job into a scam is the obvious loophole, so edited text is screened again.
    if (job.status === 'ACTIVE' && scanJobText({
      title: data.title ?? job.title,
      description: data.description ?? job.description,
      benefits: data.benefits !== undefined ? data.benefits : job.benefits,
      schedule: data.schedule !== undefined ? data.schedule : job.schedule,
    }).flagged) next.status = 'PENDING_REVIEW';
  }
  await prisma.$transaction(async (tx) => {
    await tx.job.update({ where: { id: jobId }, data: next });
    if (skills) {
      await tx.jobSkill.deleteMany({ where: { jobId } });
      await tx.jobSkill.createMany({ data: skills.map((s) => ({ jobId, skillId: s.skillId, importance: s.importance, minProficiency: s.minProficiency ?? null })) });
    }
    if (checkedCriteria) {
      await tx.jobCriterion.deleteMany({ where: { jobId } });
      await tx.jobCriterion.createMany({ data: checkedCriteria.map((c) => ({ jobId, ...c })) });
    } else if (data.categoryId && data.categoryId !== job.categoryId) {
      // Moving the job to another sector: requirements that belong to the old sector no longer make sense.
      await tx.jobCriterion.deleteMany({ where: { jobId, criterion: { categoryId: { not: null } } } });
    }
  });
  queueJobEmbedding(jobId);
}

export async function publishJob(orgId: string, userId: string, jobId: string, confirmNotDuplicate = false) {
  // Plan limit first: no point checking the rest of a job the organization may not publish.
  await assertCanPublish(orgId, jobId);
  // The documents an organization of this type has to send before it posts jobs.
  await assertOrgDocuments(orgId);
  const job = await prisma.job.findFirst({ where: { id: jobId, organizationId: orgId, status: { not: 'REMOVED' } }, include: { skills: true, organization: true } });
  if (!job) throw notFound('Job not found');
  if (!['DRAFT', 'CLOSED'].includes(job.status)) throw conflict(`Job is already ${job.status.toLowerCase().replace('_', ' ')}`);

  const problems: Record<string, string[]> = {};
  if (!job.skills.some((s) => s.importance === 'REQUIRED')) problems.skills = ['Add at least one required skill'];
  if (job.workMode !== 'REMOTE' && !job.locationId) problems.locationId = ['Choose a location for on-site or hybrid jobs'];
  if (job.deadline && job.deadline.getTime() <= Date.now()) problems.deadline = ['The application deadline must be in the future'];
  if (job.deadline && job.deadline.getTime() > Date.now() + 366 * 86_400_000) problems.deadline = ['The deadline must be within one year'];
  // Rules that depend on the kind of organization (government, public enterprise, NGO...).
  const policyProblems = liveJobProblems(await getPolicy(job.organization.type), job, { startsAt: new Date(), verified: job.organization.verificationStatus === 'VERIFIED', checkVerified: true });
  for (const [k, msgs] of Object.entries(policyProblems)) problems[k] = [...(problems[k] ?? []), ...msgs.filter((m) => !(problems[k] ?? []).includes(m))];
  if (Object.keys(problems).length) throw badRequest('This job is not ready to publish', problems);

  // Duplicate detection against the organization's own live postings.
  const siblings = await prisma.job.findMany({
    where: { organizationId: orgId, id: { not: jobId }, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } },
    select: { id: true, title: true, description: true, descriptionHash: true },
  });
  const exact = siblings.find((s) => s.descriptionHash === job.descriptionHash);
  if (exact) throw new AppError(409, 'DUPLICATE_JOB', 'You already have an identical job posted', { jobId: [exact.id] });
  if (!confirmNotDuplicate) {
    for (const s of siblings) {
      const sim = similarity(`${job.title} ${job.description}`, `${s.title} ${s.description}`);
      if (sim >= NEAR_DUPLICATE_THRESHOLD) {
        throw new AppError(409, 'NEAR_DUPLICATE_JOB', `This looks very similar to "${s.title}". Publish anyway only if it is a different position.`, {
          jobId: [s.id], similarity: [sim.toFixed(2)],
        });
      }
    }
  }
  // The same text posted by a different organization is a spam signal: hold it for admin review.
  const copied = await prisma.job.count({
    where: { descriptionHash: job.descriptionHash, organizationId: { not: orgId }, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } },
  });

  // Scam screening: risky wording holds the job for an administrator, whatever the organization's verification status.
  const scam = scanJobText(job);
  if (scam.flagged) logger.warn({ jobId, orgId, score: scam.score, signals: scam.signals.map((s) => s.code) }, 'job held for scam review');

  const needsReview = copied > 0 || scam.flagged || (env.reviewUnverifiedJobs && job.organization.verificationStatus !== 'VERIFIED');
  const status = needsReview ? 'PENDING_REVIEW' : 'ACTIVE';
  const firstPublish = !job.publishedAt;
  await prisma.job.update({ where: { id: jobId }, data: { status, publishedAt: job.publishedAt ?? new Date() } });
  // Alert the best-matching workers, once, when a job first goes live (not on every reopen). Best effort.
  if (status === 'ACTIVE' && firstPublish) {
    await notifyNewJobMatches(jobId).catch((err) => logger.warn({ err: String(err), jobId }, 'job match alerts failed'));
    await notifySavedSearchMatches(jobId).catch((err) => logger.warn({ err: String(err), jobId }, 'saved search alerts failed'));
  }
  return { status, flaggedAsCopy: copied > 0, flaggedAsRisky: scam.flagged, userId };
}

export async function setJobClosed(orgId: string, jobId: string, status: 'CLOSED' | 'FILLED') {
  const job = await ownedJob(orgId, jobId);
  if (!['ACTIVE', 'PENDING_REVIEW'].includes(job.status)) throw conflict('Only live jobs can be closed');
  // A closed job is no longer featured, so reopening it never silently exceeds the plan's cap.
  await prisma.job.update({ where: { id: jobId }, data: { status, featuredAt: null } });
}

/** Show a live job first in the public search with a "Featured" label, within the plan's cap. Or take the feature off. */
export async function setJobFeatured(orgId: string, jobId: string, featured: boolean) {
  const job = await ownedJob(orgId, jobId);
  if (!featured) {
    await prisma.job.update({ where: { id: jobId }, data: { featuredAt: null } });
    return;
  }
  if (job.status !== 'ACTIVE') throw conflict('Only jobs that are open for applications can be featured');
  if (job.featuredAt) return; // already featured
  await assertCanFeature(orgId, jobId);
  await prisma.job.update({ where: { id: jobId }, data: { featuredAt: new Date() } });
}

export async function deleteJob(orgId: string, jobId: string) {
  const job = await ownedJob(orgId, jobId);
  if (job.status !== 'DRAFT') throw conflict('Only drafts can be deleted. Close a published job instead.');
  await prisma.job.delete({ where: { id: jobId } });
}

export async function myJobs(orgId: string) {
  const jobs = await prisma.job.findMany({
    where: { organizationId: orgId, status: { not: 'REMOVED' } },
    include: { ...detailInclude, _count: { select: { applications: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  return jobs.map((j) => ({ ...toListItem(j), expired: isExpired(j), updatedAt: j.updatedAt, applicationCount: j._count.applications }));
}

// ───────── Public search ─────────

type ListQuery = z.infer<typeof listQuerySchema>;
const EDUCATION_ORDER = ['NONE', 'PRIMARY', 'SECONDARY', 'VOCATIONAL_CERTIFICATE', 'DIPLOMA', 'BACHELOR', 'MASTER', 'DOCTORATE'] as const;

export async function searchJobs(q: ListQuery, extraWhere?: Prisma.JobWhereInput) {
  const and: Prisma.JobWhereInput[] = [
    { status: 'ACTIVE' },
    { OR: [{ deadline: null }, { deadline: { gte: new Date() } }] },
    ...(extraWhere ? [extraWhere] : []),
  ];
  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { description: { contains: q.q, mode: 'insensitive' } },
        { organization: { name: { contains: q.q, mode: 'insensitive' } } },
        { skills: { some: { skill: { OR: [{ nameEn: { contains: q.q, mode: 'insensitive' } }, { aliases: { has: q.q.toLowerCase() } }] } } } },
      ],
    });
  }
  if (q.categoryId) and.push({ categoryId: q.categoryId });
  if (q.category) and.push({ category: { slug: q.category } });
  if (q.type) and.push({ employmentType: q.type });
  if (q.mode) and.push({ workMode: q.mode });
  if (q.minSalary) {
    // The minimum is per month. Daily, weekly and hourly pay is compared after bringing it to a month; pay that is not a fixed
    // amount over time (per project, commission, negotiable ...) is not compared here.
    const m = q.minSalary;
    and.push({
      OR: [
        { OR: [{ payBasis: null }, { payBasis: 'MONTHLY' }], salaryMax: { gte: m } },
        { payBasis: 'WEEKLY', salaryMax: { gte: Math.ceil(m / WEEKS_PER_MONTH) } },
        { payBasis: 'DAILY', salaryMax: { gte: Math.ceil(m / DAYS_PER_MONTH) } },
        { payBasis: 'HOURLY', salaryMax: { gte: Math.ceil(m / (HOURS_PER_DAY * DAYS_PER_MONTH)) } },
      ],
    });
  }
  if (q.workplace) and.push({ workplace: q.workplace });
  if (q.recruitmentMethod) and.push({ recruitmentMethod: q.recruitmentMethod });
  if (q.payBasis) and.push({ payBasis: q.payBasis });
  if (q.benefit) and.push({ benefitTags: { has: q.benefit } });
  if (q.hasSalary === 'true') and.push({ OR: [{ salaryMin: { not: null } }, { salaryMax: { not: null } }] });
  if (q.flexible === 'true') {
    and.push({
      OR: [
        { employmentType: { in: ['PART_TIME', 'TEMPORARY', 'DAILY', 'SEASONAL', 'FREELANCE', 'CASUAL', 'GIG', 'ON_CALL'] } },
        { workMode: { in: ['REMOTE', 'HYBRID'] } },
        { schedule: { contains: 'flexib', mode: 'insensitive' } },
      ],
    });
  }
  if (q.startWithin !== undefined) and.push({ OR: [{ startDate: null }, { startDate: { lte: new Date(Date.now() + q.startWithin * 86_400_000) } }] });
  if (q.postedWithin) and.push({ publishedAt: { gte: new Date(Date.now() - q.postedWithin * 86_400_000) } });
  if (q.maxExperience !== undefined) and.push({ OR: [{ minExperienceYears: null }, { minExperienceYears: { lte: q.maxExperience } }] });
  if (q.maxEducation) {
    const allowed = EDUCATION_ORDER.slice(0, EDUCATION_ORDER.indexOf(q.maxEducation) + 1);
    and.push({ OR: [{ requiredEducationLevel: null }, { requiredEducationLevel: { in: allowed } }] });
  }
  if (q.language) and.push({ OR: [{ languages: { isEmpty: true } }, { languages: { has: q.language } }, { languages: { has: q.language.charAt(0).toUpperCase() + q.language.slice(1).toLowerCase() } }] });
  if (q.skills.length) and.push({ skills: { some: { skillId: { in: q.skills } } } });
  if (q.verifiedOnly === 'true') and.push({ organization: { verificationStatus: 'VERIFIED' } });
  if (q.segment) and.push(segmentFilter(q.segment));
  if (q.seniority) and.push({ seniority: q.seniority });
  if (q.openTo) and.push({ openTo: { has: q.openTo } });
  if (q.employerGroup) and.push({ organization: { type: { in: typesInGroup(q.employerGroup) } } });

  // A place filter matches the place itself or anything inside it (up to 4 levels deep).
  let placeId = q.locationId;
  if (!placeId && q.region) {
    placeId = (await prisma.location.findFirst({ where: { level: 'REGION', nameEn: { equals: q.region, mode: 'insensitive' } }, select: { id: true } }))?.id;
    if (!placeId) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
  }
  if (placeId) {
    and.push({
      OR: [
        { locationId: placeId },
        { location: { parentId: placeId } },
        { location: { parent: { parentId: placeId } } },
        { location: { parent: { parent: { parentId: placeId } } } },
      ],
    });
  }

  const where: Prisma.JobWhereInput = { AND: and };
  const orderBy: Prisma.JobOrderByWithRelationInput[] =
    q.sort === 'deadline'
      ? [{ deadline: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }]
      : q.sort === 'salary'
        ? [{ salaryMax: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }]
        : [{ featuredAt: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }]; // featured jobs first, then newest

  const [total, rows] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({ where, orderBy, include: detailInclude, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { items: rows.map(toListItem), total, page: q.page, pageSize: q.pageSize };
}

/** Public jobs are live and unexpired. Owners and admins can also see their own drafts and closed jobs. */
export async function getJob(jobId: string, viewer?: { id: string; role: string }) {
  const job = await prisma.job.findFirst({ where: { id: jobId, status: { not: 'REMOVED' } }, include: detailInclude });
  if (!job) throw notFound('Job not found');
  let isOwner = false;
  if (viewer?.role === 'EMPLOYER') {
    const ep = await prisma.employerProfile.findUnique({ where: { userId: viewer.id }, select: { organizationId: true } });
    isOwner = ep?.organizationId === job.organizationId;
  }
  const isAdmin = viewer?.role === 'ADMIN';
  const publicNow = job.status === 'ACTIVE' && !isExpired(job);
  if (!publicNow && !isOwner && !isAdmin) throw notFound('Job not found');
  return toDetail(job, isOwner);
}
