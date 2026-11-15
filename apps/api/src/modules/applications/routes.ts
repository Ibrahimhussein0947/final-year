import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import * as svc from './service';

const uuid = z.string().uuid();
const param = (req: Request, name: string) => {
  const r = uuid.safeParse(req.params[name]);
  if (!r.success) throw notFound();
  return r.data;
};

const applySchema = z.object({ coverNote: z.string().trim().max(1500).transform((v) => v || null).nullable().optional() }).strict().default({});
const statusSchema = z
  .object({
    status: z.enum(['UNDER_REVIEW', 'SHORTLISTED', 'ACCEPTED', 'REJECTED']),
    note: z.string().trim().max(500).transform((v) => v || null).nullable().optional(),
  })
  .strict();
const interviewSchema = z
  .object({
    scheduledAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), 'Choose a time in the future'),
    mode: z.enum(['IN_PERSON', 'PHONE', 'VIDEO']),
    locationOrLink: z.string().trim().max(300).transform((v) => v || null).nullable().optional(),
    /** Let the platform make a private meeting room and use its link (video calls only). */
    createVideoRoom: z.boolean().optional(),
  })
  .strict();

export function applicationsRouter() {
  const router = Router();
  const worker = [requireAuth, requireRole('WORKER')];
  const employer = [requireAuth, requireRole('EMPLOYER')];

  // ── Worker ──
  router.post('/jobs/:id/apply', ...worker, validateBody(applySchema), async (req, res) => {
    const id = await svc.apply(req.user!.id, param(req, 'id'), req.body.coverNote ?? null);
    await audit(req, req.user!.id, 'application.created', 'Application', id);
    res.status(201).json({ applicationId: id });
  });

  router.put('/jobs/:id/save', ...worker, async (req, res) => {
    await svc.saveJob(req.user!.id, param(req, 'id'));
    res.status(204).end();
  });
  router.delete('/jobs/:id/save', ...worker, async (req, res) => {
    await svc.unsaveJob(req.user!.id, param(req, 'id'));
    res.status(204).end();
  });
  router.get('/saved-jobs', ...worker, async (req, res) => {
    res.json({ items: await svc.savedJobs(req.user!.id) });
  });

  router.get('/applications/mine', ...worker, async (req, res) => {
    res.json({ items: await svc.myApplications(req.user!.id) });
  });
  router.post('/applications/:id/withdraw', ...worker, async (req, res) => {
    await svc.withdraw(req.user!.id, param(req, 'id'));
    await audit(req, req.user!.id, 'application.withdrawn', 'Application', param(req, 'id'));
    res.status(204).end();
  });

  // ── Either role ──
  router.get('/applications/summary', requireAuth, requireRole('WORKER', 'EMPLOYER'), async (req, res) => {
    res.json(await svc.summary(req.user!.id, req.user!.role as 'WORKER' | 'EMPLOYER'));
  });

  // ── Employer ──
  router.get('/jobs/:id/applications', ...employer, async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sort = req.query.sort === 'match' ? 'match' : 'newest';
    res.json(await svc.jobApplications(req.user!.id, param(req, 'id'), status, sort));
  });

  router.get('/applications/compare', ...employer, async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter(Boolean);
    if (ids.length < 2 || ids.length > 4 || !ids.every((i) => uuid.safeParse(i).success) || new Set(ids).size !== ids.length) {
      throw badRequest('Choose between 2 and 4 different applications to compare');
    }
    res.json(await svc.compare(req.user!.id, ids));
  });

  router.get('/applications/:id', ...employer, async (req, res) => {
    res.json(await svc.candidateView(req.user!.id, param(req, 'id')));
  });

  router.patch('/applications/:id/status', ...employer, validateBody(statusSchema), async (req, res) => {
    const to = await svc.changeStatus(req.user!.id, param(req, 'id'), req.body.status, req.body.note ?? null);
    await audit(req, req.user!.id, 'application.status_changed', 'Application', param(req, 'id'), { to });
    res.json(await svc.candidateView(req.user!.id, param(req, 'id')));
  });

  router.post('/applications/:id/interviews', ...employer, validateBody(interviewSchema), async (req, res) => {
    const { warnings } = await svc.scheduleInterview(req.user!.id, param(req, 'id'), { ...req.body, locationOrLink: req.body.locationOrLink ?? null });
    res.status(201).json({ ...(await svc.candidateView(req.user!.id, param(req, 'id'))), warnings });
  });
  router.patch('/applications/:id/interviews/:interviewId', ...employer, validateBody(interviewSchema), async (req, res) => {
    const { warnings } = await svc.rescheduleInterview(req.user!.id, param(req, 'id'), param(req, 'interviewId'), { ...req.body, locationOrLink: req.body.locationOrLink ?? null });
    res.json({ ...(await svc.candidateView(req.user!.id, param(req, 'id'))), warnings });
  });
  router.delete('/applications/:id/interviews/:interviewId', ...employer, async (req, res) => {
    await svc.cancelInterview(req.user!.id, param(req, 'id'), param(req, 'interviewId'));
    res.json(await svc.candidateView(req.user!.id, param(req, 'id')));
  });

  return router;
}
