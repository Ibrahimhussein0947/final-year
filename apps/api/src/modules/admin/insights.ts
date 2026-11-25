import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { badRequest } from '../../lib/errors';
import { validateBody } from '../../middleware/common';
import { setUserStatus } from './service';

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Counts per day for the last `days` days, with zero-filled gaps, so a chart has one point per day. */
export async function trends(days: number) {
  const since = new Date(Date.now() - (days - 1) * DAY);
  since.setUTCHours(0, 0, 0, 0);
  const [users, jobs, applications, hires] = await Promise.all([
    prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.job.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.application.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.application.findMany({ where: { status: 'ACCEPTED', updatedAt: { gte: since } }, select: { updatedAt: true } }),
  ]);
  const series: Record<string, { date: string; signups: number; jobs: number; applications: number; hires: number }> = {};
  for (let i = 0; i < days; i += 1) {
    const date = dayKey(new Date(since.getTime() + i * DAY));
    series[date] = { date, signups: 0, jobs: 0, applications: 0, hires: 0 };
  }
  for (const r of users) series[dayKey(r.createdAt)] && (series[dayKey(r.createdAt)].signups += 1);
  for (const r of jobs) series[dayKey(r.createdAt)] && (series[dayKey(r.createdAt)].jobs += 1);
  for (const r of applications) series[dayKey(r.createdAt)] && (series[dayKey(r.createdAt)].applications += 1);
  for (const r of hires) series[dayKey(r.updatedAt)] && (series[dayKey(r.updatedAt)].hires += 1);
  return { days, points: Object.values(series) };
}

/** Things an administrator should look at, each with the page that handles it. */
export async function attention() {
  const weekAgo = new Date(Date.now() - 7 * DAY);
  const [verifications, reports, pendingJobs, orgs, noApplicants, pastDeadline, support, failedDeliveries] = await Promise.all([
    prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
    prisma.report.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
    prisma.job.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.organization.count({ where: { verificationStatus: 'PENDING' } }),
    prisma.job.count({ where: { status: 'ACTIVE', createdAt: { lt: weekAgo }, applications: { none: {} } } }),
    prisma.job.count({ where: { status: 'ACTIVE', deadline: { lt: new Date() } } }),
    prisma.supportMessage.count({ where: { status: 'OPEN' } }),
    prisma.deliveryLog.count({ where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - DAY) } } }),
  ]);
  const items = [
    { key: 'support', label: 'Support messages waiting for a reply', count: support, to: '/admin/support' },
    { key: 'failedDeliveries', label: 'SMS or emails that failed in the last 24 hours', count: failedDeliveries, to: '/admin/deliveries' },
    { key: 'verifications', label: 'Verification requests waiting', count: verifications, to: '/admin/verification' },
    { key: 'reports', label: 'Open reports', count: reports, to: '/admin/moderation' },
    { key: 'pendingJobs', label: 'Jobs waiting for review', count: pendingJobs, to: '/admin/moderation' },
    { key: 'orgs', label: 'Organizations waiting for verification', count: orgs, to: '/admin/organizations' },
    { key: 'noApplicants', label: 'Active jobs with no applicants after 7 days', count: noApplicants, to: '/admin/jobs' },
    { key: 'pastDeadline', label: 'Active jobs past their deadline', count: pastDeadline, to: '/admin/jobs' },
  ];
  return { items, total: items.reduce((n, i) => n + i.count, 0) };
}

/** The newest sign-ups, jobs and reports, with no personal contact details. */
export async function recent() {
  const [users, jobs, reports] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, fullName: true, role: true, createdAt: true } }),
    prisma.job.findMany({ where: { status: { not: 'DRAFT' } }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, title: true, status: true, createdAt: true, organization: { select: { name: true } } } }),
    prisma.report.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, targetType: true, reason: true, status: true, createdAt: true } }),
  ]);
  return {
    users: users.map((u) => ({ id: u.id, name: u.fullName, role: u.role, at: u.createdAt })),
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, status: j.status, organization: j.organization.name, at: j.createdAt })),
    reports: reports.map((r) => ({ id: r.id, target: r.targetType, reason: r.reason.slice(0, 80), status: r.status, at: r.createdAt })),
  };
}

/** One search box across people, jobs and organizations. */
export async function globalSearch(q: string) {
  const digits = q.replace(/[\s()-]/g, '');
  const [users, jobs, orgs] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] },
      take: 6, orderBy: { createdAt: 'desc' }, select: { id: true, fullName: true, role: true, status: true },
    }),
    prisma.job.findMany({ where: { title: { contains: q, mode: 'insensitive' }, status: { not: 'REMOVED' } }, take: 6, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, status: true, organization: { select: { name: true } } } }),
    prisma.organization.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, take: 6, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, type: true, verificationStatus: true } }),
  ]);
  return {
    users: users.map((u) => ({ id: u.id, label: u.fullName, detail: `${u.role.toLowerCase()} · ${u.status.toLowerCase()}`, to: `/admin/users/${u.id}` })),
    jobs: jobs.map((j) => ({ id: j.id, label: j.title, detail: `${j.organization.name} · ${j.status.toLowerCase()}`, to: '/admin/jobs' })),
    organizations: orgs.map((o) => ({ id: o.id, label: o.name, detail: `${o.type.toLowerCase().replace(/_/g, ' ')} · ${o.verificationStatus.toLowerCase()}`, to: '/admin/organizations' })),
  };
}

/** Rows for the CSV exports of the lists. Contact details are included only for users, as the list screen already shows them. */
export async function exportRows(kind: 'users' | 'jobs' | 'organizations'): Promise<unknown[][]> {
  if (kind === 'users') {
    const rows = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 10_000, select: { fullName: true, phone: true, email: true, role: true, status: true, createdAt: true, lastLoginAt: true } });
    return [['name', 'phone', 'email', 'role', 'status', 'joined', 'last_login'], ...rows.map((r) => [r.fullName, r.phone, r.email ?? '', r.role, r.status, r.createdAt.toISOString(), r.lastLoginAt?.toISOString() ?? ''])];
  }
  if (kind === 'jobs') {
    const rows = await prisma.job.findMany({ where: { status: { not: 'DRAFT' } }, orderBy: { createdAt: 'desc' }, take: 10_000, select: { title: true, status: true, deadline: true, createdAt: true, organization: { select: { name: true } }, _count: { select: { applications: true } } } });
    return [['title', 'organization', 'status', 'deadline', 'created', 'applications'], ...rows.map((r) => [r.title, r.organization.name, r.status, r.deadline?.toISOString() ?? '', r.createdAt.toISOString(), r._count.applications])];
  }
  const rows = await prisma.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 10_000, select: { name: true, type: true, verificationStatus: true, createdAt: true, _count: { select: { jobs: true } } } });
  return [['name', 'type', 'verification', 'created', 'jobs'], ...rows.map((r) => [r.name, r.type, r.verificationStatus, r.createdAt.toISOString(), r._count.jobs])];
}

export const bulkStatusSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().min(3).max(300).optional(),
}).strict();

/** Suspend or reactivate several accounts. Each one is checked on its own; failures are reported, not hidden. */
export async function bulkSetStatus(adminId: string, input: z.infer<typeof bulkStatusSchema>) {
  if (input.status === 'SUSPENDED' && !input.reason) throw badRequest('Give a reason for the suspension', { reason: ['Required'] });
  const changed: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of input.ids) {
    try {
      const r = await setUserStatus(adminId, id, input.status);
      if (r.changed) changed.push(id);
      else skipped.push({ id, reason: 'Already in that state' });
    } catch (e) {
      skipped.push({ id, reason: e instanceof Error ? e.message : 'Failed' });
    }
  }
  return { changed, skipped };
}

export function adminInsightsRouter() {
  const router = Router();
  router.get('/insights/trends', async (req, res) => {
    const days = z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30).parse(req.query.days);
    res.json(await trends(days));
  });
  router.get('/insights/attention', async (_req, res) => res.json(await attention()));
  router.get('/insights/recent', async (_req, res) => res.json(await recent()));
  router.get('/search', async (req, res) => {
    const q = z.string().trim().min(2).max(80).safeParse(req.query.q);
    if (!q.success) return res.json({ users: [], jobs: [], organizations: [] });
    res.json(await globalSearch(q.data));
  });
  router.post('/users/bulk-status', validateBody(bulkStatusSchema), async (req, res) => {
    const result = await bulkSetStatus(req.user!.id, req.body);
    if (result.changed.length) await audit(req, req.user!.id, `admin.users_bulk_${req.body.status === 'SUSPENDED' ? 'suspended' : 'reactivated'}`, 'User', undefined, { count: result.changed.length, reason: req.body.reason ?? null });
    res.json(result);
  });
  return router;
}
