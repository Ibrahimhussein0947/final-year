import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { PHONE_REGEX, normalizePhone, stripPhoneFormatting } from '../../lib/security';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { aiClient } from '../../integrations/aiClient';
import { notifier } from '../../integrations/notify';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { aiPerformance, nationalAnalytics, K_MIN } from '../analytics/service';
import { searchFairness } from '../analytics/fairness';
import { hiringPerformance } from '../analytics/performance';
import * as svc from './service';
import { adminListPlans, adminPlanRequests, adminSubscriptions, approvePlanRequest, assignPlan, declinePlanRequest, planDecisionSchema, assignSchema, cancelSubscription, createPlan, planCreateSchema, planUpdateSchema, updatePlan } from '../subscriptions/service';
import { listPolicies, ORGANIZATION_TYPES, policyUpdateSchema, updatePolicy } from '../hiring/service';
import { adminOrganizations, orgListSchema } from '../hiring/directory';
import { adminListDefinitions, createDefinition, createDefinitionSchema, updateDefinition, updateDefinitionSchema } from '../criteria/admin';
import { clearTranslationCache } from '../trust/routes';
import { adminManageRouter } from './manage';
import { adminInsightsRouter, exportRows } from './insights';

const uuid = z.string().uuid();
const idOf = (req: Request, name = 'id') => {
  const r = uuid.safeParse(req.params[name]);
  if (!r.success) throw notFound();
  return r.data;
};
const page = { page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Invalid request', r.error.flatten().fieldErrors);
  return r.data;
};
const note = z.string().trim().max(500).transform((v) => v || null).nullable().optional();

/** Spreadsheet programs run cells starting with = + - @ as formulas, so such text is defused. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/**
 * Administrator levels. FULL may do everything. AUDITOR may only read. MODERATOR may read and act on reports,
 * job reviews and verifications, but cannot read the data exports or the administrator list.
 */
const MODERATOR_WRITE = ['/moderation', '/verifications', '/jobs'];
const MODERATOR_NO_READ = ['/export', '/admins'];
async function enforceAdminLevel(req: Request, _res: unknown, next: () => void) {
  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { adminLevel: true } });
  const level = u?.adminLevel ?? 'FULL';
  const read = req.method === 'GET' || req.method === 'HEAD';
  const under = (prefixes: string[]) => prefixes.some((p) => req.path === p || req.path.startsWith(`${p}/`));
  if (level === 'AUDITOR' && !read) throw forbidden('Your administrator level is read only');
  if (level === 'MODERATOR' && (read ? under(MODERATOR_NO_READ) : !under(MODERATOR_WRITE))) throw forbidden('Your administrator level does not include this');
  next();
}

export function adminRouter() {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'), enforceAdminLevel);
  router.use(adminManageRouter());
  router.use(adminInsightsRouter());

  router.get('/stats', async (_req, res) => {
    res.json({ stats: await svc.platformStats() });
  });

  // System health and activity
  router.get('/system', async (_req, res) => {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const [lastAudit, users24h, jobs24h] = await Promise.all([
      prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.auditLog.count({ where: { action: 'auth.login', createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
      prisma.job.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    res.json({
      database: { ok: true, latencyMs: Date.now() - t0 },
      aiService: { configured: aiClient().enabled() },
      sms: { gatewayConfigured: notifier.smsConfigured() },
      activity24h: { logins: users24h, jobsCreated: jobs24h, lastAuditEvent: lastAudit?.createdAt ?? null },
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Users
  router.get('/users', async (req, res) => {
    const q = parse(z.object({ q: z.string().trim().max(80).optional(), role: z.enum(['WORKER', 'EMPLOYER', 'ADMIN', 'TRAINER']).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(), ...page }), req.query);
    res.json(await svc.listUsers(q));
  });
  router.patch('/users/:id/status', validateBody(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(3).max(300).optional() }).strict()), async (req, res) => {
    if (req.body.status === 'SUSPENDED' && !req.body.reason) throw badRequest('Give a reason for the suspension', { reason: ['Required'] });
    const result = await svc.setUserStatus(req.user!.id, idOf(req), req.body.status);
    if (result.changed) await audit(req, req.user!.id, `admin.user_${req.body.status === 'SUSPENDED' ? 'suspended' : 'reactivated'}`, 'User', result.id, { reason: req.body.reason ?? null });
    res.json(result);
  });

  // Administrator team: only administrators reach this router. Creating or suspending one needs the acting admin's password again.
  const adminPassword = z.string().min(1).max(200);
  router.get('/admins', async (_req, res) => {
    res.json({ items: await svc.listAdmins() });
  });
  router.patch('/admins/:id/level', validateBody(z.object({ level: z.enum(['FULL', 'MODERATOR', 'AUDITOR']), actorPassword: adminPassword }).strict()), async (req, res) => {
    const out = await svc.setAdminLevel(req.user!.id, idOf(req), req.body.level, req.body.actorPassword);
    await audit(req, req.user!.id, 'admin.admin_level_changed', 'User', out.id, { level: out.level });
    res.json(out);
  });
  router.post(
    '/admins',
    validateBody(z.object({
      fullName: z.string().trim().min(2).max(100),
      phone: z.string().trim().transform(stripPhoneFormatting).pipe(z.string().regex(PHONE_REGEX, 'Enter a valid Ethiopian phone number')).transform(normalizePhone),
      password: z.string().min(10, 'Use at least 10 characters').max(72).regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'),
      actorPassword: adminPassword,
      level: z.enum(['FULL', 'MODERATOR', 'AUDITOR']).default('FULL'),
    }).strict()),
    async (req, res) => {
      const created = await svc.createAdmin(req.user!.id, req.body);
      await audit(req, req.user!.id, 'admin.admin_created', 'User', created.id);
      res.status(201).json({ admin: created });
    },
  );
  router.patch(
    '/admins/:id/status',
    validateBody(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), actorPassword: adminPassword }).strict()),
    async (req, res) => {
      const result = await svc.setAdminStatus(req.user!.id, idOf(req), req.body.status, req.body.actorPassword);
      if (result.changed) await audit(req, req.user!.id, `admin.admin_${req.body.status === 'SUSPENDED' ? 'suspended' : 'reactivated'}`, 'User', result.id);
      res.json(result);
    },
  );

  // Subscriptions: plans with limits, assigned to organizations by administrators (no payment processing).
  router.get('/plans', async (_req, res) => {
    res.json({ items: await adminListPlans() });
  });
  router.post('/plans', validateBody(planCreateSchema), async (req, res) => {
    const plan = await createPlan(req.body);
    await audit(req, req.user!.id, 'admin.plan_created', 'SubscriptionPlan', plan.id, { name: plan.name });
    res.status(201).json({ plan });
  });
  router.patch('/plans/:id', validateBody(planUpdateSchema), async (req, res) => {
    const plan = await updatePlan(idOf(req), req.body);
    await audit(req, req.user!.id, 'admin.plan_updated', 'SubscriptionPlan', plan.id, { fields: Object.keys(req.body) });
    res.json({ plan });
  });
  router.get('/plan-requests', async (req, res) => {
    const status = parse(z.enum(['PENDING', 'APPROVED', 'DECLINED', 'CANCELLED']).default('PENDING'), req.query.status);
    res.json(await adminPlanRequests(status));
  });
  router.post('/plan-requests/:id/approve', validateBody(planDecisionSchema), async (req, res) => {
    const out = await approvePlanRequest(req.user!.id, idOf(req), req.body);
    await audit(req, req.user!.id, 'admin.plan_request_approved', 'Organization', out.organizationId, { plan: out.planName });
    res.json({ ok: true });
  });
  router.post('/plan-requests/:id/decline', validateBody(planDecisionSchema), async (req, res) => {
    const out = await declinePlanRequest(req.user!.id, idOf(req), req.body);
    await audit(req, req.user!.id, 'admin.plan_request_declined', 'Organization', out.organizationId, { plan: out.planName });
    res.json({ ok: true });
  });
  router.get('/subscriptions', async (req, res) => {
    const q = parse(z.object({ q: z.string().trim().max(80).optional(), ...page }), req.query);
    res.json(await adminSubscriptions(q));
  });
  router.post('/organizations/:id/subscription', validateBody(assignSchema), async (req, res) => {
    const out = await assignPlan(req.user!.id, idOf(req), req.body);
    await audit(req, req.user!.id, 'admin.subscription_assigned', 'Organization', idOf(req), { plan: out.planName, endsAt: req.body.endsAt ?? null });
    res.status(201).json(out);
  });
  router.delete('/organizations/:id/subscription', async (req, res) => {
    const out = await cancelSubscription(idOf(req));
    if (out.cancelled) await audit(req, req.user!.id, 'admin.subscription_cancelled', 'Organization', idOf(req));
    res.json(out);
  });

  // Verification requests
  router.get('/verifications', async (req, res) => {
    const q = parse(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'), kind: z.enum(['EMPLOYER', 'QUALIFICATION', 'SKILL', 'IDENTITY']).optional() }), req.query);
    res.json({ items: await svc.listVerifications(q) });
  });
  router.post('/verifications/:id/review', validateBody(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note }).strict()), async (req, res) => {
    const r = await svc.reviewVerification(req.user!.id, idOf(req), req.body.decision, req.body.note ?? null);
    await audit(req, req.user!.id, `admin.verification_${req.body.decision.toLowerCase()}`, 'VerificationRequest', r.id, { note: req.body.note ?? null });
    res.json(r);
  });

  // Moderation
  router.get('/moderation/reports', async (req, res) => {
    const q = parse(z.object({ status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']).optional() }), req.query);
    res.json({ items: await svc.listReports(q.status) });
  });
  router.post('/moderation/reports/:id/resolve', validateBody(z.object({ action: z.enum(['DISMISS', 'NO_ACTION', 'REMOVE_JOB', 'REMOVE_SERVICE', 'SUSPEND_USER']), note }).strict()), async (req, res) => {
    const r = await svc.resolveReport(req.user!.id, idOf(req), req.body.action, req.body.note ?? null);
    await audit(req, req.user!.id, `admin.report_${req.body.action.toLowerCase()}`, 'Report', r.id, { note: req.body.note ?? null });
    res.json(r);
  });
  router.get('/moderation/jobs', async (_req, res) => {
    res.json({ items: await svc.listPendingJobs() });
  });
  router.post('/moderation/jobs/:id/review', validateBody(z.object({ decision: z.enum(['APPROVE', 'REJECT']), note }).strict()), async (req, res) => {
    const r = await svc.reviewJob(req.user!.id, idOf(req), req.body.decision, req.body.note ?? null);
    await audit(req, req.user!.id, `admin.job_${req.body.decision.toLowerCase()}`, 'Job', r.id, { note: req.body.note ?? null });
    res.json(r);
  });
  router.post('/moderation/jobs/:id/remove', validateBody(z.object({ note: z.string().trim().min(3).max(500) }).strict()), async (req, res) => {
    await svc.removeJob(req.user!.id, idOf(req), req.body.note);
    await audit(req, req.user!.id, 'admin.job_removed', 'Job', idOf(req), { note: req.body.note });
    res.status(204).end();
  });

  // Organizations by type and verification status (Phase 17)
  router.get('/organizations', async (req, res) => {
    res.json(await adminOrganizations(parse(orgListSchema, req.query)));
  });

  // An administrator can correct an organization's type (employers cannot change it once verified or after publishing).
  router.patch('/organizations/:id/type', validateBody(z.object({ type: z.enum(ORGANIZATION_TYPES) }).strict()), async (req, res) => {
    const id = idOf(req);
    const org = await prisma.organization.findUnique({ where: { id }, select: { type: true } });
    if (!org) throw notFound('Organization not found');
    await prisma.organization.update({ where: { id }, data: { type: req.body.type } });
    await audit(req, req.user!.id, 'admin.organization_type_changed', 'Organization', id, { from: org.type, to: req.body.type });
    res.status(204).end();
  });

  // Hiring rules by organization type (Phase 17)
  router.get('/hiring-policies', async (_req, res) => {
    res.json({ items: await listPolicies() });
  });
  router.patch('/hiring-policies/:type', validateBody(policyUpdateSchema), async (req, res) => {
    const type = String(req.params.type);
    await updatePolicy(type, req.body, req.user!.id);
    await audit(req, req.user!.id, 'admin.hiring_policy_updated', 'HiringPolicy', type, req.body);
    res.status(204).end();
  });

  // Sector criteria (Phase 15): what job forms, worker profiles and matching ask for, per sector
  router.get('/criteria', async (_req, res) => {
    res.json({ items: await adminListDefinitions() });
  });
  router.post('/criteria', validateBody(createDefinitionSchema), async (req, res) => {
    const id = await createDefinition(req.body);
    await audit(req, req.user!.id, 'admin.criterion_created', 'CriterionDefinition', id, { key: req.body.key, categoryId: req.body.categoryId });
    res.status(201).json({ id });
  });
  router.patch('/criteria/:id', validateBody(updateDefinitionSchema), async (req, res) => {
    await updateDefinition(idOf(req), req.body);
    await audit(req, req.user!.id, 'admin.criterion_updated', 'CriterionDefinition', idOf(req), Object.keys(req.body));
    res.status(204).end();
  });

  // Categories and skills
  const names = { nameAm: z.string().trim().max(120).transform((v) => v || null).nullable().optional(), nameOm: z.string().trim().max(120).transform((v) => v || null).nullable().optional() };
  const aliases = z.array(z.string().trim().toLowerCase().min(2).max(40)).max(12).transform((a) => [...new Set(a)]);
  router.get('/categories', async (_req, res) => {
    res.json({ items: await svc.listCategories() });
  });
  router.post('/categories', validateBody(z.object({ nameEn: z.string().trim().min(2).max(120), ...names }).strict()), async (req, res) => {
    const c = await svc.createCategory(req.body);
    await audit(req, req.user!.id, 'admin.category_created', 'Category', c.id);
    res.status(201).json({ id: c.id, slug: c.slug });
  });
  router.patch('/categories/:id', validateBody(z.object({ nameEn: z.string().trim().min(2).max(120).optional(), isActive: z.boolean().optional(), ...names }).strict()), async (req, res) => {
    await svc.updateCategory(idOf(req), req.body);
    await audit(req, req.user!.id, 'admin.category_updated', 'Category', idOf(req), req.body);
    res.status(204).end();
  });
  router.get('/skills', async (req, res) => {
    const q = parse(z.object({ q: z.string().trim().max(60).optional(), categoryId: z.string().uuid().optional(), includeInactive: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'), ...page }), req.query);
    res.json(await svc.listSkills(q));
  });
  router.post('/skills', validateBody(z.object({ nameEn: z.string().trim().min(2).max(120), categoryId: z.string().uuid(), aliases: aliases.default([]), ...names }).strict()), async (req, res) => {
    const s = await svc.createSkill(req.body);
    await audit(req, req.user!.id, 'admin.skill_created', 'Skill', s.id);
    res.status(201).json({ id: s.id, slug: s.slug });
  });
  router.patch('/skills/:id', validateBody(z.object({ nameEn: z.string().trim().min(2).max(120).optional(), categoryId: z.string().uuid().optional(), aliases: aliases.optional(), isActive: z.boolean().optional(), ...names }).strict()), async (req, res) => {
    await svc.updateSkill(idOf(req), req.body);
    await audit(req, req.user!.id, 'admin.skill_updated', 'Skill', idOf(req), req.body);
    res.status(204).end();
  });

  // Translations
  const tKey = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i, 'Use letters, digits, dots, dashes and underscores');
  router.get('/translations', async (req, res) => {
    const q = parse(z.object({ locale: z.enum(['en', 'am', 'om']).optional() }), req.query);
    res.json({ items: await svc.listTranslations(q.locale) });
  });
  router.put('/translations', validateBody(z.object({ key: tKey, locale: z.enum(['en', 'am', 'om']), value: z.string().trim().min(1).max(500) }).strict()), async (req, res) => {
    const t = await svc.putTranslation(req.user!.id, req.body.key, req.body.locale, req.body.value);
    clearTranslationCache();
    await audit(req, req.user!.id, 'admin.translation_set', 'Translation', `${t.locale}:${t.key}`);
    res.json({ key: t.key, locale: t.locale, value: t.value });
  });
  router.delete('/translations/:locale/:key', async (req, res) => {
    const locale = parse(z.enum(['en', 'am', 'om']), req.params.locale);
    const key = parse(tKey, req.params.key);
    await svc.deleteTranslation(key, locale);
    clearTranslationCache();
    await audit(req, req.user!.id, 'admin.translation_removed', 'Translation', `${locale}:${key}`);
    res.status(204).end();
  });

  // Audit log
  router.get('/audit', async (req, res) => {
    const q = parse(z.object({ action: z.string().trim().max(60).optional(), actorId: z.string().uuid().optional(), entityType: z.string().trim().max(40).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), ...page }), req.query);
    res.json(await svc.listAudit(q));
  });

  // Places: HDX data gives regions, zones and woredas in English only; kebeles and the Amharic / Afaan Oromoo labels are added here.
  const placeName = z.string().trim().min(1).max(120);
  const optionalName = z.string().trim().max(120).transform((v) => v || null).nullable().optional();
  const CHILD_LEVEL = { REGION: 'ZONE', ZONE: 'WOREDA', WOREDA: 'KEBELE' } as const;
  router.post('/locations', async (req, res) => {
    const body = parse(z.object({ parentId: uuid, nameEn: placeName, nameAm: optionalName, nameOm: optionalName }), req.body);
    const parent = await prisma.location.findUnique({ where: { id: body.parentId }, select: { id: true, level: true } });
    if (!parent) throw badRequest('Unknown parent place', { parentId: ['Choose a valid parent'] });
    if (parent.level === 'KEBELE') throw badRequest('A kebele cannot contain other places', { parentId: ['Kebele is the smallest level'] });
    const exists = await prisma.location.findUnique({ where: { parentId_nameEn: { parentId: parent.id, nameEn: body.nameEn } }, select: { id: true } });
    if (exists) throw conflict('That place already exists here');
    const created = await prisma.location.create({
      data: { level: CHILD_LEVEL[parent.level], parentId: parent.id, nameEn: body.nameEn, nameAm: body.nameAm ?? null, nameOm: body.nameOm ?? null },
      select: { id: true, level: true, nameEn: true, nameAm: true, nameOm: true, parentId: true },
    });
    await audit(req, req.user!.id, 'admin.location_added', 'Location', created.id, { level: created.level, name: created.nameEn });
    res.status(201).json({ location: created });
  });
  router.patch('/locations/:id', async (req, res) => {
    const id = idOf(req);
    const body = parse(z.object({ nameEn: placeName.optional(), nameAm: optionalName, nameOm: optionalName }).refine((b) => Object.keys(b).length > 0, 'Nothing to change'), req.body);
    const current = await prisma.location.findUnique({ where: { id }, select: { parentId: true } });
    if (!current) throw notFound();
    if (body.nameEn && current.parentId) {
      const clash = await prisma.location.findFirst({ where: { parentId: current.parentId, nameEn: body.nameEn, NOT: { id } }, select: { id: true } });
      if (clash) throw conflict('Another place here already has that name');
    }
    const updated = await prisma.location.update({ where: { id }, data: body, select: { id: true, level: true, nameEn: true, nameAm: true, nameOm: true, parentId: true } });
    await audit(req, req.user!.id, 'admin.location_updated', 'Location', id, { fields: Object.keys(body) });
    res.json({ location: updated });
  });

  // Analytics and reports
  router.get('/analytics/national', async (_req, res) => {
    res.json(await nationalAnalytics());
  });
  router.get('/analytics/performance', async (req, res) => {
    const days = parse(z.coerce.number().pipe(z.union([z.literal(30), z.literal(90), z.literal(365)])).default(90), req.query.days);
    res.json(await hiringPerformance(days));
  });
  router.get('/analytics/search-fairness', async (_req, res) => {
    res.json(await searchFairness());
  });
  router.get('/analytics/recommendations', async (_req, res) => {
    res.json(await aiPerformance());
  });

  router.get('/export/:kind', async (req, res) => {
    const kind = parse(z.enum(['platform-summary', 'jobs-by-region', 'applications-by-status', 'users', 'jobs', 'organizations']), req.params.kind);
    let rows: unknown[][];
    if (kind === 'platform-summary') {
      const s = await svc.platformStats();
      rows = [['metric', 'value'], ...Object.entries(s)];
    } else if (kind === 'jobs-by-region') {
      const n = await nationalAnalytics();
      rows = [['region', 'open_jobs', 'vacancies', 'visible_workers', `note: values below ${K_MIN} are hidden`], ...n.regions.map((r) => [r.region, r.openJobs ?? `<${K_MIN}`, r.vacancies ?? `<${K_MIN}`, r.visibleWorkers ?? `<${K_MIN}`, ''])];
    } else if (kind === 'users' || kind === 'jobs' || kind === 'organizations') {
      rows = await exportRows(kind);
    } else {
      const g = await prisma.application.groupBy({ by: ['status'], _count: true });
      rows = [['status', 'applications'], ...g.map((x) => [x.status, x._count])];
    }
    await audit(req, req.user!.id, 'admin.export', 'Report', kind);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' }).send(`﻿${csv(rows)}`);
  });

  return router;
}
