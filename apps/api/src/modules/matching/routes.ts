import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { detailInclude, orgIdFor, ownedJob, toListItem } from '../jobs/service';
import { workerIdFor } from '../workers/service';
import { publicMatch, recommendJobs, recommendWorkers, scoreJobsForWorker, scoreOne } from './service';
import { fitOf } from './fit';
import { clearMatchingCaches, getWeights, parseStoredWeights, weightsInputSchema } from './weights';
import { COMPONENT_KEYS, DEFAULT_WEIGHTS } from './types';

const uuid = z.string().uuid();
const idParam = (req: Request) => {
  const r = uuid.safeParse(req.params.id);
  if (!r.success) throw notFound();
  return r.data;
};
const limitOf = (req: Request, def = 10) => {
  const n = Number(req.query.limit ?? def);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : def;
};

export function matchingRouter() {
  const router = Router();

  // Employer: workers who could fit one of their jobs (people who already applied are excluded).
  router.get('/jobs/:id/recommended-workers', requireAuth, requireRole('EMPLOYER'), async (req, res) => {
    const job = await ownedJob(await orgIdFor(req.user!.id), idParam(req));
    const ranked = await recommendWorkers(job.id, limitOf(req));
    const rows = await prisma.workerProfile.findMany({
      where: { id: { in: ranked.map((r) => r.workerId) } },
      select: {
        id: true, headline: true, occupation: true, yearsExperience: true, photoFileId: true,
        user: { select: { fullName: true } },
        location: { select: { nameEn: true, parent: { select: { nameEn: true, parent: { select: { nameEn: true } } } } } },
        skills: { select: { skill: { select: { nameEn: true } } }, take: 5 },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const invites = new Map((await prisma.jobInvitation.findMany({ where: { jobId: job.id, workerId: { in: ranked.map((r) => r.workerId) } }, select: { workerId: true, status: true } })).map((i) => [i.workerId, i.status]));
    res.json({
      job: { id: job.id, title: job.title },
      items: ranked.map(({ workerId, result }) => {
        const w = byId.get(workerId)!;
        // Same privacy as the public profile: administrative area only, never contact details or exact position.
        const names: string[] = [];
        for (let cur: any = w.location; cur; cur = cur.parent) names.unshift(cur.nameEn);
        return {
          workerId, name: w.user.fullName, headline: w.headline, occupation: w.occupation, yearsExperience: w.yearsExperience,
          photoUrl: w.photoFileId ? `/api/v1/files/${w.photoFileId}` : null, location: names.slice(0, 3).join(', ') || null,
          skills: w.skills.map((s) => s.skill.nameEn), match: publicMatch(result), invitation: invites.get(workerId) ?? null,
        };
      }),
    });
  });

  // Worker: open jobs that could fit me.
  router.get('/recommendations/jobs', requireAuth, requireRole('WORKER'), async (req, res) => {
    const { items, reason } = await recommendJobs(await workerIdFor(req.user!.id), limitOf(req));
    const jobs = await prisma.job.findMany({ where: { id: { in: items.map((i) => i.jobId) } }, include: detailInclude });
    const byId = new Map(jobs.map((j) => [j.id, j]));
    res.json({
      reason,
      items: items.map(({ jobId, result }) => ({ job: toListItem(byId.get(jobId)!), match: publicMatch(result) })),
    });
  });

  // Worker: a one-line fit for each job on the page ("you meet 4 of 6 requirements").
  router.post('/jobs/fit', requireAuth, requireRole('WORKER'), validateBody(z.object({ jobIds: z.array(z.string().uuid()).min(1).max(30) }).strict()), async (req, res) => {
    const scored = await scoreJobsForWorker(await workerIdFor(req.user!.id), [...new Set(req.body.jobIds as string[])]);
    res.json({ items: Object.fromEntries([...scored].map(([id, m]) => [id, fitOf(m)])) });
  });

  // Worker: why (or why not) does this job fit me.
  router.get('/jobs/:id/match', requireAuth, requireRole('WORKER'), async (req, res) => {
    const id = idParam(req);
    const job = await prisma.job.findFirst({ where: { id, status: 'ACTIVE' }, select: { id: true } });
    if (!job) throw notFound('Job not found');
    const { result } = await scoreOne(id, await workerIdFor(req.user!.id));
    res.json({ match: publicMatch(result) });
  });

  // ── Administrator: matching weights ──
  const admin = [requireAuth, requireRole('ADMIN')];

  router.get('/admin/match-weights', ...admin, async (_req, res) => {
    const rows = await prisma.matchWeights.findMany({ where: { active: true }, include: { category: { select: { nameEn: true } } }, orderBy: { createdAt: 'desc' } });
    res.json({
      defaults: DEFAULT_WEIGHTS,
      global: (await getWeights(null)),
      overrides: rows.filter((r) => r.categoryId).map((r) => ({ categoryId: r.categoryId, category: r.category?.nameEn, version: r.version, weights: parseStoredWeights(r.weights) ?? r.weights })),
    });
  });

  const putSchema = z.object({ categoryId: z.string().uuid().nullable(), weights: weightsInputSchema }).strict();
  router.put('/admin/match-weights', ...admin, validateBody(putSchema), async (req, res) => {
    const { categoryId, weights } = req.body as z.infer<typeof putSchema>;
    if (categoryId && !(await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) throw badRequest('Unknown category');
    const total = Object.values(weights).reduce((s, n) => s + n, 0);
    // Store normalized weights so they sum to exactly 1.
    const normalized = Object.fromEntries(COMPONENT_KEYS.map((k) => [k, Math.round((weights[k] / total) * 10_000) / 10_000]));
    const last = await prisma.matchWeights.findFirst({ where: { categoryId }, orderBy: { version: 'desc' } });
    const version = (last?.version ?? 0) + 1;
    await prisma.$transaction([
      prisma.matchWeights.updateMany({ where: { categoryId, active: true }, data: { active: false } }),
      prisma.matchWeights.create({ data: { categoryId, weights: normalized, version, active: true, createdBy: req.user!.id } }),
    ]);
    clearMatchingCaches();
    await audit(req, req.user!.id, 'matching.weights_updated', 'MatchWeights', categoryId ?? 'global', { version, weights: normalized });
    res.json({ categoryId, version, weights: normalized });
  });

  // Remove a category override so that category falls back to the global weights.
  router.delete('/admin/match-weights/:id', ...admin, async (req, res) => {
    const categoryId = idParam(req);
    await prisma.matchWeights.updateMany({ where: { categoryId, active: true }, data: { active: false } });
    clearMatchingCaches();
    await audit(req, req.user!.id, 'matching.weights_override_removed', 'MatchWeights', categoryId);
    res.status(204).end();
  });

  return router;
}
