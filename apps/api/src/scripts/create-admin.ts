// Usage: npm run admin:create -w @ethiotalent/api -- <phone> <password> "<full name>"
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { PHONE_REGEX, normalizePhone } from '../lib/security';

async function main() {
  const [phoneArg, password, fullName = 'Administrator'] = process.argv.slice(2);
  if (!phoneArg || !password || !PHONE_REGEX.test(phoneArg) || password.length < 10) {
    console.error('Usage: admin:create <ethiopian-phone> <password (10+ chars)> ["Full Name"]');
    process.exit(1);
  }
  const phone = normalizePhone(phoneArg);
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { phone },
    // Running this again is also the recovery path for a lost authenticator: it switches two-factor off.
    update: { role: 'ADMIN', passwordHash, status: 'ACTIVE', totpSecret: null, totpEnabledAt: null, totpLastStep: null, mustChangePassword: false },
    create: { phone, passwordHash, fullName, role: 'ADMIN', phoneVerifiedAt: new Date() },
  });
  console.log(`Admin ready: ${user.phone}`);
}

main().finally(() => prisma.$disconnect());
