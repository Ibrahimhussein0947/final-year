import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { listDefinitions } from './service';

/** Public: the sector questions that the job form, the worker profile and the search filters are built from. */
export function criteriaRouter() {
  const router = Router();

  // GET /criteria            every active criterion (about 40, small)
  // GET /criteria?categoryId one sector's criteria plus those that apply to every sector
  router.get('/criteria', async (req, res) => {
    const q = z.object({ categoryId: z.string().uuid().optional() }).safeParse(req.query);
    if (!q.success) throw badRequest('Invalid category');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ items: await listDefinitions({ categoryId: q.data.categoryId }) });
  });

  return router;
}
