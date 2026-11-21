import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { confirmStarted, makeOffer, myOffers, offerSchema, respondToOffer, sentOffers, withdrawOffer } from './service';

const uuid = z.string().uuid();
const idOf = (v: unknown) => {
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
};

export function offersRouter() {
  const router = Router();
  const employer = [requireAuth, requireRole('EMPLOYER')];
  const worker = [requireAuth, requireRole('WORKER')];

  // Employer: write the terms for someone whose application is accepted, see what was sent, take an offer back.
  router.post('/applications/:id/offer', ...employer, validateBody(offerSchema), async (req, res) => {
    const offer = await makeOffer(req.user!.id, idOf(req.params.id), req.body);
    await audit(req, req.user!.id, 'offer.made', 'JobOffer', offer.id);
    res.status(201).json({ offer });
  });
  router.get('/offers/sent', ...employer, async (req, res) => {
    res.json({ items: await sentOffers(req.user!.id) });
  });
  router.post('/offers/:id/withdraw', ...employer, async (req, res) => {
    const offer = await withdrawOffer(req.user!.id, idOf(req.params.id));
    await audit(req, req.user!.id, 'offer.withdrawn', 'JobOffer', offer.id);
    res.json({ offer });
  });

  // Worker: see offers, accept or decline.
  router.get('/offers/mine', ...worker, async (req, res) => {
    res.json({ items: await myOffers(req.user!.id) });
  });
  router.post('/offers/:id/respond', ...worker, validateBody(z.object({ accept: z.boolean() }).strict()), async (req, res) => {
    const offer = await respondToOffer(req.user!.id, idOf(req.params.id), req.body.accept);
    await audit(req, req.user!.id, req.body.accept ? 'offer.accepted' : 'offer.declined', 'JobOffer', offer.id);
    res.json({ offer });
  });

  // Either side: the person started work.
  router.post('/offers/:id/started', requireAuth, requireRole('WORKER', 'EMPLOYER'), async (req, res) => {
    const offer = await confirmStarted(req.user!.id, req.user!.role as 'WORKER' | 'EMPLOYER', idOf(req.params.id));
    await audit(req, req.user!.id, 'offer.started', 'JobOffer', offer.id);
    res.json({ offer });
  });

  return router;
}
