import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { answerAppeal, answerSchema, appealSchema, employerAppeal, submitAppeal } from './appeals';
import { deleteStep, hiringView, recordStep, stepInputSchema } from './steps';

const uuid = z.string().uuid();
const idOf = (v: unknown) => {
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
};

export function hiringRouter() {
  const router = Router();
  const employer = [requireAuth, requireRole('EMPLOYER')];
  const worker = [requireAuth, requireRole('WORKER')];

  // The recruitment steps for one candidate: what this kind of organization requires or suggests, and what has been recorded.
  router.get('/applications/:id/hiring', ...employer, async (req, res) => {
    res.json(await hiringView(req.user!.id, idOf(req.params.id)));
  });
  router.post('/applications/:id/steps', ...employer, async (req, res) => {
    const body = stepInputSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Check the details of this step', body.error.flatten().fieldErrors as Record<string, string[]>);
    const out = await recordStep(req.user!.id, idOf(req.params.id), body.data);
    await audit(req, req.user!.id, 'hiring.step_recorded', 'HiringStep', out.id, { kind: out.kind });
    res.status(201).json({ step: out, ...(await hiringView(req.user!.id, idOf(req.params.id))) });
  });
  router.delete('/applications/:id/steps/:stepId', ...employer, async (req, res) => {
    await deleteStep(req.user!.id, idOf(req.params.id), idOf(req.params.stepId));
    await audit(req, req.user!.id, 'hiring.step_deleted', 'HiringStep', req.params.stepId as string);
    res.json(await hiringView(req.user!.id, idOf(req.params.id)));
  });

  // A rejected candidate asks for a review, where the organization type allows it; the employer answers in writing.
  router.post('/applications/:id/appeal', ...worker, validateBody(appealSchema), async (req, res) => {
    const out = await submitAppeal(req.user!.id, idOf(req.params.id), req.body.reason);
    await audit(req, req.user!.id, 'application.appealed', 'ApplicationAppeal', out.id);
    res.status(201).json({ appeal: out });
  });
  router.get('/applications/:id/appeal', ...employer, async (req, res) => {
    res.json({ appeal: await employerAppeal(req.user!.id, idOf(req.params.id)) });
  });
  router.post('/applications/:id/appeal/answer', ...employer, validateBody(answerSchema), async (req, res) => {
    const out = await answerAppeal(req.user!.id, idOf(req.params.id), req.body);
    await audit(req, req.user!.id, 'application.appeal_answered', 'Application', req.params.id as string, { outcome: out.outcome });
    res.json({ appeal: out });
  });

  return router;
}
