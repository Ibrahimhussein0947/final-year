import { prisma } from '../../lib/prisma';

const REPEAT_AFTER_MS = 30 * 60 * 1000; // reloading the same profile within 30 minutes is not a new view
const WINDOW_DAYS = 90;

/**
 * Remember that an organisation looked at a worker's profile. One row per worker and organisation, so the worker
 * sees "ABC Company looked at your profile 3 times, last on ..." and never which person at the company did it.
 * Only employers count; administrators reviewing profiles are not shown to workers.
 */
export async function recordProfileView(workerId: string, employerUserId: string): Promise<void> {
  const ep = await prisma.employerProfile.findUnique({ where: { userId: employerUserId }, select: { organizationId: true } });
  if (!ep) return;
  const key = { workerId_organizationId: { workerId, organizationId: ep.organizationId } };
  const existing = await prisma.profileView.findUnique({ where: key });
  const now = new Date();
  if (!existing) {
    await prisma.profileView.create({ data: { workerId, organizationId: ep.organizationId, firstViewedAt: now, lastViewedAt: now, viewCount: 1 } });
  } else if (now.getTime() - existing.lastViewedAt.getTime() >= REPEAT_AFTER_MS) {
    await prisma.profileView.update({ where: key, data: { lastViewedAt: now, viewCount: { increment: 1 } } });
  }
}

export async function listMyProfileViews(workerId: string) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const rows = await prisma.profileView.findMany({
    where: { workerId, lastViewedAt: { gte: since } },
    orderBy: { lastViewedAt: 'desc' },
    take: 100,
    include: { organization: { select: { id: true, name: true, type: true, verificationStatus: true } } },
  });
  return {
    windowDays: WINDOW_DAYS,
    organizations: rows.length,
    totalViews: rows.reduce((n, r) => n + r.viewCount, 0),
    items: rows.map((r) => ({
      organization: { name: r.organization.name, type: r.organization.type, verified: r.organization.verificationStatus === 'VERIFIED' },
      firstViewedAt: r.firstViewedAt,
      lastViewedAt: r.lastViewedAt,
      viewCount: r.viewCount,
    })),
  };
}
