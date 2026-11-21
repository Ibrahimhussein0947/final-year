import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { adminCreate, adminDelete, adminList, adminUpdate, listTestsForWorker, startTest, submitSchema, submitTest, testSchema, testUpdateSchema } from './service';

const uuid = z.string().uuid();
const idOf = (v: unknown) => {
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
};

export function skillTestsRouter() {
  const router = Router();
  const worker = [requireAuth, requireRole('WORKER')];

  router.get('/skill-tests', ...worker, async (req, res) => {
    res.json({ items: await listTestsForWorker(req.user!.id) });
  });
  // The questions come back without their answers; the server grades.
  router.post('/skill-tests/:id/start', ...worker, async (req, res) => {
    res.json(await startTest(req.user!.id, idOf(req.params.id)));
  });
  router.post('/skill-test-attempts/:id/submit', ...worker, validateBody(submitSchema), async (req, res) => {
    const result = await submitTest(req.user!.id, idOf(req.params.id), req.body.answers);
    await audit(req, req.user!.id, result.passed ? 'skilltest.passed' : 'skilltest.failed', 'SkillTestAttempt', req.params.id as string);
    res.json({ result });
  });
  return router;
}

/** Administrators write and edit the tests. Nothing is invented here: no test exists until one is added. */
export function skillTestsAdminRouter() {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));
  router.get('/', async (_req, res) => { res.json({ items: await adminList() }); });
  router.post('/', validateBody(testSchema), async (req, res) => {
    const item = await adminCreate(req.body);
    await audit(req, req.user!.id, 'admin.skilltest_created', 'SkillTest', item.id);
    res.status(201).json({ item });
  });
  router.patch('/:id', validateBody(testUpdateSchema), async (req, res) => {
    const item = await adminUpdate(idOf(req.params.id), req.body);
    await audit(req, req.user!.id, 'admin.skilltest_updated', 'SkillTest', item.id);
    res.json({ item });
  });
  router.delete('/:id', async (req, res) => {
    await adminDelete(idOf(req.params.id));
    await audit(req, req.user!.id, 'admin.skilltest_deleted', 'SkillTest', req.params.id as string);
    res.status(204).end();
  });
  return router;
}
