import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound, tooMany } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { deleteFileAsset, saveUpload, uploadSingle } from '../files/storage';
import { employerAnalyticsRoute, workerAnalyticsRoute } from '../analytics/routes';
import { publicStats } from '../analytics/service';
import { workerIdFor } from '../workers/service';

const REASONS = ['SCAM', 'FALSE_INFO', 'DISCRIMINATION', 'OFFENSIVE', 'DUPLICATE', 'OTHER'] as const;
const REPORTS_PER_DAY = 10;

// Public translation overrides (cached briefly: the front end asks on every page load).
let tCache = new Map<string, { at: number; value: Record<string, string> }>();

export function trustRouter() {
  const router = Router();

  // ── Anyone signed in can report a job or a user ──
  router.post(
    '/reports',
    requireAuth,
    validateBody(z.object({ targetType: z.enum(['JOB', 'USER']), targetId: z.string().uuid(), reason: z.enum(REASONS), details: z.string().trim().max(1000).optional() }).strict()),
    async (req, res) => {
      const { targetType, targetId, reason, details } = req.body as { targetType: 'JOB' | 'USER'; targetId: string; reason: (typeof REASONS)[number]; details?: string };
      const me = req.user!.id;
      if (targetType === 'USER') {
        if (targetId === me) throw badRequest('You cannot report yourself');
        if (!(await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } }))) throw notFound('User not found');
      } else {
        const job = await prisma.job.findFirst({ where: { id: targetId, status: { not: 'REMOVED' } }, select: { postedById: true } });
        if (!job) throw notFound('Job not found');
        if (job.postedById === me) throw badRequest('You cannot report your own job');
      }
      const today = await prisma.report.count({ where: { reporterId: me, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
      if (today >= REPORTS_PER_DAY) throw tooMany('You have sent many reports today. Please try again tomorrow.');
      try {
        const r = await prisma.report.create({ data: { reporterId: me, targetType, targetId, reason, details: details || null } });
        await audit(req, me, 'report.created', 'Report', r.id, { targetType, reason });
        res.status(201).json({ id: r.id });
      } catch {
        // the partial unique index allows only one open report per person and target
        throw conflict('You already reported this. We will review it.');
      }
    },
  );

  // ── Workers ask for a qualification or skill to be verified, with evidence ──
  const requestsLimiter = rateLimit({
    windowMs: 60 * 60_000, limit: env.isTest ? 10_000 : 20, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon', validate: { keyGeneratorIpFallback: false },
    message: { error: { code: 'RATE_LIMITED', message: 'Too many verification requests, try again later' } },
  });
  const worker = [requireAuth, requireRole('WORKER')];

  router.post('/workers/me/verification', ...worker, requestsLimiter, uploadSingle, async (req: Request, res) => {
    const body = z.object({ kind: z.enum(['QUALIFICATION', 'SKILL']), targetType: z.enum(['EDUCATION', 'CERTIFICATION', 'SKILL', 'CRITERION']), targetId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) throw badRequest('Choose what you want verified', body.error.flatten().fieldErrors);
    const { kind, targetType, targetId } = body.data;
    if ((kind === 'SKILL') !== (targetType === 'SKILL')) throw badRequest('Request type does not match what is being verified');

    const workerId = await workerIdFor(req.user!.id);
    const owned =
      targetType === 'EDUCATION' ? await prisma.education.findFirst({ where: { id: targetId, workerId }, select: { source: true } })
      : targetType === 'CERTIFICATION' ? await prisma.certification.findFirst({ where: { id: targetId, workerId }, select: { source: true } })
      : targetType === 'CRITERION' ? await prisma.workerCriterion.findFirst({ where: { id: targetId, workerId }, select: { source: true } })
      : await prisma.workerSkill.findUnique({ where: { workerId_skillId: { workerId, skillId: targetId } }, select: { source: true } });
    if (!owned) throw notFound('That item is not on your profile');
    if (owned.source === 'VERIFIED') throw conflict('This item is already verified');
    if (await prisma.verificationRequest.findFirst({ where: { userId: req.user!.id, kind, targetType, targetId, status: 'PENDING' }, select: { id: true } })) {
      throw conflict('A request for this item is already waiting for review');
    }
    const asset = await saveUpload(req.user!.id, 'CERTIFICATE', req.file);
    const created = await prisma.verificationRequest.create({ data: { userId: req.user!.id, kind, targetType, targetId, evidenceFileId: asset.id } });
    await audit(req, req.user!.id, 'worker.verification_requested', 'VerificationRequest', created.id, { kind, targetType });
    res.status(201).json({ id: created.id, status: created.status });
  });

  router.get('/workers/me/verifications', ...worker, async (req, res) => {
    const rows = await prisma.verificationRequest.findMany({ where: { userId: req.user!.id, kind: { in: ['QUALIFICATION', 'SKILL'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, targetType: true, targetId: true, status: true, note: true, createdAt: true } });
    res.json({ items: rows });
  });

  router.delete('/workers/me/verifications/:id', ...worker, async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound();
    const r = await prisma.verificationRequest.findFirst({ where: { id: id.data, userId: req.user!.id, status: 'PENDING' } });
    if (!r) throw notFound('No pending request found');
    await prisma.verificationRequest.delete({ where: { id: r.id } });
    await deleteFileAsset(r.evidenceFileId);
    res.status(204).end();
  });

  // ── Public: bundled-text overrides and safe totals ──
  router.get('/translations/:locale', async (req, res) => {
    const locale = z.enum(['en', 'am', 'om']).safeParse(req.params.locale);
    if (!locale.success) throw notFound();
    const hit = tCache.get(locale.data);
    if (hit && Date.now() - hit.at < 30_000) return void res.set('Cache-Control', 'public, max-age=30').json(hit.value);
    const rows = await prisma.translation.findMany({ where: { locale: locale.data }, select: { key: true, value: true } });
    const value = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    tCache.set(locale.data, { at: Date.now(), value });
    res.set('Cache-Control', 'public, max-age=30').json(value);
  });
  router.get('/public/stats', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60').json(await publicStats());
  });

  // ── Personal analytics ──
  router.get('/analytics/worker', ...worker, workerAnalyticsRoute);
  router.get('/analytics/employer', requireAuth, requireRole('EMPLOYER'), employerAnalyticsRoute);

  return router;
}

export const clearTranslationCache = () => {
  tCache = new Map();
};
