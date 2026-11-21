import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { aiClient } from '../../integrations/aiClient';
import { notifier } from '../../integrations/notify';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { activeFor, announcementCreateSchema, announcementUpdateSchema, createAnnouncement, listAnnouncements, updateAnnouncement, withdrawAnnouncement } from './announcements';
import { applicationsQuerySchema, closeJob, jobProblemCounts, jobsQuerySchema, listApplications, listJobs, setFeatured } from './jobsManager';
import { getSettings, settingsPatchSchema, updateSettings } from './settings';
import { forcePasswordReset, setContactVerified, userDetail } from './userDetail';

const uuid = z.string().uuid();
const idOf = (req: Request, name = 'id') => {
  const r = uuid.safeParse(req.params[name]);
  if (!r.success) throw notFound();
  return r.data;
};
const reason = z.string().trim().min(3, 'Give a short reason').max(300);

/** Admin-only tools. Mounted inside the admin router, which has already required a signed-in administrator. */
export function adminManageRouter() {
  const router = Router();

  // ── Announcements ──
  router.get('/announcements', async (_req, res) => {
    res.json({ items: await listAnnouncements() });
  });
  router.post('/announcements', validateBody(announcementCreateSchema), async (req, res) => {
    const a = await createAnnouncement(req.user!.id, req.body);
    await audit(req, req.user!.id, 'admin.announcement_created', 'Announcement', a.id, { audience: a.audience, regionId: a.regionId, notified: a.notifiedCount });
    res.status(201).json({ announcement: a });
  });
  router.patch('/announcements/:id', validateBody(announcementUpdateSchema), async (req, res) => {
    const a = await updateAnnouncement(idOf(req), req.body);
    await audit(req, req.user!.id, 'admin.announcement_updated', 'Announcement', a.id, { fields: Object.keys(req.body) });
    res.json({ announcement: a });
  });
  router.post('/announcements/:id/withdraw', async (req, res) => {
    const a = await withdrawAnnouncement(idOf(req));
    await audit(req, req.user!.id, 'admin.announcement_withdrawn', 'Announcement', a.id);
    res.json({ announcement: a });
  });

  // ── One user ──
  router.get('/users/:id', async (req, res) => {
    res.json(await userDetail(idOf(req)));
  });
  router.post('/users/:id/force-password-reset', validateBody(z.object({ reason }).strict()), async (req, res) => {
    const out = await forcePasswordReset(req.user!.id, idOf(req));
    await audit(req, req.user!.id, 'admin.user_password_reset_forced', 'User', out.id, { reason: req.body.reason, sessionsEnded: out.sessionsEnded });
    res.json(out);
  });
  router.post('/users/:id/contact-verification', validateBody(z.object({ kind: z.enum(['PHONE', 'EMAIL']), verified: z.boolean(), reason }).strict()), async (req, res) => {
    const out = await setContactVerified(req.user!.id, idOf(req), req.body.kind, req.body.verified);
    await audit(req, req.user!.id, 'admin.user_contact_verification_set', 'User', out.id, { kind: out.kind, verified: out.verified, reason: req.body.reason });
    res.json(out);
  });

  // ── Jobs and applications ──
  router.get('/jobs', async (req, res) => {
    const q = jobsQuerySchema.parse(req.query);
    res.json({ ...(await listJobs(q)), problems: await jobProblemCounts() });
  });
  router.post('/jobs/:id/close', validateBody(z.object({ reason }).strict()), async (req, res) => {
    const out = await closeJob(idOf(req));
    await audit(req, req.user!.id, 'admin.job_closed', 'Job', out.id, { reason: req.body.reason, from: out.from });
    res.json(out);
  });
  router.post('/jobs/:id/feature', validateBody(z.object({ featured: z.boolean() }).strict()), async (req, res) => {
    const out = await setFeatured(idOf(req), req.body.featured);
    await audit(req, req.user!.id, 'admin.job_featured', 'Job', out.id, { featured: out.featured });
    res.json(out);
  });
  router.get('/applications', async (req, res) => {
    res.json(await listApplications(applicationsQuerySchema.parse(req.query)));
  });

  // ── Settings and health ──
  router.get('/settings', async (_req, res) => {
    res.json({ settings: await getSettings() });
  });
  router.patch('/settings', validateBody(settingsPatchSchema), async (req, res) => {
    const before = await getSettings();
    const settings = await updateSettings(req.body, req.user!.id);
    const changed = Object.keys(req.body).filter((k) => (before as Record<string, unknown>)[k] !== (settings as Record<string, unknown>)[k]);
    await audit(req, req.user!.id, 'admin.settings_changed', 'PlatformSetting', undefined, { changed, values: Object.fromEntries(changed.map((k) => [k, (settings as Record<string, unknown>)[k]])) as Record<string, string | number | boolean> });
    res.json({ settings });
  });
  router.get('/health', async (_req, res) => {
    const t0 = Date.now();
    let db: { ok: boolean; latencyMs: number | null } = { ok: false, latencyMs: null };
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = { ok: true, latencyMs: Date.now() - t0 };
    } catch {
      /* reported as not ok below */
    }
    const ai = aiClient();
    const aiConfigured = ai.enabled();
    const aiReachable = aiConfigured ? !!(await ai.embed(['health check'], { timeoutMs: 2500 }).catch(() => null)) : null;
    const [problems, pendingVerifications, openReports] = await Promise.all([
      jobProblemCounts(),
      prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
      prisma.report.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
    ]);
    const mem = process.memoryUsage();
    res.json({
      database: db,
      aiService: { configured: aiConfigured, reachable: aiReachable },
      channels: {
        sms: notifier.smsConfigured(),
        email: notifier.emailConfigured?.() ?? false,
        telegram: !!env.TELEGRAM_BOT_TOKEN,
        antivirus: !!env.CLAMAV_HOST,
      },
      queues: { ...problems, pendingVerifications, openReports },
      runtime: { node: process.version, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(mem.rss / 1_048_576), environment: env.NODE_ENV },
    });
  });

  return router;
}

/** Notices every signed-in person (or visitor, for the site status) may read. */
export function siteRouter() {
  const router = Router();
  router.get('/announcements/active', requireAuth, async (req, res) => {
    res.json({ items: await activeFor(req.user!) });
  });
  router.get('/site/status', async (_req, res) => {
    const s = await getSettings();
    res.json({ maintenance: s.maintenanceEnabled ? { message: s.maintenanceMessage } : null, registrationOpen: s.registrationOpen });
  });
  return router;
}
