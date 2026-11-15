import { Router } from 'express';
import type { OrganizationType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { GROUP_LABEL, ORG_GROUPS, ORG_TYPE_INFO, describeRules, orgTypeInfo, typesInGroup, type OrgGroup } from './catalog';
import { listPolicies, ORGANIZATION_TYPES } from './service';

/** Public: the kinds of employer, what each should prepare, and the hiring rules that apply to it. */
export function organizationTypesRouter() {
  const router = Router();
  router.get('/organization-types', async (_req, res) => {
    const policies = new Map((await listPolicies()).map((p) => [p.organizationType, p]));
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      groups: ORG_GROUPS.map((g) => ({ group: g, label: GROUP_LABEL[g] })),
      types: ORG_TYPE_INFO.map((t) => {
        const p = policies.get(t.value);
        return { ...t, policyLabel: p?.label ?? null, rules: p ? describeRules(p) : [] };
      }),
    });
  });
  return router;
}

// ───────── administrator: organizations by type ─────────

export const orgListSchema = z
  .object({
    type: z.enum(ORGANIZATION_TYPES).optional(),
    group: z.enum(ORG_GROUPS as [OrgGroup, ...OrgGroup[]]).optional(),
    status: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(),
    q: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export async function adminOrganizations(input: z.infer<typeof orgListSchema>) {
  const where: Prisma.OrganizationWhereInput = {
    ...(input.type ? { type: input.type } : input.group ? { type: { in: typesInGroup(input.group) } } : {}),
    ...(input.status ? { verificationStatus: input.status } : {}),
    ...(input.q ? { name: { contains: input.q, mode: 'insensitive' } } : {}),
  };
  const [total, rows, byType] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      select: { id: true, name: true, type: true, verificationStatus: true, verifiedAt: true, createdAt: true, _count: { select: { employers: true, jobs: { where: { status: 'ACTIVE' } } } } },
    }),
    prisma.organization.groupBy({ by: ['type', 'verificationStatus'], _count: { _all: true } }),
  ]);
  const summary = ORG_GROUPS.map((g) => {
    const types: OrganizationType[] = typesInGroup(g);
    const inGroup = byType.filter((r) => types.includes(r.type));
    const count = (pred: (r: (typeof byType)[number]) => boolean) => inGroup.filter(pred).reduce((s, r) => s + r._count._all, 0);
    return { group: g, label: GROUP_LABEL[g], organizations: count(() => true), verified: count((r) => r.verificationStatus === 'VERIFIED'), pending: count((r) => r.verificationStatus === 'PENDING') };
  });
  return {
    total, page: input.page, pageSize: input.pageSize, summary,
    items: rows.map((r) => ({
      id: r.id, name: r.name, type: r.type, typeLabel: orgTypeInfo(r.type).label, group: orgTypeInfo(r.type).group,
      verificationStatus: r.verificationStatus, verifiedAt: r.verifiedAt, createdAt: r.createdAt, accounts: r._count.employers, liveJobs: r._count.jobs,
    })),
  };
}
