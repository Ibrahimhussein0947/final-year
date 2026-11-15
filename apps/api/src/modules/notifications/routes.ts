import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/errors';
import { notifier } from '../../integrations/notify';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';

export function notificationsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    ]);
    res.json({ items, unread });
  });

  // Notification preferences. Declared before "/:id/read" so "settings" is never read as an id.
  const SETTINGS = { notifyJobMatches: true, notifySms: true, phoneVerifiedAt: true, autoApply: true, autoApplyMinScore: true } as const;
  const settingsOut = (u: { notifyJobMatches: boolean; notifySms: boolean; phoneVerifiedAt: Date | null; autoApply: boolean; autoApplyMinScore: number }) => ({
    notifyJobMatches: u.notifyJobMatches, notifySms: u.notifySms, phoneVerified: !!u.phoneVerifiedAt, smsProviderConfigured: notifier.smsConfigured(),
    // Opt-in, off by default: when on, a job that matches at or above this score gets an application sent for the worker.
    autoApply: u.autoApply, autoApplyMinScore: u.autoApplyMinScore,
  });

  router.get('/settings', async (req, res) => {
    res.json(settingsOut(await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: SETTINGS })));
  });

  router.patch(
    '/settings',
    validateBody(z.object({
      notifyJobMatches: z.boolean().optional(), notifySms: z.boolean().optional(),
      autoApply: z.boolean().optional(), autoApplyMinScore: z.number().int().min(50).max(100).optional(),
    }).strict()),
    async (req, res) => {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { phoneVerifiedAt: true } });
      if (req.body.notifySms && !u.phoneVerifiedAt) throw badRequest('Verify your phone number before turning on SMS');
      if ((req.body.autoApply || req.body.autoApplyMinScore !== undefined) && req.user!.role !== 'WORKER') throw badRequest('Automatic applying is only for job seekers');
      await prisma.user.update({ where: { id: req.user!.id }, data: req.body });
      res.json(settingsOut(await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: SETTINGS })));
    },
  );

  router.post('/read-all', async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    res.status(204).end();
  });

  router.post('/:id/read', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound();
    // userId in the filter: you can only mark your own notifications.
    const { count } = await prisma.notification.updateMany({ where: { id: id.data, userId: req.user!.id }, data: { readAt: new Date() } });
    if (!count) throw notFound();
    res.status(204).end();
  });

  return router;
}
