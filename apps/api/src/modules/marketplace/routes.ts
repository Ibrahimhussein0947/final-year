import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { askSchema, inquirySchema, listingCreateSchema, listingQuerySchema, listingUpdateSchema, respondSchema } from './schema';
import * as svc from './service';

const uuid = z.string().uuid();
const idOf = (v: unknown) => {
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
};

export function marketplaceRouter() {
  const router = Router();
  const provider = [requireAuth, requireRole('WORKER')];
  // Customers are workers or employers looking for a service, never administrators.
  const customer = [requireAuth, requireRole('WORKER', 'EMPLOYER')];
  const askLimit = rateLimit({
    windowMs: 60_000,
    limit: env.isTest ? 10_000 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many searches, wait a minute and try again' } },
  });

  // ── Discovery (public) ──
  router.get('/', async (req, res) => {
    const q = listingQuerySchema.safeParse(req.query);
    if (!q.success) throw badRequest('Check the search filters', q.error.flatten().fieldErrors as Record<string, string[]>);
    res.json(await svc.searchListings(q.data));
  });

  router.post('/ask', askLimit, validateBody(askSchema), async (req, res) => {
    res.json(await svc.askForService(req.body.text));
  });

  // ── The provider's own listings (declared before /:id so these words are not read as ids) ──
  router.get('/mine', ...provider, async (req, res) => {
    res.json({ items: await svc.myListings(req.user!.id) });
  });

  router.post('/', ...provider, validateBody(listingCreateSchema), async (req, res) => {
    const id = await svc.createListing(req.user!.id, req.body);
    await audit(req, req.user!.id, 'service.created', 'ServiceListing', id);
    res.status(201).json({ listing: await svc.getListing(id, req.user!.id) });
  });

  // ── Inquiries ──
  router.get('/inquiries/received', ...provider, async (req, res) => {
    res.json({ items: await svc.receivedInquiries(req.user!.id) });
  });
  router.get('/inquiries/sent', ...customer, async (req, res) => {
    res.json({ items: await svc.sentInquiries(req.user!.id) });
  });
  router.post('/inquiries/:id/respond', ...provider, validateBody(respondSchema), async (req, res) => {
    await svc.respondToInquiry(req.user!.id, idOf(req.params.id), req.body);
    await audit(req, req.user!.id, req.body.accept ? 'service.inquiry_accepted' : 'service.inquiry_declined', 'ServiceInquiry', req.params.id as string);
    res.json({ items: await svc.receivedInquiries(req.user!.id) });
  });
  router.post('/inquiries/:id/cancel', ...customer, async (req, res) => {
    await svc.cancelInquiry(req.user!.id, idOf(req.params.id));
    res.json({ items: await svc.sentInquiries(req.user!.id) });
  });

  // ── One listing ──
  router.get('/:id', optionalAuth, async (req, res) => {
    res.json({ listing: await svc.getListing(idOf(req.params.id), req.user?.id ?? null) });
  });
  router.patch('/:id', ...provider, validateBody(listingUpdateSchema), async (req, res) => {
    await svc.updateListing(req.user!.id, idOf(req.params.id), req.body);
    res.json({ listing: await svc.getListing(idOf(req.params.id), req.user!.id) });
  });
  router.post('/:id/publish', ...provider, async (req, res) => {
    await svc.publishListing(req.user!.id, idOf(req.params.id));
    await audit(req, req.user!.id, 'service.published', 'ServiceListing', req.params.id as string);
    res.json({ listing: await svc.getListing(idOf(req.params.id), req.user!.id) });
  });
  router.post('/:id/pause', ...provider, async (req, res) => {
    await svc.pauseListing(req.user!.id, idOf(req.params.id));
    res.json({ listing: await svc.getListing(idOf(req.params.id), req.user!.id) });
  });
  router.delete('/:id', ...provider, async (req, res) => {
    await svc.removeListing(req.user!.id, idOf(req.params.id));
    await audit(req, req.user!.id, 'service.removed', 'ServiceListing', req.params.id as string);
    res.status(204).end();
  });
  router.post('/:id/inquiries', ...customer, validateBody(inquirySchema), async (req, res) => {
    const out = await svc.sendInquiry(req.user!.id, idOf(req.params.id), req.body);
    await audit(req, req.user!.id, 'service.inquiry_sent', 'ServiceInquiry', out.id);
    res.status(201).json({ inquiry: out });
  });

  return router;
}
