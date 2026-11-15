import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import * as svc from './service';

const uuid = z.string().uuid();
const idOf = (req: Request, name = 'id') => {
  const r = uuid.safeParse(req.params[name]);
  if (!r.success) throw notFound();
  return r.data;
};

export function messagingRouter() {
  const router = Router();
  const parties = [requireAuth, requireRole('WORKER', 'EMPLOYER')];
  const sendLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.isTest ? 10_000 : 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
    validate: { keyGeneratorIpFallback: false },
    message: { error: { code: 'RATE_LIMITED', message: 'You are sending messages too fast. Wait a moment.' } },
  });

  router.post('/applications/:id/conversation', ...parties, async (req, res) => {
    res.status(201).json(await svc.openConversation(req.user!.id, req.user!.role, idOf(req)));
  });

  router.post('/invitations/:id/conversation', ...parties, async (req, res) => {
    res.status(201).json(await svc.openInvitationConversation(req.user!.id, req.user!.role, idOf(req)));
  });

  router.get('/conversations', ...parties, async (req, res) => {
    res.json({ items: await svc.listConversations(req.user!.id) });
  });

  router.get('/conversations/unread-count', ...parties, async (req, res) => {
    res.json({ unread: await svc.unreadTotal(req.user!.id) });
  });

  router.get('/conversations/:id/messages', ...parties, async (req, res) => {
    const q = z.object({ before: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
    if (!q.success) throw badRequest('Invalid query');
    res.json(await svc.getMessages(req.user!.id, idOf(req), q.data));
  });

  router.post('/conversations/:id/messages', ...parties, sendLimiter, validateBody(z.object({ body: z.string().max(5000) }).strict()), async (req, res) => {
    res.status(201).json({ message: await svc.sendMessage(req.user!.id, idOf(req), req.body.body) });
  });

  router.post('/conversations/:id/read', ...parties, async (req, res) => {
    res.json(await svc.markRead(req.user!.id, idOf(req)));
  });

  return router;
}
