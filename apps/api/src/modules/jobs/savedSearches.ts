import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { notify } from '../notifications/service';
import { listQuerySchema } from './schema';
import { searchJobs } from './service';

export const MAX_SAVED_SEARCHES = 10;
const ALERTS_PER_DAY = 5;
const MAX_SEARCHES_CHECKED = 5000;

// A saved search is the job-search filters without paging or sorting.
const filtersSchema = listQuerySchema.omit({ page: true, pageSize: true, sort: true });

/** Validate filters from the client and keep only the ones that were actually set, in the same shape the search URL uses. */
function cleanFilters(input: unknown): Record<string, string | number> {
  const parsed = filtersSchema.parse(input ?? {});
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = Array.isArray(v) ? v.join(',') : (v as string | number);
  }
  return out;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  filters: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  alertsEnabled: z.boolean().default(true),
});
const updateSchema = z.object({ name: z.string().trim().min(1).max(60).optional(), alertsEnabled: z.boolean().optional() }).strict();

const out = (s: { id: string; name: string; filters: Prisma.JsonValue; alertsEnabled: boolean; lastAlertedAt: Date | null; createdAt: Date }) => ({
  id: s.id, name: s.name, filters: s.filters as Record<string, string | number>, alertsEnabled: s.alertsEnabled, lastAlertedAt: s.lastAlertedAt, createdAt: s.createdAt,
});

export function savedSearchesRouter() {
  const router = Router();
  router.use(requireAuth, requireRole('WORKER'));

  router.get('/', async (req, res) => {
    const rows = await prisma.savedSearch.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
    res.json({ items: rows.map(out), max: MAX_SAVED_SEARCHES });
  });

  router.post('/', validateBody(createSchema), async (req, res) => {
    const userId = req.user!.id;
    let filters: Record<string, string | number>;
    try {
      filters = cleanFilters(req.body.filters);
    } catch {
      throw badRequest('Some of the search filters are not valid');
    }
    if (Object.keys(filters).length === 0) throw badRequest('Choose at least one filter or search word before saving');
    if ((await prisma.savedSearch.count({ where: { userId } })) >= MAX_SAVED_SEARCHES) {
      throw conflict(`You can keep up to ${MAX_SAVED_SEARCHES} saved searches. Delete one first.`);
    }
    const row = await prisma.savedSearch.create({ data: { userId, name: req.body.name, filters, alertsEnabled: req.body.alertsEnabled } });
    res.status(201).json({ item: out(row) });
  });

  router.patch('/:id', validateBody(updateSchema), async (req, res) => {
    const found = await prisma.savedSearch.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
    if (!found) throw notFound('Saved search not found');
    res.json({ item: out(await prisma.savedSearch.update({ where: { id: found.id }, data: req.body })) });
  });

  router.delete('/:id', async (req, res) => {
    const r = await prisma.savedSearch.deleteMany({ where: { id: String(req.params.id), userId: req.user!.id } });
    if (r.count === 0) throw notFound('Saved search not found');
    res.status(204).end();
  });

  return router;
}

/**
 * When a job goes live, tell every worker who has a saved search (with alerts on) that it matches.
 * Each search is run against only this job, using the same filters as the public search, so an alert can never
 * disagree with what the worker would see on the jobs page. One alert per worker per job however many of their
 * searches match, at most five a day, and nothing for workers who switched job alerts off.
 */
export async function notifySavedSearchMatches(jobId: string): Promise<{ checked: number; alerts: number }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, status: 'ACTIVE' }, select: { id: true, title: true, organization: { select: { name: true } } } });
  if (!job) return { checked: 0, alerts: 0 };

  const searches = await prisma.savedSearch.findMany({
    where: { alertsEnabled: true, user: { status: 'ACTIVE', role: 'WORKER', notifyJobMatches: true } },
    orderBy: { createdAt: 'asc' },
    take: MAX_SEARCHES_CHECKED,
  });
  const since = new Date(Date.now() - 86_400_000);
  const told = new Set<string>();
  let alerts = 0;
  for (const s of searches) {
    if (told.has(s.userId)) continue;
    try {
      const q = listQuerySchema.parse({ ...(s.filters as object), page: 1, pageSize: 1 });
      const { total } = await searchJobs(q, { id: jobId });
      if (total === 0) continue;
    } catch (err) {
      logger.warn({ err: String(err), searchId: s.id }, 'saved search skipped');
      continue;
    }
    told.add(s.userId);
    const recent = await prisma.notification.count({ where: { userId: s.userId, type: 'search.match', createdAt: { gte: since } } });
    if (recent >= ALERTS_PER_DAY) continue;
    await notify(s.userId, 'search.match', { jobId: job.id, jobTitle: job.title, organizationName: job.organization.name, searchName: s.name });
    await prisma.savedSearch.update({ where: { id: s.id }, data: { lastAlertedAt: new Date() } });
    alerts++;
  }
  return { checked: searches.length, alerts };
}
