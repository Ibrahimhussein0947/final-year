// Runs before every test file. The Prisma client reads the developer's .env as soon as it is imported, which would
// point DATABASE_URL at the development database; loading .env.test first (and letting it win) keeps tests on *_test.
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.join(__dirname, '..', '..', '..', '.env.test'), override: true });
