import { getPolicy } from '../hiring/service';
import { cancelPlanRequest, planRequestSchema, plansForEmployer, planStatus, requestPlan } from '../subscriptions/service';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { deleteFileAsset, saveUpload, uploadSingle } from '../files/storage';

const nullableText = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();
const ORG_TYPES = [
  'PRIVATE_COMPANY', 'PUBLIC_ENTERPRISE', 'GOVERNMENT', 'NGO', 'SME', 'CONSTRUCTION', 'FACTORY', 'HOTEL_RESTAURANT',
  'AGRICULTURAL', 'HOUSEHOLD', 'INDIVIDUAL', 'RECRUITMENT_AGENCY', 'TRAINING_INSTITUTION', 'COOPERATIVE',
] as const;

const orgUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    type: z.enum(ORG_TYPES),
    description: nullableText(2000),
    website: z
      .string()
      .trim()
      .max(300)
      .refine((u) => u === '' || (/^https?:\/\//i.test(u) && URL.canParse(u)), 'Website must start with http:// or https://')
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    address: nullableText(250),
    locationId: z.string().uuid().nullable(),
    roleInOrg: nullableText(80),
  })
  .partial()
  .strict();

async function loadOrg(userId: string) {
  const ep = await prisma.employerProfile.findUnique({
    where: { userId },
    include: {
      organization: {
        include: { location: { include: { parent: { include: { parent: true } } } } },
      },
    },
  });
  if (!ep) throw notFound('Employer profile not found');
  const latest = await prisma.verificationRequest.findFirst({
    where: { userId, kind: 'EMPLOYER' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, note: true, createdAt: true, reviewedAt: true },
  });
  const o = ep.organization;
  const path: { id: string; level: string; name: string }[] = [];
  for (let cur: any = o.location; cur; cur = cur.parent) path.unshift({ id: cur.id, level: cur.level, name: cur.nameEn });
  return {
    roleInOrg: ep.roleInOrg,
    organization: {
      id: o.id, name: o.name, type: o.type, description: o.description, website: o.website, address: o.address,
      verificationStatus: o.verificationStatus, verifiedAt: o.verifiedAt, locationPath: path,
    },
    latestVerificationRequest: latest,
  };
}

export function employersRouter() {
  const router = Router();
  const mine = [requireAuth, requireRole('EMPLOYER')];

  router.get('/me', ...mine, async (req, res) => {
    res.json(await loadOrg(req.user!.id));
  });

  // The plan this organization is on, its limits, and how much has been used.
  router.get('/me/subscription', ...mine, async (req, res) => {
    const ep = await prisma.employerProfile.findUnique({ where: { userId: req.user!.id }, select: { organizationId: true } });
    if (!ep) throw notFound('Organization not found');
    res.json(await planStatus(ep.organizationId));
  });

  // Ask for another plan. An administrator decides; nothing is charged by the system.
  router.get('/me/plans', ...mine, async (req, res) => {
    const ep = await prisma.employerProfile.findUnique({ where: { userId: req.user!.id }, select: { organizationId: true } });
    if (!ep) throw notFound('Organization not found');
    res.json(await plansForEmployer(ep.organizationId));
  });
  router.post('/me/plan-requests', ...mine, validateBody(planRequestSchema), async (req, res) => {
    const ep = await prisma.employerProfile.findUnique({ where: { userId: req.user!.id }, select: { organizationId: true } });
    if (!ep) throw notFound('Organization not found');
    const created = await requestPlan(req.user!.id, ep.organizationId, req.body);
    await audit(req, req.user!.id, 'employer.plan_requested', 'Organization', ep.organizationId, { plan: created.plan.name });
    res.status(201).json({ request: created });
  });
  router.delete('/me/plan-requests/:id', ...mine, async (req, res) => {
    const ep = await prisma.employerProfile.findUnique({ where: { userId: req.user!.id }, select: { organizationId: true } });
    if (!ep) throw notFound('Organization not found');
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound('No waiting request found');
    await cancelPlanRequest(ep.organizationId, id.data);
    res.status(204).end();
  });

  // The hiring rules that apply to this organization because of its type (see docs/12-hiring-rules.md).
  router.get('/me/hiring-rules', ...mine, async (req, res) => {
    const ep = await prisma.employerProfile.findUnique({ where: { userId: req.user!.id }, select: { organization: { select: { type: true, verificationStatus: true } } } });
    if (!ep) throw notFound('Organization not found');
    res.json({ organizationType: ep.organization.type, verificationStatus: ep.organization.verificationStatus, rules: await getPolicy(ep.organization.type) });
  });

  router.patch('/me', ...mine, validateBody(orgUpdateSchema), async (req, res) => {
    const { roleInOrg, ...orgData } = req.body;
    if (orgData.locationId) {
      const loc = await prisma.location.findUnique({ where: { id: orgData.locationId }, select: { id: true } });
      if (!loc) throw badRequest('Unknown location', { locationId: ['Choose a valid location'] });
    }
    const ep = await prisma.employerProfile.findUniqueOrThrow({ where: { userId: req.user!.id }, include: { organization: { select: { type: true, verificationStatus: true } } } });
    // The organization type decides which hiring rules apply, so it cannot be switched to escape them: it is fixed once
    // the organization is verified (or waiting for verification) or has published a job. An administrator can change it.
    if (orgData.type && orgData.type !== ep.organization.type) {
      const published = await prisma.job.count({ where: { organizationId: ep.organizationId, status: { notIn: ['DRAFT', 'REMOVED'] } } });
      if (ep.organization.verificationStatus !== 'UNVERIFIED' || published > 0) {
        throw conflict('Your organization type is fixed once you are verified, waiting for verification, or have published a job. Contact an administrator to change it.');
      }
    }
    if (Object.keys(orgData).length) await prisma.organization.update({ where: { id: ep.organizationId }, data: orgData });
    if (roleInOrg !== undefined) await prisma.employerProfile.update({ where: { id: ep.id }, data: { roleInOrg } });
    res.json(await loadOrg(req.user!.id));
  });

  // Ask for the "verified employer" badge. It is only granted when an admin approves evidence (Phase 12).
  router.post('/me/verification', ...mine, uploadSingle, async (req, res) => {
    const ep = await prisma.employerProfile.findUniqueOrThrow({
      where: { userId: req.user!.id },
      include: { organization: true },
    });
    if (ep.organization.verificationStatus === 'VERIFIED') throw conflict('Your organization is already verified');
    if (ep.organization.verificationStatus === 'PENDING') throw conflict('A verification request is already under review');

    const asset = await saveUpload(req.user!.id, 'VERIFICATION_EVIDENCE', req.file);
    await prisma.$transaction([
      prisma.verificationRequest.create({ data: { userId: req.user!.id, kind: 'EMPLOYER', evidenceFileId: asset.id } }),
      prisma.organization.update({ where: { id: ep.organizationId }, data: { verificationStatus: 'PENDING' } }),
    ]);
    await audit(req, req.user!.id, 'employer.verification_requested', 'Organization', ep.organizationId);
    res.status(201).json(await loadOrg(req.user!.id));
  });

  // Withdraw: removes the evidence and returns to UNVERIFIED.
  router.delete('/me/verification', ...mine, async (req, res) => {
    const ep = await prisma.employerProfile.findUniqueOrThrow({ where: { userId: req.user!.id } });
    const pending = await prisma.verificationRequest.findMany({ where: { userId: req.user!.id, kind: 'EMPLOYER', status: 'PENDING' } });
    for (const r of pending) {
      await prisma.verificationRequest.delete({ where: { id: r.id } });
      await deleteFileAsset(r.evidenceFileId);
    }
    await prisma.organization.updateMany({ where: { id: ep.organizationId, verificationStatus: 'PENDING' }, data: { verificationStatus: 'UNVERIFIED' } });
    res.json(await loadOrg(req.user!.id));
  });

  return router;
}
