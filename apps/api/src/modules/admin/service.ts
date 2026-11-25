import { syncOrgVerification } from '../documents/orgVerification';
import { DOC_LABEL } from '../documents/requirements';
import { describeValue } from '../criteria/validate';
import type { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { disconnectUser } from '../../realtime';
import { notify } from '../notifications/service';
import { notifyNewJobMatches } from '../matching/service';
import { notifySavedSearchMatches } from '../jobs/savedSearches';
import { scanJobText } from '../jobs/scamCheck';
import { clearMatchingCaches } from '../matching/weights';
import { clearSkillIndexCache } from '../analysis/skillIndex';

// ───────── Overview ─────────

export async function platformStats() {
  const [users, workers, employers, jobs, activeJobs, applications, recruitments, pendingVerifications, openReports, pendingJobs, suspended, unverifiedOrgs] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'WORKER' } }),
    prisma.user.count({ where: { role: 'EMPLOYER' } }),
    prisma.job.count({ where: { status: { not: 'REMOVED' } } }),
    prisma.job.count({ where: { status: 'ACTIVE', OR: [{ deadline: null }, { deadline: { gte: new Date() } }] } }),
    prisma.application.count(),
    prisma.application.count({ where: { status: 'ACCEPTED' } }),
    prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
    prisma.report.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
    prisma.job.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    prisma.organization.count({ where: { verificationStatus: { not: 'VERIFIED' } } }),
  ]);
  return {
    users, workers, employers, jobs, activeJobs, applications,
    successfulRecruitments: recruitments, pendingVerifications, openReports, suspiciousAds: pendingJobs, suspendedUsers: suspended, unverifiedOrganizations: unverifiedOrgs,
  };
}

// ───────── Users ─────────

export async function listUsers(q: { q?: string; role?: string; status?: string; page: number; pageSize: number }) {
  const where: Prisma.UserWhereInput = {
    ...(q.role ? { role: q.role as Prisma.EnumRoleFilter['equals'] } : {}),
    ...(q.status ? { status: q.status as Prisma.EnumAccountStatusFilter['equals'] } : {}),
    ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q.replace(/\s/g, '') } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: {
        id: true, fullName: true, phone: true, email: true, role: true, status: true, createdAt: true, lastLoginAt: true,
        phoneVerifiedAt: true, emailVerifiedAt: true,
        employerProfile: { select: { organization: { select: { name: true, verificationStatus: true } } } },
      },
    }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((u) => ({
      id: u.id, fullName: u.fullName, phone: u.phone, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      phoneVerified: !!u.phoneVerifiedAt, emailVerified: !!u.emailVerifiedAt,
      organization: u.employerProfile ? { name: u.employerProfile.organization.name, verificationStatus: u.employerProfile.organization.verificationStatus } : null,
    })),
  };
}

/**
 * Suspend or reactivate an account. Administrators cannot be changed here (use the command-line tool), and an
 * administrator cannot suspend themselves. Suspending revokes every session and closes live connections.
 */
export async function setUserStatus(adminId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED') {
  if (adminId === userId) throw forbidden('You cannot change your own account status');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } });
  if (!user) throw notFound('User not found');
  if (user.role === 'ADMIN') throw forbidden('Administrator accounts cannot be changed here');
  if (user.status === 'DELETED') throw conflict('This account was deleted');
  if (user.status === status) return { id: userId, status, changed: false };
  await prisma.user.update({ where: { id: userId }, data: { status } });
  if (status === 'SUSPENDED') {
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    disconnectUser(userId);
  }
  return { id: userId, status, changed: true };
}

// ───────── Verification requests ─────────

export async function listVerifications(q: { status?: string; kind?: string }) {
  const rows = await prisma.verificationRequest.findMany({
    where: { ...(q.status ? { status: q.status as 'PENDING' } : {}), ...(q.kind ? { kind: q.kind as 'EMPLOYER' } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: {
      user: { select: { id: true, fullName: true, role: true, employerProfile: { select: { organization: { select: { id: true, name: true, type: true, verificationStatus: true } } } }, workerProfile: { select: { id: true } } } },
    },
  });
  const items = [];
  for (const r of rows) {
    let target: string | null = null;
    if (r.kind === 'QUALIFICATION' && r.targetId) {
      if (r.targetType === 'EDUCATION') {
        const e = await prisma.education.findUnique({ where: { id: r.targetId }, select: { level: true, field: true, institution: true, year: true } });
        target = e ? [e.level, e.field, e.institution, e.year].filter(Boolean).join(' · ') : '(removed by the worker)';
      } else if (r.targetType === 'EXPERIENCE') {
        const x = await prisma.workExperience.findUnique({ where: { id: r.targetId }, select: { title: true, employer: true, startDate: true, endDate: true } });
        target = x ? `Job: ${[x.title, x.employer].filter(Boolean).join(' at ')}, ${x.startDate.getUTCFullYear()} to ${x.endDate ? x.endDate.getUTCFullYear() : 'now'}` : '(removed by the worker)';
      } else if (r.targetType === 'CERTIFICATION') {
        const c = await prisma.certification.findUnique({ where: { id: r.targetId }, select: { name: true, issuer: true, year: true } });
        target = c ? [c.name, c.issuer, c.year].filter(Boolean).join(' · ') : '(removed by the worker)';
      } else if (r.targetType === 'CRITERION') {
        const c = await prisma.workerCriterion.findUnique({ where: { id: r.targetId }, include: { criterion: true } });
        target = c ? `${c.criterion.labelEn}: ${describeValue(c.criterion, c.value)}` : '(removed by the worker)';
      }
    } else if (r.kind === 'SKILL' && r.targetId) {
      target = (await prisma.skill.findUnique({ where: { id: r.targetId }, select: { nameEn: true } }))?.nameEn ?? null;
    } else if (r.kind === 'EMPLOYER') {
      target = r.user.employerProfile?.organization.name ?? null;
    } else if (r.kind === 'IDENTITY') {
      const i = r.targetId ? await prisma.workerIdentity.findUnique({ where: { workerId: r.targetId } }) : null;
      const born = i?.dateOfBirth ? i.dateOfBirth.toISOString().slice(0, 10) : '-';
      target = !i ? null : r.targetType === 'NATIONAL_ID'
        ? `ID document: ${r.user.fullName}, born ${born}${i.idNumber ? `, ${i.idType ? `${i.idType.replace(/_/g, ' ').toLowerCase()} ` : 'number '}${i.idNumber}` : ''}`
        : `Birth certificate: ${r.user.fullName}, father ${i.fatherName ?? '-'}${i.grandfatherName ? `, grandfather ${i.grandfatherName}` : ''}, born ${born}`;
    }
    if (r.kind === 'EMPLOYER' && r.targetType && r.targetId) {
      const o = await prisma.organization.findUnique({ where: { id: r.targetId }, select: { name: true, type: true, legal: true } });
      const l = o?.legal;
      target = o ? `${DOC_LABEL[r.targetType as keyof typeof DOC_LABEL] ?? r.targetType}: ${o.name} (${o.type.replace(/_/g, ' ').toLowerCase()})${l?.tin ? `, TIN ${l.tin}` : ''}${l?.licenseNumber ? `, licence ${l.licenseNumber}` : ''}${l?.licenseExpiresAt ? ` until ${l.licenseExpiresAt.toISOString().slice(0, 10)}` : ''}${l?.registrationNumber ? `, registration ${l.registrationNumber}` : ''}` : null;
    }
    // What the system could and could not match in the uploaded document (a hint for the reviewer, never a verdict).
    const c = r.evidenceFileId ? await prisma.documentCheck.findUnique({ where: { fileId: r.evidenceFileId } }) : null;
    const stored = c ? (c.fields as unknown as { items: unknown[]; reason: string | null }) : null;
    items.push({
      check: c && stored ? { docType: c.docType, outcome: c.outcome, reason: stored.reason, fields: stored.items, flags: c.flags, ocrConfidence: c.ocrConfidence, textChars: c.textChars } : null,
      id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt, reviewedAt: r.reviewedAt, note: r.note,
      requester: { id: r.user.id, name: r.user.fullName, role: r.user.role },
      organization: r.user.employerProfile?.organization ?? null,
      target,
      evidenceUrl: r.evidenceFileId ? `/api/v1/files/${r.evidenceFileId}` : null,
    });
  }
  return items;
}

/**
 * Approve or reject a request. "Verified" is only ever set here, by an administrator who has looked at the
 * evidence; users cannot set it on their own records.
 */
export async function reviewVerification(adminId: string, requestId: string, decision: 'APPROVED' | 'REJECTED', note: string | null) {
  const r = await prisma.verificationRequest.findUnique({
    where: { id: requestId },
    include: { user: { select: { id: true, employerProfile: { select: { organizationId: true } }, workerProfile: { select: { id: true } } } } },
  });
  if (!r) throw notFound('Request not found');
  if (r.status !== 'PENDING') throw conflict('This request was already reviewed');
  if (decision === 'REJECTED' && !note) throw badRequest('Say why the request was rejected so the person can fix it', { note: ['Required when rejecting'] });
  if (decision === 'APPROVED' && !r.evidenceFileId && r.kind !== 'PHONE' && r.kind !== 'EMAIL') throw badRequest('There is no evidence to approve');

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.verificationRequest.update({ where: { id: requestId }, data: { status: decision, reviewedById: adminId, reviewedAt: new Date(), note } }),
  ];
  if (r.kind === 'EMPLOYER') {
    const orgId = r.user.employerProfile?.organizationId;
    if (!orgId) throw conflict('This employer no longer has an organization');
    // One of several documents: the organization becomes verified when ALL its required documents are approved (see syncOrgVerification).
    // A request with no document type is the older single-document request and still verifies it directly.
    if (!r.targetType) ops.push(prisma.organization.update({ where: { id: orgId }, data: decision === 'APPROVED' ? { verificationStatus: 'VERIFIED', verifiedAt: new Date() } : { verificationStatus: 'REJECTED' } }));
  } else if (decision === 'APPROVED' && r.kind === 'IDENTITY') {
    const workerId = r.user.workerProfile?.id;
    if (!workerId) throw conflict('This person no longer has a worker profile');
    ops.push(prisma.workerIdentity.update({ where: { workerId }, data: { verifiedAt: new Date() } }));
  } else if (decision === 'APPROVED' && (r.kind === 'QUALIFICATION' || r.kind === 'SKILL')) {
    const workerId = r.user.workerProfile?.id;
    if (!workerId || !r.targetId) throw conflict('This request has no valid target');
    if (r.kind === 'SKILL') {
      const { count } = await prisma.workerSkill.updateMany({ where: { workerId, skillId: r.targetId }, data: { source: 'VERIFIED' } });
      if (!count) throw conflict('The worker no longer lists this skill');
    } else if (r.targetType === 'EDUCATION') {
      const { count } = await prisma.education.updateMany({ where: { id: r.targetId, workerId }, data: { source: 'VERIFIED' } });
      if (!count) throw conflict('The worker removed this education entry');
    } else if (r.targetType === 'EXPERIENCE') {
      const { count } = await prisma.workExperience.updateMany({ where: { id: r.targetId, workerId }, data: { source: 'VERIFIED', evidenceFileId: r.evidenceFileId } });
      if (!count) throw conflict('The worker removed this job entry');
    } else if (r.targetType === 'CERTIFICATION') {
      const { count } = await prisma.certification.updateMany({ where: { id: r.targetId, workerId }, data: { source: 'VERIFIED', evidenceFileId: r.evidenceFileId } });
      if (!count) throw conflict('The worker removed this certificate');
    } else if (r.targetType === 'CRITERION') {
      const { count } = await prisma.workerCriterion.updateMany({ where: { id: r.targetId, workerId }, data: { source: 'VERIFIED', verifiedAt: new Date() } });
      if (!count) throw conflict('The worker removed or changed this answer');
    }
  }
  await prisma.$transaction(ops);
  if (r.kind === 'EMPLOYER' && r.targetType && r.user.employerProfile?.organizationId) await syncOrgVerification(r.user.employerProfile.organizationId);
  await notify(r.userId, 'verification.reviewed', { kind: r.kind, decision, note, ...(r.targetType ? { documentType: r.targetType } : {}) });
  return { id: requestId, decision };
}

// ───────── Moderation ─────────

export async function listReports(status?: string) {
  const rows = await prisma.report.findMany({
    where: status ? { status: status as 'OPEN' } : { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: { reporter: { select: { fullName: true } }, resolvedBy: { select: { fullName: true } } },
  });
  const items = [];
  for (const r of rows) {
    let target: { label: string; status?: string; ownerId?: string } | null = null;
    if (r.targetType === 'JOB') {
      const j = await prisma.job.findUnique({ where: { id: r.targetId }, select: { title: true, status: true, postedById: true, organization: { select: { name: true, verificationStatus: true } } } });
      target = j ? { label: `${j.title} (${j.organization.name}${j.organization.verificationStatus === 'VERIFIED' ? ', verified' : ', unverified'})`, status: j.status, ownerId: j.postedById } : { label: '(job no longer exists)' };
    } else if (r.targetType === 'SERVICE') {
      const s = await prisma.serviceListing.findUnique({ where: { id: r.targetId }, select: { title: true, status: true, worker: { select: { userId: true, user: { select: { fullName: true } } } } } });
      target = s ? { label: `${s.title} (service by ${s.worker.user.fullName})`, status: s.status, ownerId: s.worker.userId } : { label: '(service no longer exists)' };
    } else {
      const u = await prisma.user.findUnique({ where: { id: r.targetId }, select: { fullName: true, role: true, status: true } });
      target = u ? { label: `${u.fullName} (${u.role.toLowerCase()})`, status: u.status } : { label: '(user no longer exists)' };
    }
    const sameTarget = await prisma.report.count({ where: { targetType: r.targetType, targetId: r.targetId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
    items.push({
      id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason, details: r.details, status: r.status, createdAt: r.createdAt,
      reporter: r.reporter.fullName, target, openReportsOnTarget: sameTarget, resolutionNote: r.resolutionNote, resolvedBy: r.resolvedBy?.fullName ?? null,
    });
  }
  return items;
}

export type ReportAction = 'DISMISS' | 'NO_ACTION' | 'REMOVE_JOB' | 'REMOVE_SERVICE' | 'SUSPEND_USER';

export async function resolveReport(adminId: string, reportId: string, action: ReportAction, note: string | null) {
  const r = await prisma.report.findUnique({ where: { id: reportId } });
  if (!r) throw notFound('Report not found');
  if (r.status === 'RESOLVED' || r.status === 'DISMISSED') throw conflict('This report was already handled');
  if (action === 'REMOVE_JOB' && r.targetType !== 'JOB') throw badRequest('Only job reports can remove a job');
  if (action === 'REMOVE_SERVICE' && r.targetType !== 'SERVICE') throw badRequest('Only service reports can remove a service listing');
  if (action === 'SUSPEND_USER' && r.targetType !== 'USER') throw badRequest('Only user reports can suspend a user');
  if (action !== 'DISMISS' && action !== 'NO_ACTION' && !note) throw badRequest('Add a note explaining the action', { note: ['Required'] });

  if (action === 'REMOVE_JOB') await removeJob(adminId, r.targetId, note);
  if (action === 'REMOVE_SERVICE') await removeServiceListing(r.targetId, note);
  if (action === 'SUSPEND_USER') await setUserStatus(adminId, r.targetId, 'SUSPENDED');

  const closed = action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED';
  // Every other open report about the same target is handled by the same decision.
  await prisma.report.updateMany({
    where: { targetType: r.targetType, targetId: r.targetId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    data: { status: closed, resolvedById: adminId, resolvedAt: new Date(), resolutionNote: note },
  });
  return { id: reportId, status: closed };
}

/** An administrator takes a service listing down after a report. The provider is told, and waiting customers are released. */
async function removeServiceListing(serviceId: string, note: string | null) {
  const s = await prisma.serviceListing.findUnique({ where: { id: serviceId }, select: { id: true, title: true, status: true, worker: { select: { userId: true } } } });
  if (!s) throw notFound('Service not found');
  if (s.status === 'REMOVED') return;
  await prisma.$transaction([
    prisma.serviceListing.update({ where: { id: serviceId }, data: { status: 'REMOVED' } }),
    prisma.serviceInquiry.updateMany({ where: { serviceId, status: 'SENT' }, data: { status: 'CANCELLED', respondedAt: new Date() } }),
  ]);
  await notify(s.worker.userId, 'service.removed', { serviceId, serviceTitle: s.title, note });
}

export async function removeJob(adminId: string, jobId: string, note: string | null) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, title: true, postedById: true, status: true } });
  if (!job) throw notFound('Job not found');
  if (job.status === 'REMOVED') return;
  await prisma.job.update({ where: { id: jobId }, data: { status: 'REMOVED' } });
  await notify(job.postedById, 'job.reviewed', { jobId, jobTitle: job.title, decision: 'REMOVED', note });
  void adminId;
}

export async function listPendingJobs() {
  const rows = await prisma.job.findMany({
    where: { status: 'PENDING_REVIEW' },
    orderBy: { updatedAt: 'asc' },
    take: 100,
    select: {
      id: true, title: true, description: true, benefits: true, schedule: true, createdAt: true, descriptionHash: true,
      organization: { select: { name: true, verificationStatus: true } },
      category: { select: { nameEn: true } },
    },
  });
  const out = [];
  for (const j of rows) {
    const copies = await prisma.job.count({ where: { descriptionHash: j.descriptionHash, id: { not: j.id }, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } } });
    const scam = scanJobText(j);
    out.push({
      id: j.id, title: j.title, snippet: j.description.slice(0, 300), category: j.category.nameEn, organization: j.organization.name,
      organizationVerified: j.organization.verificationStatus === 'VERIFIED',
      reason: scam.flagged
        ? 'Possible scam wording'
        : copies > 0 ? 'Same text as another live job' : j.organization.verificationStatus !== 'VERIFIED' ? 'Unverified organization' : 'Edited after approval',
      scamScore: scam.score,
      scamSignals: scam.signals.map((s) => ({ code: s.code, label: s.label, evidence: s.evidence })),
      createdAt: j.createdAt,
    });
  }
  return out;
}

export async function reviewJob(adminId: string, jobId: string, decision: 'APPROVE' | 'REJECT', note: string | null) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, title: true, status: true, postedById: true, publishedAt: true } });
  if (!job) throw notFound('Job not found');
  if (job.status !== 'PENDING_REVIEW') throw conflict('This job is not waiting for review');
  if (decision === 'REJECT') {
    if (!note) throw badRequest('Tell the employer why the job was rejected', { note: ['Required when rejecting'] });
    await prisma.job.update({ where: { id: jobId }, data: { status: 'REMOVED' } });
  } else {
    await prisma.job.update({ where: { id: jobId }, data: { status: 'ACTIVE', publishedAt: job.publishedAt ?? new Date() } });
    await notifyNewJobMatches(jobId).catch(() => undefined);
    await notifySavedSearchMatches(jobId).catch(() => undefined);
  }
  await notify(job.postedById, 'job.reviewed', { jobId, jobTitle: job.title, decision: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', note });
  void adminId;
  return { id: jobId, decision };
}

// ───────── Categories and skills ─────────

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';

async function uniqueSlug(model: 'category' | 'skill', base: string) {
  let slug = slugify(base);
  for (let i = 2; i < 50; i++) {
    const exists = model === 'category' ? await prisma.category.findUnique({ where: { slug } }) : await prisma.skill.findUnique({ where: { slug } });
    if (!exists) return slug;
    slug = `${slugify(base)}-${i}`;
  }
  throw conflict('Could not create a unique identifier for this name');
}

const refresh = () => {
  clearSkillIndexCache();
  clearMatchingCaches();
};

export async function listCategories() {
  const rows = await prisma.category.findMany({ orderBy: { nameEn: 'asc' }, include: { _count: { select: { skills: true, jobs: true } } } });
  return rows.map((c) => ({ id: c.id, slug: c.slug, nameEn: c.nameEn, nameAm: c.nameAm, nameOm: c.nameOm, isActive: c.isActive, skills: c._count.skills, jobs: c._count.jobs }));
}

export async function createCategory(input: { nameEn: string; nameAm?: string | null; nameOm?: string | null }) {
  const dup = await prisma.category.findFirst({ where: { nameEn: { equals: input.nameEn, mode: 'insensitive' } } });
  if (dup) throw conflict('A category with this name already exists');
  const c = await prisma.category.create({ data: { ...input, slug: await uniqueSlug('category', input.nameEn) } });
  refresh();
  return c;
}

export async function updateCategory(id: string, input: { nameEn?: string; nameAm?: string | null; nameOm?: string | null; isActive?: boolean }) {
  if (!(await prisma.category.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Category not found');
  const c = await prisma.category.update({ where: { id }, data: input });
  refresh();
  return c;
}

export async function listSkills(q: { q?: string; categoryId?: string; includeInactive: boolean; page: number; pageSize: number }) {
  const where: Prisma.SkillWhereInput = {
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.q ? { OR: [{ nameEn: { contains: q.q, mode: 'insensitive' } }, { aliases: { has: q.q.toLowerCase() } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.skill.count({ where }),
    prisma.skill.findMany({ where, orderBy: { nameEn: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { category: { select: { nameEn: true } }, _count: { select: { workerSkills: true, jobSkills: true } } } }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((s) => ({ id: s.id, slug: s.slug, nameEn: s.nameEn, nameAm: s.nameAm, nameOm: s.nameOm, aliases: s.aliases, isActive: s.isActive, categoryId: s.categoryId, category: s.category.nameEn, workers: s._count.workerSkills, jobs: s._count.jobSkills })),
  };
}

export async function createSkill(input: { nameEn: string; categoryId: string; nameAm?: string | null; nameOm?: string | null; aliases: string[] }) {
  if (!(await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw badRequest('Unknown category', { categoryId: ['Choose a valid category'] });
  const dup = await prisma.skill.findFirst({ where: { nameEn: { equals: input.nameEn, mode: 'insensitive' } } });
  if (dup) throw conflict('A skill with this name already exists');
  const s = await prisma.skill.create({ data: { ...input, slug: await uniqueSlug('skill', input.nameEn) } });
  refresh();
  return s;
}

export async function updateSkill(id: string, input: { nameEn?: string; nameAm?: string | null; nameOm?: string | null; aliases?: string[]; categoryId?: string; isActive?: boolean }) {
  if (!(await prisma.skill.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Skill not found');
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw badRequest('Unknown category');
  const s = await prisma.skill.update({ where: { id }, data: input });
  refresh();
  return s;
}

// ───────── Translations ─────────

export async function listTranslations(locale?: string) {
  return prisma.translation.findMany({ where: locale ? { locale: locale as 'en' } : {}, orderBy: [{ locale: 'asc' }, { key: 'asc' }], take: 500 });
}
export async function putTranslation(adminId: string, key: string, locale: 'en' | 'am' | 'om', value: string) {
  return prisma.translation.upsert({ where: { key_locale: { key, locale } }, update: { value, updatedBy: adminId }, create: { key, locale, value, updatedBy: adminId } });
}
export async function deleteTranslation(key: string, locale: 'en' | 'am' | 'om') {
  const { count } = await prisma.translation.deleteMany({ where: { key, locale } });
  if (!count) throw notFound('Translation not found');
}

// ───────── Audit log ─────────

export async function listAudit(q: { action?: string; actorId?: string; entityType?: string; from?: Date; to?: Date; page: number; pageSize: number }) {
  const where: Prisma.AuditLogWhereInput = {
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { actor: { select: { fullName: true, role: true } } } }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((a) => ({ id: a.id, at: a.createdAt, action: a.action, entityType: a.entityType, entityId: a.entityId, meta: a.meta, ip: a.ip, actor: a.actor ? { id: a.actorId, name: a.actor.fullName, role: a.actor.role } : null })),
  };
}

// ───────── Administrator team ─────────

export async function listAdmins() {
  const rows = await prisma.user.findMany({
    where: { role: 'ADMIN', status: { not: 'DELETED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fullName: true, phone: true, status: true, adminLevel: true, createdAt: true, lastLoginAt: true },
  });
  return rows;
}

/** The acting administrator must re-enter their own password: a stolen session alone cannot mint new administrators. */
export async function confirmAdminPassword(adminId: string, password: string) {
  const me = await prisma.user.findUnique({ where: { id: adminId }, select: { passwordHash: true } });
  if (!me || !(await bcrypt.compare(password, me.passwordHash))) throw forbidden('Your password is not correct');
}

export async function createAdmin(actorId: string, input: { fullName: string; phone: string; password: string; actorPassword: string; level?: 'FULL' | 'MODERATOR' | 'AUDITOR' }) {
  await confirmAdminPassword(actorId, input.actorPassword);
  const existing = await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
  if (existing) throw conflict('An account with this phone number already exists. Administrators are created from a new number.');
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { fullName: input.fullName, phone: input.phone, passwordHash, role: 'ADMIN', adminLevel: input.level ?? 'FULL', phoneVerifiedAt: new Date(), mustChangePassword: true },
    select: { id: true, fullName: true, phone: true, status: true, adminLevel: true, createdAt: true, lastLoginAt: true },
  });
  return user;
}

/** Change another administrator's level. Not your own, so a full administrator always remains. */
export async function setAdminLevel(actorId: string, adminId: string, level: 'FULL' | 'MODERATOR' | 'AUDITOR', actorPassword: string) {
  if (actorId === adminId) throw forbidden('You cannot change your own administrator level');
  await confirmAdminPassword(actorId, actorPassword);
  const target = await prisma.user.findUnique({ where: { id: adminId }, select: { id: true, role: true, status: true } });
  if (!target || target.role !== 'ADMIN' || target.status === 'DELETED') throw notFound('Administrator not found');
  await prisma.user.update({ where: { id: adminId }, data: { adminLevel: level } });
  return { id: adminId, level };
}

/**
 * Suspend or reactivate another administrator. You cannot change yourself, so at least one active administrator
 * (you) always remains. Suspending revokes every session and closes live connections.
 */
export async function setAdminStatus(actorId: string, adminId: string, status: 'ACTIVE' | 'SUSPENDED', actorPassword: string) {
  if (actorId === adminId) throw forbidden('You cannot change your own administrator account');
  await confirmAdminPassword(actorId, actorPassword);
  const target = await prisma.user.findUnique({ where: { id: adminId }, select: { id: true, role: true, status: true } });
  if (!target || target.role !== 'ADMIN' || target.status === 'DELETED') throw notFound('Administrator not found');
  if (target.status === status) return { id: adminId, status, changed: false };
  await prisma.user.update({ where: { id: adminId }, data: { status } });
  if (status === 'SUSPENDED') {
    await prisma.refreshToken.updateMany({ where: { userId: adminId, revokedAt: null }, data: { revokedAt: new Date() } });
    disconnectUser(adminId);
  }
  return { id: adminId, status, changed: true };
}
