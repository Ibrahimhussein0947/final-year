import { prisma } from '../../lib/prisma';
import { disconnectUser } from '../../realtime';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';

/**
 * One account seen by an administrator: basics, what they do on the platform, reports about them, checks they submitted,
 * and recent activity. No passwords, tokens, files or message text. Actions here are limited to non-administrator accounts.
 */
export async function userDetail(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, fullName: true, phone: true, email: true, role: true, status: true, locale: true, createdAt: true, lastLoginAt: true,
      phoneVerifiedAt: true, emailVerifiedAt: true, mustChangePassword: true, totpEnabledAt: true,
      workerProfile: { select: { id: true, completionPct: true, isVisible: true, profileViews: true, _count: { select: { skills: true, experiences: true, applications: true } } } },
      employerProfile: { select: { organization: { select: { id: true, name: true, type: true, verificationStatus: true, _count: { select: { jobs: true } } } } } },
    },
  });
  if (!u) throw notFound('User not found');

  const [activeSessions, reportsAgainst, reportsFiled, verifications, activity, applicationsByStatus, activeJobs] = await Promise.all([
    prisma.refreshToken.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.report.findMany({ where: { targetType: 'USER', targetId: userId }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, reason: true, status: true, createdAt: true } }),
    prisma.report.count({ where: { reporterId: userId } }),
    prisma.verificationRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, kind: true, status: true, createdAt: true } }),
    prisma.auditLog.findMany({ where: { OR: [{ actorId: userId }, { entityType: 'User', entityId: userId }] }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, action: true, actorId: true, createdAt: true } }),
    u.workerProfile ? prisma.application.groupBy({ by: ['status'], where: { workerId: u.workerProfile.id }, _count: { _all: true } }) : Promise.resolve([]),
    u.employerProfile ? prisma.job.count({ where: { organizationId: u.employerProfile.organization.id, status: 'ACTIVE' } }) : Promise.resolve(0),
  ]);

  return {
    user: {
      id: u.id, fullName: u.fullName, phone: u.phone, email: u.email, role: u.role, status: u.status, locale: u.locale, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      phoneVerified: !!u.phoneVerifiedAt, emailVerified: !!u.emailVerifiedAt, mustChangePassword: u.mustChangePassword, twoFactorEnabled: !!u.totpEnabledAt,
    },
    activeSessions,
    worker: u.workerProfile
      ? {
          completionPct: u.workerProfile.completionPct, visible: u.workerProfile.isVisible, profileViews: u.workerProfile.profileViews,
          skills: u.workerProfile._count.skills, jobsListed: u.workerProfile._count.experiences, applications: u.workerProfile._count.applications,
          applicationsByStatus: Object.fromEntries(applicationsByStatus.map((g) => [g.status, g._count._all])),
        }
      : null,
    employer: u.employerProfile
      ? { organization: { id: u.employerProfile.organization.id, name: u.employerProfile.organization.name, type: u.employerProfile.organization.type, verificationStatus: u.employerProfile.organization.verificationStatus }, jobs: u.employerProfile.organization._count.jobs, activeJobs }
      : null,
    reportsAgainst,
    reportsFiled,
    verifications,
    activity,
  };
}

async function editableUser(adminId: string, userId: string) {
  if (adminId === userId) throw forbidden('You cannot use this on your own account');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true, email: true } });
  if (!user) throw notFound('User not found');
  if (user.role === 'ADMIN') throw forbidden('Administrator accounts cannot be changed here');
  if (user.status === 'DELETED') throw conflict('This account was deleted');
  return user;
}

/** The person must choose a new password at their next sign-in, and every session they have is ended now. */
export async function forcePasswordReset(adminId: string, userId: string) {
  await editableUser(adminId, userId);
  await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
  const revoked = await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  disconnectUser(userId);
  return { id: userId, mustChangePassword: true, sessionsEnded: revoked.count };
}

/** Mark a phone number or e-mail address as verified or not. For example when someone proves it in person, or a code could not be delivered. */
export async function setContactVerified(adminId: string, userId: string, kind: 'PHONE' | 'EMAIL', verified: boolean) {
  const user = await editableUser(adminId, userId);
  if (kind === 'EMAIL' && !user.email) throw badRequest('This account has no e-mail address');
  await prisma.user.update({ where: { id: userId }, data: kind === 'PHONE' ? { phoneVerifiedAt: verified ? new Date() : null } : { emailVerifiedAt: verified ? new Date() : null } });
  return { id: userId, kind, verified };
}
