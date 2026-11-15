import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { certificationSchema, educationSchema, experienceSchema } from '../workers/schema';
import { getOwnProfile } from '../workers/service';
import { analyzeJobText, analyzeMyCv, applyCv } from './service';

const jobSchema = z
  .object({
    title: z.string().trim().max(150).optional(),
    description: z.string().trim().min(20, 'Write a few sentences about the job first').max(10_000),
  })
  .strict();

const applySchema = z
  .object({
    skills: z.array(z.object({ skillId: z.string().uuid(), proficiency: z.number().int().min(1).max(5).default(3) }).strict()).max(40).default([]),
    experiences: z.array(experienceSchema).max(30).default([]),
    education: z.array(educationSchema).max(10).default([]),
    certifications: z.array(certificationSchema).max(20).default([]),
    yearsExperience: z.number().int().min(0).max(60).optional(),
    bio: z.string().trim().max(2000).optional(),
  })
  .strict();

export function analysisRouter() {
  const router = Router();
  // Reading a PDF costs CPU, so keep each person to a modest rate.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: env.isTest ? 10_000 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
    validate: { keyGeneratorIpFallback: false },
    message: { error: { code: 'RATE_LIMITED', message: 'Too many analyses, wait a minute and try again' } },
  });

  router.post('/analysis/job', requireAuth, requireRole('EMPLOYER'), limiter, validateBody(jobSchema), async (req, res) => {
    const analysis = await analyzeJobText(req.body);
    await audit(req, req.user!.id, 'analysis.job', 'Job');
    res.json({ analysis });
  });

  router.post('/workers/me/cv/analyze', requireAuth, requireRole('WORKER'), limiter, async (req, res) => {
    const result = await analyzeMyCv(req.user!.id);
    await audit(req, req.user!.id, 'cv.analyzed', 'WorkerProfile', undefined, { pages: result.pages });
    res.json(result);
  });

  router.post('/workers/me/cv/apply', requireAuth, requireRole('WORKER'), validateBody(applySchema), async (req, res) => {
    const { added, skipped, workerId } = await applyCv(req.user!.id, req.body);
    await audit(req, req.user!.id, 'cv.applied', 'WorkerProfile', workerId, { added });
    res.json({ added, skipped, profile: await getOwnProfile(workerId) });
  });

  return router;
}
