import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { getOwnProfile, workerIdFor } from '../workers/service';
import { applicantReview } from '../applications/service';
import { reviewJobPost, reviewProfile } from './rules';

const jobDraft = z
  .object({
    title: z.string().trim().max(150).default(''),
    description: z.string().trim().max(10_000).default(''),
    salaryMin: z.number().int().min(0).nullable().optional(),
    salaryMax: z.number().int().min(0).nullable().optional(),
    deadline: z.coerce.date().nullable().optional(),
    skillCount: z.number().int().min(0).max(20).default(0),
    requiredSkillCount: z.number().int().min(0).max(20).default(0),
    hasLocation: z.boolean().default(false),
    schedule: z.string().trim().max(300).nullable().optional(),
    benefits: z.string().trim().max(1000).nullable().optional(),
    minExperienceYears: z.number().int().min(0).max(50).nullable().optional(),
    remote: z.boolean().default(false),
  })
  .strip();

const uuid = z.string().uuid();

/** "Look over" tools: rule-based reviews of a profile, a job draft and an applicant. Nothing is saved or changed. */
export function reviewRouter() {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: env.isTest ? 10_000 : 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
    validate: { keyGeneratorIpFallback: false },
    message: { error: { code: 'RATE_LIMITED', message: 'Too many reviews, wait a minute and try again' } },
  });

  router.get('/review/profile', requireAuth, requireRole('WORKER'), limiter, async (req, res) => {
    const p = await getOwnProfile(await workerIdFor(req.user!.id));
    res.json({
      review: reviewProfile({
        headline: p.headline, bio: p.bio, yearsExperience: p.yearsExperience,
        skills: p.skills.map((s) => ({ years: s.years })),
        experiences: p.experiences, educationCount: p.education.length, certifications: p.certifications,
        activityCount: p.activities.length, languages: p.languages, languageLevels: (p.languageLevels ?? {}) as Record<string, string>,
        hasCv: !!p.cvUrl, hasPhoto: !!p.photoUrl,
      }),
    });
  });

  router.post('/review/job', requireAuth, requireRole('EMPLOYER'), limiter, validateBody(jobDraft), async (req, res) => {
    const d = req.body as z.infer<typeof jobDraft>;
    await audit(req, req.user!.id, 'review.job', 'Job');
    res.json({
      review: reviewJobPost({
        title: d.title, description: d.description, salaryMin: d.salaryMin ?? null, salaryMax: d.salaryMax ?? null, deadline: d.deadline ?? null,
        skillCount: d.skillCount, requiredSkillCount: d.requiredSkillCount, hasLocation: d.hasLocation, schedule: d.schedule ?? null,
        benefits: d.benefits ?? null, minExperienceYears: d.minExperienceYears ?? null, remote: d.remote,
      }),
    });
  });

  router.get('/review/applications/:id', requireAuth, requireRole('EMPLOYER'), limiter, async (req: Request, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw notFound();
    await audit(req, req.user!.id, 'review.applicant', 'Application', id.data);
    res.json({ review: await applicantReview(req.user!.id, id.data) });
  });

  return router;
}
