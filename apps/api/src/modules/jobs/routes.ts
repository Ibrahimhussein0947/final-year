import type { OrganizationType } from '@prisma/client';
import { getPolicy } from '../hiring/service';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { jobCreateSchema, jobUpdateSchema, listQuerySchema, publishSchema } from './schema';
import * as svc from './service';
import { viewerState } from '../applications/service';
import { salaryGuide, salaryGuideQuery } from './salaryGuide';

const uuid = z.string().uuid();
const jobId = (req: Request) => {
  const r = uuid.safeParse(req.params.id);
  if (!r.success) throw notFound('Job not found');
  return r.data;
};

export function jobsRouter() {
  const router = Router();
  const employer = [requireAuth, requireRole('EMPLOYER')];

  // ── Employer management (declared before /:id so "mine" is not read as an id) ──
  router.get('/mine', ...employer, async (req, res) => {
    res.json({ items: await svc.myJobs(await svc.orgIdFor(req.user!.id)) });
  });

  router.post('/', ...employer, validateBody(jobCreateSchema), async (req, res) => {
    const orgId = await svc.orgIdFor(req.user!.id);
    const id = await svc.createJob(orgId, req.user!.id, req.body);
    await audit(req, req.user!.id, 'job.created', 'Job', id);
    res.status(201).json({ job: await svc.getJob(id, req.user) });
  });

  router.patch('/:id', ...employer, validateBody(jobUpdateSchema), async (req, res) => {
    const orgId = await svc.orgIdFor(req.user!.id);
    await svc.updateJob(orgId, jobId(req), req.body);
    res.json({ job: await svc.getJob(jobId(req), req.user) });
  });

  router.post('/:id/publish', ...employer, validateBody(publishSchema), async (req, res) => {
    const orgId = await svc.orgIdFor(req.user!.id);
    const result = await svc.publishJob(orgId, req.user!.id, jobId(req), req.body.confirmNotDuplicate);
    await audit(req, req.user!.id, result.flaggedAsCopy ? 'job.published_flagged_copy' : result.flaggedAsRisky ? 'job.published_flagged_risky' : 'job.published', 'Job', jobId(req), { status: result.status });
    res.json({ job: await svc.getJob(jobId(req), req.user), flaggedAsCopy: result.flaggedAsCopy, flaggedAsRisky: result.flaggedAsRisky });
  });

  router.post('/:id/close', ...employer, validateBody(z.object({ filled: z.boolean().optional() }).default({})), async (req, res) => {
    const orgId = await svc.orgIdFor(req.user!.id);
    await svc.setJobClosed(orgId, jobId(req), req.body.filled ? 'FILLED' : 'CLOSED');
    await audit(req, req.user!.id, req.body.filled ? 'job.filled' : 'job.closed', 'Job', jobId(req));
    res.json({ job: await svc.getJob(jobId(req), req.user) });
  });

  router.post('/:id/feature', ...employer, validateBody(z.object({ featured: z.boolean() }).strict()), async (req, res) => {
    const orgId = await svc.orgIdFor(req.user!.id);
    await svc.setJobFeatured(orgId, jobId(req), req.body.featured);
    await audit(req, req.user!.id, req.body.featured ? 'job.featured' : 'job.unfeatured', 'Job', jobId(req));
    res.json({ job: await svc.getJob(jobId(req), req.user) });
  });

  router.delete('/:id', ...employer, async (req, res) => {
    await svc.deleteJob(await svc.orgIdFor(req.user!.id), jobId(req));
    res.status(204).end();
  });

  // ── Public ──
  router.get('/', async (req, res) => {
    const q = listQuerySchema.safeParse(req.query);
    if (!q.success) throw badRequest('Invalid search', q.error.flatten().fieldErrors);
    res.json(await svc.searchJobs(q.data));
  });

  // What similar jobs offer: aggregated posted pay for one category, narrowed to the person's area when there is enough data.
  router.get('/salary-guide', async (req, res) => {
    const q = salaryGuideQuery.safeParse(req.query);
    if (!q.success) throw badRequest('Choose a job category', q.error.flatten().fieldErrors);
    res.json(await salaryGuide(q.data));
  });

  router.get('/:id', optionalAuth, async (req, res) => {
    const job = await svc.getJob(jobId(req), req.user);
    // Workers also learn whether they already applied to or saved this job.
    const viewer = req.user?.role === 'WORKER' ? await viewerState(req.user.id, job.id) : null;
    const policy = await getPolicy(job.organization.type as OrganizationType);
    res.json({ job: { ...job, vacancyLabel: policy.label }, viewer });
  });

  return router;
}
