// Usage: npm run admin:create -w @ethiotalent/api -- <phone> <password> "<full name>"
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { PHONE_REGEX, normalizePhone } from '../lib/security';

async function main() {
  const [phoneArg, password, fullName = 'Administrator', levelArg = 'FULL'] = process.argv.slice(2);
  const level = levelArg.toUpperCase();
  if (!['FULL', 'MODERATOR', 'AUDITOR'].includes(level)) { console.error('Level must be FULL, MODERATOR or AUDITOR'); process.exit(1); }
  if (!phoneArg || !password || !PHONE_REGEX.test(phoneArg) || password.length < 10) {
    console.error('Usage: admin:create <ethiopian-phone> <password (10+ chars)> ["Full Name"]');
    process.exit(1);
  }
  const phone = normalizePhone(phoneArg);
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { phone },
    // Running this again is also the recovery path for a lost authenticator: it switches two-factor off.
    update: { role: 'ADMIN', adminLevel: level as 'FULL', passwordHash, status: 'ACTIVE', totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpBackupCodes: [], mustChangePassword: false },
    create: { phone, passwordHash, fullName, role: 'ADMIN', adminLevel: level as 'FULL', phoneVerifiedAt: new Date() },
  });
  console.log(`Admin ready: ${user.phone} (${level})`);
}

main().finally(() => prisma.$disconnect());
