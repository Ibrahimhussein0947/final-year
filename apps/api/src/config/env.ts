import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// dotenv never overrides variables that are already set, so load the more specific file first.
const root = path.resolve(__dirname, '../..');
if (process.env.NODE_ENV === 'test') loadDotenv({ path: path.join(root, '.env.test') });
loadDotenv({ path: path.join(root, '.env') });

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  // Uploaded files live here, outside any statically served folder; they are only served through authorized routes.
  UPLOAD_DIR: z.string().default(path.join(root, 'uploads')),
  // Optional SMS gateway (a generic JSON HTTP API). Unset = SMS is never sent; everything else works.
  SMS_GATEWAY_URL: z.string().url().optional(),
  SMS_GATEWAY_TOKEN: z.string().min(8).optional(),
  SMS_SENDER_ID: z.string().max(11).optional(),
  // Optional Python AI service. Unset = semantic matching is off and everything uses the rule-based score.
  AI_SERVICE_URL: z.string().url().optional(),
  AI_SERVICE_TOKEN: z.string().min(24).optional(),
  // Optional video meeting service for video interviews (for example a self-hosted Jitsi Meet). The platform only builds
  // an unguessable room link on this address; it never sends audio or video itself. Unset = employers paste their own link.
  VIDEO_BASE_URL: z.string().url().refine((u) => u.startsWith('https://'), 'VIDEO_BASE_URL must start with https://').optional(),
  // When true, jobs from unverified organizations wait for admin approval instead of going live immediately.
  REVIEW_UNVERIFIED_JOBS: bool.default('false'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool.optional(),
  // Dev only: return OTP codes in the API response because no SMS/email provider is configured.
  EXPOSE_DEV_OTP: bool.default('false'),
});

// An empty value (e.g. `AI_SERVICE_URL=` in a compose file) means "not set", not an invalid URL.
const cleaned = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
const parsed = schema.safeParse(cleaned);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  reviewUnverifiedJobs: parsed.data.REVIEW_UNVERIFIED_JOBS,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()),
  videoBaseUrl: parsed.data.VIDEO_BASE_URL ? parsed.data.VIDEO_BASE_URL.replace(/\/+$/, '') : null,
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  cookieSecure: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production',
  // Never expose codes in production, whatever the flag says.
  exposeDevOtp: parsed.data.EXPOSE_DEV_OTP && parsed.data.NODE_ENV !== 'production',
};
