import type { ApplicationStatus, JobStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../lib/errors';

/** Every job and application on the platform, for administrators: find problems, close or feature a job. Removal stays in Moderation. */

const STATUSES = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'CLOSED', 'FILLED', 'REMOVED'] as const;
const APP_STATUSES = ['PENDING', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const;
export const FLAGS = ['expired', 'noApplicants', 'held'] as const;
const DAY = 86_400_000;
export const STALE_DAYS = 7;

const paging = { page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };

export const jobsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(STATUSES).optional(),
  /** expired: still active after the deadline. noApplicants: active for a week with nobody applying. held: waiting for a moderator. */
  flag: z.enum(FLAGS).optional(),
  ...paging,
});

export const applicationsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(APP_STATUSES).optional(),
  jobId: z.string().uuid().optional(),
  ...paging,
});

export async function listJobs(q: z.infer<typeof jobsQuerySchema>) {
  const now = new Date();
  const where: Prisma.JobWhereInput = {
    ...(q.status ? { status: q.status as JobStatus } : {}),
    ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { organization: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    ...(q.flag === 'expired' ? { status: 'ACTIVE', deadline: { lt: now } } : {}),
    ...(q.flag === 'noApplicants' ? { status: 'ACTIVE', createdAt: { lt: new Date(now.getTime() - STALE_DAYS * DAY) }, applications: { none: {} } } : {}),
    ...(q.flag === 'held' ? { status: 'PENDING_REVIEW' } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, title: true, status: true, deadline: true, createdAt: true, featuredAt: true, vacancies: true, organization: { select: { id: true, name: true, verificationStatus: true } }, _count: { select: { applications: true } } },
    }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((j) => ({
      id: j.id, title: j.title, status: j.status, deadline: j.deadline, createdAt: j.createdAt, featured: !!j.featuredAt, vacancies: j.vacancies,
      organization: j.organization, applications: j._count.applications,
      flags: [
        ...(j.status === 'ACTIVE' && j.deadline && j.deadline < now ? ['expired'] : []),
        ...(j.status === 'ACTIVE' && j._count.applications === 0 && j.createdAt < new Date(now.getTime() - STALE_DAYS * DAY) ? ['noApplicants'] : []),
        ...(j.status === 'PENDING_REVIEW' ? ['held'] : []),
      ],
    })),
  };
}

/** Counts for the problem lists, so the page can show how many jobs need a look. */
export async function jobProblemCounts() {
  const now = new Date();
  const [expired, noApplicants, held] = await Promise.all([
    prisma.job.count({ where: { status: 'ACTIVE', deadline: { lt: now } } }),
    prisma.job.count({ where: { status: 'ACTIVE', createdAt: { lt: new Date(now.getTime() - STALE_DAYS * DAY) }, applications: { none: {} } } }),
    prisma.job.count({ where: { status: 'PENDING_REVIEW' } }),
  ]);
  return { expired, noApplicants, held };
}

/** Close a live or waiting job. The employer's applications stay as they are. */
export async function closeJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, status: true } });
  if (!job) throw notFound('Job not found');
  if (job.status !== 'ACTIVE' && job.status !== 'PENDING_REVIEW') throw conflict(`A job that is ${job.status.toLowerCase().replace('_', ' ')} cannot be closed`);
  await prisma.job.update({ where: { id: jobId }, data: { status: 'CLOSED', featuredAt: null } });
  return { id: jobId, status: 'CLOSED' as const, from: job.status };
}

export async function setFeatured(jobId: string, featured: boolean) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, status: true } });
  if (!job) throw notFound('Job not found');
  if (featured && job.status !== 'ACTIVE') throw conflict('Only a live job can be featured');
  await prisma.job.update({ where: { id: jobId }, data: { featuredAt: featured ? new Date() : null } });
  return { id: jobId, featured };
}

export async function listApplications(q: z.infer<typeof applicationsQuerySchema>) {
  const where: Prisma.ApplicationWhereInput = {
    ...(q.status ? { status: q.status as ApplicationStatus } : {}),
    ...(q.jobId ? { jobId: q.jobId } : {}),
    ...(q.q
      ? { OR: [{ job: { title: { contains: q.q, mode: 'insensitive' } } }, { job: { organization: { name: { contains: q.q, mode: 'insensitive' } } } }, { worker: { user: { fullName: { contains: q.q, mode: 'insensitive' } } } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.application.count({ where }),
    prisma.application.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: { id: true, status: true, createdAt: true, updatedAt: true, job: { select: { id: true, title: true, organization: { select: { name: true } } } }, worker: { select: { id: true, user: { select: { id: true, fullName: true } } } } },
    }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((a) => ({ id: a.id, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt, job: { id: a.job.id, title: a.job.title, organization: a.job.organization.name }, worker: { userId: a.worker.user.id, name: a.worker.user.fullName } })),
  };
}
