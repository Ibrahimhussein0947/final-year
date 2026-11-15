import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { orgIdFor } from '../jobs/service';
import { workerIdFor } from '../workers/service';
import { bulkInviteSchema, declineInvitation, inviteMany, inviteSchema, inviteWorker, listJobInvitations, myInvitations, searchSchema, searchWorkers } from './service';

const uuid = z.string().uuid();
const idOf = (req: Request) => {
  const r = uuid.safeParse(req.params.id);
  if (!r.success) throw notFound();
  return r.data;
};

/** Employer search for workers, and invitations to apply. */
export function talentRouter() {
  const router = Router();
  const employer = [requireAuth, requireRole('EMPLOYER')];
  const worker = [requireAuth, requireRole('WORKER')];

  // Searching reads many profiles, so keep each employer to a modest rate.
  const searchLimiter = rateLimit({
    windowMs: 60_000, limit: env.isTest ? 10_000 : 60, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon', validate: { keyGeneratorIpFallback: false },
    message: { error: { code: 'RATE_LIMITED', message: 'Too many searches, wait a minute and try again' } },
  });

  router.get('/talent/search', ...employer, searchLimiter, async (req, res) => {
    const q = searchSchema.safeParse(req.query);
    if (!q.success) throw badRequest('Invalid search', q.error.flatten().fieldErrors);
    res.json(await searchWorkers(await orgIdFor(req.user!.id), q.data));
  });

  router.post('/jobs/:id/invitations', ...employer, validateBody(inviteSchema), async (req, res) => {
    const id = await inviteWorker(req, req.user!.id, await orgIdFor(req.user!.id), idOf(req), req.body);
    res.status(201).json({ id });
  });

  router.post('/jobs/:id/invitations/bulk', ...employer, validateBody(bulkInviteSchema), async (req, res) => {
    res.json(await inviteMany(req, req.user!.id, await orgIdFor(req.user!.id), idOf(req), req.body));
  });

  router.get('/jobs/:id/invitations', ...employer, async (req, res) => {
    res.json({ items: await listJobInvitations(await orgIdFor(req.user!.id), idOf(req)) });
  });

  router.get('/invitations/mine', ...worker, async (req, res) => {
    res.json({ items: await myInvitations(await workerIdFor(req.user!.id)) });
  });

  router.post('/invitations/:id/decline', ...worker, async (req, res) => {
    await declineInvitation(await workerIdFor(req.user!.id), idOf(req));
    res.status(204).end();
  });

  return router;
}
