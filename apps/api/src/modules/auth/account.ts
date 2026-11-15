import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { deleteFileAsset } from '../files/storage';
import { disconnectUser } from '../../realtime';
import { listMyProfileViews } from '../workers/views';

/**
 * Everything the platform holds about one person, as JSON they can keep.
 * Secrets (password hash, authenticator secret, code hashes, session tokens) and the internal
 * matching vector are left out on purpose: they are not "their data" and are useless or risky to hand over.
 */
export async function exportMyData(userId: string, req: Request) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, phone: true, email: true, fullName: true, role: true, status: true, locale: true,
      phoneVerifiedAt: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true,
      notifyJobMatches: true, notifySms: true, autoApply: true, autoApplyMinScore: true,
    },
  });
  if (!user) throw notFound();

  const [worker, employer, notifications, messages, files, reports, reviewsWritten, reviewsReceived] = await Promise.all([
    prisma.workerProfile.findUnique({
      where: { userId },
      include: {
        location: { select: { nameEn: true, level: true } },
        skills: true,
        education: true,
        certifications: true,
        experiences: true,
        savedJobs: true,
        applications: {
          include: { job: { select: { id: true, title: true } }, history: true, interviews: true },
        },
      },
    }),
    prisma.employerProfile.findUnique({
      where: { userId },
      include: { organization: true },
    }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    prisma.message.findMany({ where: { senderId: userId }, orderBy: { createdAt: 'desc' }, take: 5000 }),
    prisma.fileAsset.findMany({ where: { ownerId: userId }, select: { id: true, kind: true, mime: true, sizeBytes: true, createdAt: true } }),
    prisma.report.findMany({ where: { reporterId: userId } }),
    prisma.review.findMany({ where: { authorId: userId } }),
    prisma.review.findMany({ where: { subjectId: userId } }),
  ]);

  const profileViews = worker ? await listMyProfileViews(worker.id) : null;
  const jobs = employer ? await prisma.job.findMany({ where: { postedById: userId } }) : [];
  if (worker) delete (worker as { embedding?: unknown }).embedding;

  await audit(req, userId, 'account.data_exported', 'User', userId);
  return {
    exportedAt: new Date().toISOString(),
    note: 'This is the data EthioTalent AI holds about you. Passwords, login codes and internal matching vectors are not included.',
    account: user,
    workerProfile: worker,
    organization: employer?.organization ?? null,
    jobsPosted: jobs,
    profileViews,
    notifications,
    messagesSent: messages,
    files,
    reportsFiled: reports,
    reviewsWritten,
    reviewsReceived,
  };
}

/**
 * Deletes the account by anonymising it. The row stays so that records other people rely on
 * (a job an employer posted, a message in someone else's conversation, the audit trail) do not break,
 * but nothing that identifies the person is kept: name, phone, e-mail, profile, applications, files,
 * sign-in secrets and notifications are removed. The phone number becomes free for a new registration.
 */
export async function deleteMyAccount(userId: string, password: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  if (user.role === 'ADMIN') throw forbidden('Administrator accounts are removed by another administrator, not here');
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await audit(req, userId, 'account.delete_failed', 'User', userId);
    throw badRequest('Password is incorrect', { password: ['Password is incorrect'] });
  }

  const files = await prisma.fileAsset.findMany({ where: { ownerId: userId }, select: { id: true } });
  const unusable = await bcrypt.hash(randomBytes(32).toString('hex'), env.BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    // Vacancies this person posted stop accepting applications; the organisation and its history stay.
    await tx.job.updateMany({ where: { postedById: userId, status: { in: ['ACTIVE', 'PENDING_REVIEW', 'DRAFT'] } }, data: { status: 'CLOSED' } });
    await tx.workerProfile.deleteMany({ where: { userId } }); // cascades skills, applications, saved jobs, history...
    await tx.employerProfile.deleteMany({ where: { userId } });
    await tx.message.deleteMany({ where: { senderId: userId } }); // erasure: the other side loses those lines
    await tx.review.deleteMany({ where: { authorId: userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.otpCode.deleteMany({ where: { userId } });
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        fullName: 'Deleted user',
        phone: `deleted-${userId}`,
        email: null,
        passwordHash: unusable,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        notifyJobMatches: false,
        notifySms: false,
        autoApply: false,
        totpSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
      },
    });
  });
  for (const f of files) await deleteFileAsset(f.id); // also removes the stored file from disk
  disconnectUser(userId);
  await audit(req, userId, 'account.deleted', 'User', userId);
  return { deleted: true };
}
