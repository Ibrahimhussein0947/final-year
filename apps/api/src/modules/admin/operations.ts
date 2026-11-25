import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { validateBody } from '../../middleware/common';
import { anonymiseAccount, exportMyData } from '../auth/account';
import { confirmAdminPassword } from './service';

const uuid = z.string().uuid();
const idOf = (req: Request) => {
  const r = uuid.safeParse(req.params.id);
  if (!r.success) throw notFound();
  return r.data;
};

// ───────── Support inbox ─────────

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200),
  message: z.string().trim().min(10).max(2000),
}).strict();

/** Public: the contact form. Rate limited, and the text is only ever shown to administrators as plain text. */
export function contactRouter(max = 5) {
  const router = Router();
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many messages. Try again later.' } } });
  router.post('/contact', limiter, validateBody(contactSchema), async (req, res) => {
    await prisma.supportMessage.create({ data: req.body });
    res.status(201).json({ received: true });
  });
  return router;
}

const listSchema = z.object({ status: z.enum(['OPEN', 'RESOLVED']).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });

// ───────── Backups ─────────

/** Read-only: lists the backups the backup script left in BACKUP_DIR. Taking a backup stays a server-side job (infra/backup/backup.sh). */
export function backupStatus(dir = process.env.BACKUP_DIR ?? path.resolve(process.cwd(), '..', '..', 'infra', 'backups')) {
  if (!existsSync(dir)) return { configured: false, directory: dir, backups: [] as BackupInfo[] };
  const backups = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d): BackupInfo => {
      const full = path.join(dir, d.name);
      const files = readdirSync(full);
      const size = files.reduce((n, f) => n + statSync(path.join(full, f)).size, 0);
      return {
        name: d.name,
        createdAt: statSync(full).mtime.toISOString(),
        sizeBytes: size,
        hasDatabaseDump: files.includes('db.dump'),
        hasUploads: files.includes('uploads.tar.gz'),
        hasChecksums: files.includes('SHA256SUMS'),
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, 30);
  return { configured: true, directory: dir, backups };
}
interface BackupInfo { name: string; createdAt: string; sizeBytes: number; hasDatabaseDump: boolean; hasUploads: boolean; hasChecksums: boolean }

// ───────── Admin routes ─────────

export function adminOperationsRouter() {
  const router = Router();

  router.get('/support', async (req, res) => {
    const q = listSchema.parse(req.query);
    const where = q.status ? { status: q.status } : {};
    const [total, open, items] = await Promise.all([
      prisma.supportMessage.count({ where }),
      prisma.supportMessage.count({ where: { status: 'OPEN' } }),
      prisma.supportMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    res.json({ total, open, page: q.page, pageSize: q.pageSize, items });
  });
  router.patch('/support/:id', validateBody(z.object({ status: z.enum(['OPEN', 'RESOLVED']), adminNote: z.string().trim().max(500).optional() }).strict()), async (req, res) => {
    const id = idOf(req);
    const found = await prisma.supportMessage.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw notFound('Message not found');
    const resolved = req.body.status === 'RESOLVED';
    const item = await prisma.supportMessage.update({
      where: { id },
      data: { status: req.body.status, adminNote: req.body.adminNote ?? undefined, resolvedById: resolved ? req.user!.id : null, resolvedAt: resolved ? new Date() : null },
    });
    await audit(req, req.user!.id, `admin.support_${resolved ? 'resolved' : 'reopened'}`, 'SupportMessage', id);
    res.json({ item });
  });

  router.get('/deliveries', async (req, res) => {
    const q = z.object({ status: z.enum(['SENT', 'FAILED', 'NOT_SENT']).optional(), channel: z.enum(['SMS', 'EMAIL']).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.channel ? { channel: q.channel } : {}) };
    const [total, items, grouped] = await Promise.all([
      prisma.deliveryLog.count({ where }),
      prisma.deliveryLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.deliveryLog.groupBy({ by: ['status'], where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: { _all: true } }),
    ]);
    res.json({ total, page: q.page, pageSize: q.pageSize, items, last7Days: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) });
  });

  router.get('/backups', (_req, res) => {
    res.json(backupStatus());
  });

  // Privacy: a person's data on request. Under /export so that moderators (who may not read exports) are refused.
  router.get('/export/user/:id', async (req, res) => {
    const id = idOf(req);
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true, status: true, fullName: true } });
    if (!target) throw notFound('User not found');
    if (target.status === 'DELETED') throw conflict('This account was deleted');
    const data = await exportMyData(id, req, req.user!.id);
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="user-data-${id.slice(0, 8)}.json"`, 'Cache-Control': 'no-store' }).send(JSON.stringify(data, null, 2));
  });

  router.post('/users/:id/delete', validateBody(z.object({ reason: z.string().trim().min(3).max(300), actorPassword: z.string().min(1).max(200) }).strict()), async (req, res) => {
    const id = idOf(req);
    if (id === req.user!.id) throw forbidden('You cannot delete your own account here');
    await confirmAdminPassword(req.user!.id, req.body.actorPassword);
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true, status: true } });
    if (!target) throw notFound('User not found');
    if (target.role === 'ADMIN') throw forbidden('Administrator accounts cannot be deleted here');
    if (target.status === 'DELETED') throw conflict('This account is already deleted');
    await anonymiseAccount(id);
    await audit(req, req.user!.id, 'admin.user_deleted', 'User', id, { reason: req.body.reason });
    res.json({ deleted: true });
  });

  return router;
}
