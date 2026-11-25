import { open as openSecret, seal as sealSecret } from '../../lib/secretBox';
import { createHash, randomBytes as rb } from 'node:crypto';
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import type { Prisma, User, VerificationKind } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { badRequest, conflict, forbidden, notFound, tooMany, twoFactorRequired, unauthorized } from '../../lib/errors';
import { newOpaqueToken, safeEqualHex, sha256 } from '../../lib/security';
import { notifier } from '../../integrations/notify';
import { signAccessToken } from '../../middleware/auth';
import { assertRegistrationOpen } from '../admin/settings';
import { generateSecret, otpauthUrl, verifyCode } from '../../lib/totp';
import type { LoginInput, RegisterInput } from './schema';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// Compared against when the phone is unknown so login time does not reveal which numbers exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

export const publicUser = (u: Pick<User, 'id' | 'fullName' | 'phone' | 'email' | 'role' | 'locale' | 'phoneVerifiedAt' | 'emailVerifiedAt'> & { mustChangePassword?: boolean; totpEnabledAt?: Date | null; adminLevel?: 'FULL' | 'MODERATOR' | 'AUDITOR' }) => ({
  id: u.id,
  ...(u.role === 'ADMIN' ? { adminLevel: u.adminLevel ?? 'FULL' } : {}),
  fullName: u.fullName,
  phone: u.phone,
  email: u.email,
  role: u.role,
  locale: u.locale,
  phoneVerified: !!u.phoneVerifiedAt,
  emailVerified: !!u.emailVerifiedAt,
  mustChangePassword: !!u.mustChangePassword,
  twoFactorEnabled: !!u.totpEnabledAt,
});

/** Walk/create REGION > ZONE > WOREDA > KEBELE and return the deepest location id. */
async function resolveLocation(tx: Prisma.TransactionClient, input: RegisterInput): Promise<string> {
  const region = await tx.location.findFirst({
    where: { level: 'REGION', nameEn: { equals: input.region, mode: 'insensitive' } },
  });
  if (!region) throw badRequest('Unknown region', { region: ['Select a valid region'] });
  let currentId = region.id;
  const levels = [
    ['ZONE', input.zone],
    ['WOREDA', input.woreda],
    ['KEBELE', input.kebele],
  ] as const;
  for (const [level, name] of levels) {
    if (!name) break;
    const existing = await tx.location.findFirst({
      where: { parentId: currentId, nameEn: { equals: name, mode: 'insensitive' } },
    });
    const row =
      existing ?? (await tx.location.create({ data: { level, nameEn: name, parentId: currentId } }));
    currentId = row.id;
  }
  return currentId;
}

async function issueSession(user: Pick<User, 'id' | 'role'>, req: Request) {
  const refreshToken = newOpaqueToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * 86_400_000),
    },
  });
  void req;
  return { accessToken: signAccessToken({ id: user.id, role: user.role }), refreshToken };
}

export async function register(input: RegisterInput, req: Request) {
  await assertRegistrationOpen();
  const clash = await prisma.user.findFirst({
    where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { phone: true },
  });
  if (clash) throw conflict('An account with this phone number or email already exists');

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const user = await prisma.$transaction(async (tx) => {
    const locationId = await resolveLocation(tx, input);
    const created = await tx.user.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        passwordHash,
        role: input.role,
        locale: input.language,
      },
    });
    if (input.role === 'WORKER') {
      // A new profile already has a location, which is worth 10 points of completion.
      await tx.workerProfile.create({ data: { userId: created.id, locationId, completionPct: 10 } });
    } else {
      const org = await tx.organization.create({
        data: { name: input.organizationName!, type: input.organizationType!, locationId },
      });
      await tx.employerProfile.create({ data: { userId: created.id, organizationId: org.id } });
    }
    return created;
  });

  await audit(req, user.id, 'auth.register', 'User', user.id, { role: user.role });
  return { user: publicUser(user), ...(await issueSession(user, req)) };
}

export async function login(input: LoginInput, req: Request) {
  const user = await prisma.user.findUnique({ where: input.phone.includes('@') ? { email: input.phone } : { phone: input.phone } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await audit(req, user?.id ?? null, 'auth.login_failed', 'User', user?.id);
    throw unauthorized('Incorrect phone number, email or password');
  }
  if (user.status !== 'ACTIVE') {
    await audit(req, user.id, 'auth.login_blocked', 'User', user.id, { status: user.status });
    throw unauthorized('This account is not active');
  }
  if (user.totpEnabledAt && user.totpSecret) {
    if (!input.totpCode) throw twoFactorRequired();
    if (/^\d{6}$/.test(input.totpCode.trim())) {
      const step = verifyCode(openSecret(user.totpSecret), input.totpCode);
      if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) {
        await audit(req, user.id, 'auth.2fa_failed', 'User', user.id);
        throw unauthorized('Incorrect or already used code');
      }
      await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
    } else {
      // A one-time backup code (for a lost authenticator). Each works once.
      const hash = hashBackupCode(input.totpCode);
      const used = await prisma.user.updateMany({ where: { id: user.id, totpBackupCodes: { has: hash } }, data: { totpBackupCodes: user.totpBackupCodes.filter((h) => h !== hash) } });
      if (!used.count) {
        await audit(req, user.id, 'auth.2fa_failed', 'User', user.id);
        throw unauthorized('Incorrect or already used code');
      }
      await audit(req, user.id, 'auth.2fa_backup_code_used', 'User', user.id);
    }
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(req, user.id, 'auth.login', 'User', user.id);
  return { user: publicUser(user), ...(await issueSession(user, req)) };
}

/** Rotate the refresh token. Presenting an already-used token revokes every session for that user. */
export async function refresh(rawToken: string | undefined, req: Request) {
  if (!rawToken) throw unauthorized('No session');
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: true },
  });
  if (!row) throw unauthorized('Invalid session');
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, row.userId, 'auth.refresh_reuse_detected', 'User', row.userId);
    throw unauthorized('Session is no longer valid');
  }
  if (row.expiresAt < new Date() || row.user.status !== 'ACTIVE') throw unauthorized('Session expired');
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  return { user: publicUser(row.user), ...(await issueSession(row.user, req)) };
}

export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { employerProfile: { include: { organization: true } }, workerProfile: { select: { id: true, completionPct: true } } },
  });
  if (!user) throw notFound('User not found');
  return {
    ...publicUser(user),
    workerProfile: user.workerProfile,
    organization: user.employerProfile
      ? {
          id: user.employerProfile.organization.id,
          name: user.employerProfile.organization.name,
          type: user.employerProfile.organization.type,
          verificationStatus: user.employerProfile.organization.verificationStatus,
        }
      : null,
  };
}

// ───────────── Phone / email verification codes ─────────────

const hashCode = (userId: string, kind: VerificationKind, code: string) => sha256(`${userId}:${kind}:${code}`);

export async function requestOtp(userId: string, kind: 'PHONE' | 'EMAIL', req: Request) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  if (kind === 'PHONE' && user.phoneVerifiedAt) throw badRequest('Phone is already verified');
  if (kind === 'EMAIL') {
    if (!user.email) throw badRequest('Add an email address first');
    if (user.emailVerifiedAt) throw badRequest('Email is already verified');
  }
  // Basic throttle: one code per 30 seconds per user and kind.
  const last = await prisma.otpCode.findFirst({ where: { userId, kind }, orderBy: { createdAt: 'desc' } });
  if (last && Date.now() - last.createdAt.getTime() < 30_000) throw tooMany('Please wait before requesting another code');

  await prisma.otpCode.updateMany({ where: { userId, kind, consumedAt: null }, data: { consumedAt: new Date() } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.otpCode.create({
    data: { userId, kind, codeHash: hashCode(userId, kind, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  const text = `Your EthioTalent AI verification code is ${code}. It expires in 10 minutes.`;
  if (kind === 'PHONE') await notifier.sendSms(user.phone, text);
  else await notifier.sendEmail(user.email!, 'Verify your email', text);
  await audit(req, userId, 'auth.otp_requested', 'User', userId, { kind });

  return { sent: true, ...(env.exposeDevOtp ? { devCode: code } : {}) };
}

export async function verifyOtp(userId: string, kind: 'PHONE' | 'EMAIL', code: string, req: Request) {
  const row = await prisma.otpCode.findFirst({
    where: { userId, kind, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw badRequest('Code expired or not requested');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw tooMany('Too many wrong codes. Request a new one.');

  if (!safeEqualHex(row.codeHash, hashCode(userId, kind, code))) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw badRequest('Incorrect code');
  }
  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({
      where: { id: userId },
      data: kind === 'PHONE' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() },
    }),
  ]);
  await audit(req, userId, 'auth.verified', 'User', userId, { kind });
  return me(userId);
}

// ───────────── Password reset and change ─────────────

const revokeAllSessions = (userId: string) =>
  prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

/**
 * Always answers the same way, whether or not the phone is registered, so the endpoint cannot be used
 * to discover which numbers have accounts. The code goes to the phone by SMS (or e-mail when the account
 * has a verified one) and is only returned in the response in development.
 */
export async function requestPasswordReset(phone: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { phone } });
  let devCode: string | undefined;
  if (user && user.status === 'ACTIVE') {
    const kind = 'PASSWORD_RESET' as const;
    const last = await prisma.otpCode.findFirst({ where: { userId: user.id, kind }, orderBy: { createdAt: 'desc' } });
    if (!last || Date.now() - last.createdAt.getTime() >= 30_000) {
      await prisma.otpCode.updateMany({ where: { userId: user.id, kind, consumedAt: null }, data: { consumedAt: new Date() } });
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await prisma.otpCode.create({
        data: { userId: user.id, kind, codeHash: hashCode(user.id, kind, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
      });
      const text = `Your EthioTalent AI password reset code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this message.`;
      await notifier.sendSms(user.phone, text);
      if (user.email && user.emailVerifiedAt) await notifier.sendEmail(user.email, 'Reset your password', text);
      await audit(req, user.id, 'auth.password_reset_requested', 'User', user.id);
      if (env.exposeDevOtp) devCode = code;
    }
  }
  return { sent: true, ...(devCode ? { devCode } : {}) };
}

export async function resetPassword(phone: string, code: string, newPassword: string, req: Request) {
  const fail = () => badRequest('Code is wrong or expired. Request a new one.');
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || user.status !== 'ACTIVE') throw fail();
  const kind = 'PASSWORD_RESET' as const;
  const row = await prisma.otpCode.findFirst({
    where: { userId: user.id, kind, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw fail();
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw tooMany('Too many wrong codes. Request a new one.');
  if (!safeEqualHex(row.codeHash, hashCode(user.id, kind, code))) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw fail();
  }
  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } }),
  ]);
  await revokeAllSessions(user.id); // a reset signs the account out everywhere
  await audit(req, user.id, 'auth.password_reset', 'User', user.id);
  return { reset: true };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    await audit(req, userId, 'auth.password_change_failed', 'User', userId);
    throw badRequest('Current password is incorrect', { currentPassword: ['Current password is incorrect'] });
  }
  if (currentPassword === newPassword) throw badRequest('Choose a different password', { newPassword: ['Choose a different password'] });
  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
  await revokeAllSessions(userId);
  await audit(req, userId, 'auth.password_changed', 'User', userId);
  return issueSession(user, req); // keep this device signed in with a fresh session
}

// ───────────── Two-factor login (authenticator app) for administrators ─────────────

export async function startTwoFactorSetup(userId: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  if (user.role !== 'ADMIN') throw forbidden('Two-factor login is for administrator accounts');
  if (user.totpEnabledAt) throw conflict('Two-factor login is already on');
  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: sealSecret(secret), totpLastStep: null } });
  await audit(req, userId, 'auth.2fa_setup_started', 'User', userId);
  return { secret, otpauthUrl: otpauthUrl(secret, user.phone) };
}

export async function enableTwoFactor(userId: string, code: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecret || user.totpEnabledAt) throw badRequest('Start the setup first');
  const step = verifyCode(openSecret(user.totpSecret), code);
  if (step === null) throw badRequest('Incorrect code. Check the time on your phone and try again.');
  const backupCodes = Array.from({ length: 8 }, () => { const h = rb(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; });
  await prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), totpLastStep: step, totpBackupCodes: backupCodes.map(hashBackupCode) } });
  await audit(req, userId, 'auth.2fa_enabled', 'User', userId);
  return { ...(await me(userId)), backupCodes }; // shown once; only their hashes are kept
}

export async function disableTwoFactor(userId: string, password: string, code: string, req: Request) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecret || !user.totpEnabledAt) throw badRequest('Two-factor login is not on');
  if (!(await bcrypt.compare(password, user.passwordHash))) throw badRequest('Password is incorrect', { password: ['Password is incorrect'] });
  const step = verifyCode(openSecret(user.totpSecret), code);
  if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) throw badRequest('Incorrect or already used code');
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpBackupCodes: [] } });
  await audit(req, userId, 'auth.2fa_disabled', 'User', userId);
  return me(userId);
}

const hashBackupCode = (code: string) => createHash('sha256').update(code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
