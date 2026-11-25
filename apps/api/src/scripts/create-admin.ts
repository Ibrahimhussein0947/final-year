// Usage:
//   npm run admin:create -w @ethiotalent/api -- <phone> <password> "<full name>" [FULL|MODERATOR|AUDITOR] [email]
//   npm run admin:create -w @ethiotalent/api            (reads ADMIN_PHONE, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_EMAIL, ADMIN_LEVEL from the environment / apps/api/.env)
// The administrator can sign in with the phone number or the email. Running it again resets the password and switches two-factor off.
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { PHONE_REGEX, normalizePhone } from '../lib/security';

async function main() {
  const [a1, a2, a3, a4, a5] = process.argv.slice(2);
  const phoneArg = a1 ?? process.env.ADMIN_PHONE;
  const password = a2 ?? process.env.ADMIN_PASSWORD;
  const fullName = a3 ?? process.env.ADMIN_NAME ?? 'Administrator';
  const level = (a4 ?? process.env.ADMIN_LEVEL ?? 'FULL').toUpperCase();
  const emailRaw = (a5 ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!['FULL', 'MODERATOR', 'AUDITOR'].includes(level)) { console.error('Level must be FULL, MODERATOR or AUDITOR'); process.exit(1); }
  if (!phoneArg || !password || !PHONE_REGEX.test(phoneArg) || password.length < 10) {
    console.error('Usage: admin:create <ethiopian-phone> <password (10+ chars)> ["Full Name"] [level] [email]\nor set ADMIN_PHONE and ADMIN_PASSWORD in apps/api/.env');
    process.exit(1);
  }
  if (emailRaw && !z.string().email().safeParse(emailRaw).success) { console.error('ADMIN_EMAIL is not a valid email address'); process.exit(1); }
  const email = emailRaw || null;
  const phone = normalizePhone(phoneArg);
  if (email) {
    const clash = await prisma.user.findUnique({ where: { email }, select: { phone: true } });
    if (clash && clash.phone !== phone) { console.error('That email already belongs to another account'); process.exit(1); }
  }
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { phone },
    // Running this again is also the recovery path for a lost authenticator: it switches two-factor off.
    update: { role: 'ADMIN', adminLevel: level as 'FULL', passwordHash, status: 'ACTIVE', totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpBackupCodes: [], mustChangePassword: false, ...(email ? { email, emailVerifiedAt: new Date() } : {}) },
    create: { phone, email, passwordHash, fullName, role: 'ADMIN', adminLevel: level as 'FULL', phoneVerifiedAt: new Date(), emailVerifiedAt: email ? new Date() : null },
  });
  console.log(`Admin ready: ${user.phone}${user.email ? ` / ${user.email}` : ''} (${level})`);
}

main().finally(() => prisma.$disconnect());
