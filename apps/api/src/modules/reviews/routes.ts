import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { orgIdFor } from '../jobs/service';
import { organizationRating, reviewSchema, submitReview } from './service';

const uuid = z.string().uuid();

export function reviewsRouter() {
  const router = Router();

  // A worker rates an employer after an interview or a hire. Once per application.
  router.post('/applications/:id/review', requireAuth, requireRole('WORKER'), validateBody(reviewSchema), async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw notFound();
    const out = await submitReview(req.user!.id, id.data, req.body);
    await audit(req, req.user!.id, 'employer.reviewed', 'EmployerReview', out.id);
    res.status(201).json({ review: out });
  });

  // Totals only. Public, because workers read it before applying.
  router.get('/organizations/:id/rating', async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) throw notFound();
    if (!(await prisma.organization.findUnique({ where: { id: id.data }, select: { id: true } }))) throw notFound();
    res.json({ rating: await organizationRating(id.data) });
  });

  // The employer's own totals (never who rated).
  router.get('/employers/me/rating', requireAuth, requireRole('EMPLOYER'), async (req, res) => {
    res.json({ rating: await organizationRating(await orgIdFor(req.user!.id)) });
  });

  return router;
}
