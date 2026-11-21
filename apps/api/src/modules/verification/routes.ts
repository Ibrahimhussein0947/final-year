import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { workerIdFor } from '../workers/service';
import { currentCvCheck, latestCvCheck, opportunitiesAfterAcceptance, opportunitiesFor } from './service';

/** The result of comparing a worker's CV with their profile, and the jobs that fit once it is accepted. */
export function verificationRouter() {
  const router = Router();
  const worker = [requireAuth, requireRole('WORKER')];

  // The latest result (what happened to the last CV or application).
  router.get('/workers/me/cv-check', ...worker, async (req, res) => {
    const workerId = await workerIdFor(req.user!.id);
    const has = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, select: { cvFileId: true } });
    res.json({ hasCv: !!has.cvFileId, check: await latestCvCheck(workerId) });
  });

  // Compare again, for example after correcting the profile. Reuses the last result when nothing it looks at has changed.
  router.post('/workers/me/cv-check', ...worker, async (req, res) => {
    const workerId = await workerIdFor(req.user!.id);
    const check = await currentCvCheck(workerId);
    if (!check) throw badRequest('Upload your CV first, then it can be compared with your profile.');
    const opportunities = check.outcome === 'ACCEPTED' ? await opportunitiesAfterAcceptance(workerId, req.user!.id) : null;
    res.json({ check, opportunities });
  });

  // The open jobs that fit what the worker wants (the same ranking as /recommendations/jobs, with the job details).
  router.get('/workers/me/opportunities', ...worker, async (req, res) => {
    res.json(await opportunitiesFor(await workerIdFor(req.user!.id), 10));
  });

  return router;
}
