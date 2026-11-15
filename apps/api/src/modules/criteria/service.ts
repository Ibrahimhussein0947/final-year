import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/errors';
import { describeValue, normalizeRequirement, normalizeWorkerValue, optionsOf, requirementToSimple, type CriterionKind } from './validate';

// ───────── input shapes (used by the jobs and workers routes) ─────────
export const jobCriterionInput = z
  .object({
    criterionId: z.string().uuid(),
    importance: z.enum(['MUST_HAVE', 'PREFERRED']).default('PREFERRED'),
    value: z.union([z.boolean(), z.number(), z.string().max(80), z.array(z.string().max(80)).max(30)]),
  })
  .strict();
export type JobCriterionInput = z.infer<typeof jobCriterionInput>;

export const workerCriteriaInput = z
  .object({
    items: z
      .array(
        z.object({
          criterionId: z.string().uuid(),
          // null removes the answer
          value: z.union([z.boolean(), z.number(), z.string().max(80), z.array(z.string().max(80)).max(30), z.null()]),
        }).strict(),
      )
      .max(60),
  })
  .strict();

// ───────── definitions ─────────
export type DefinitionRow = Prisma.CriterionDefinitionGetPayload<{ include: { category: { select: { id: true; slug: true; nameEn: true } } } }>;
const defInclude = { category: { select: { id: true, slug: true, nameEn: true } } } as const;

export const definitionView = (d: DefinitionRow) => ({
  id: d.id, key: d.key, type: d.type as CriterionKind, labelEn: d.labelEn, labelAm: d.labelAm, labelOm: d.labelOm, helpEn: d.helpEn,
  options: optionsOf(d), unit: d.unit, minValue: d.minValue, maxValue: d.maxValue, mustHaveAllowed: d.mustHaveAllowed,
  evidenceSuggested: d.evidenceSuggested, sortOrder: d.sortOrder, isActive: d.isActive,
  category: d.category ? { id: d.category.id, slug: d.category.slug, name: d.category.nameEn } : null, // null = every sector
});

/** Active definitions: those for one category plus the ones that apply to every sector, or all of them. */
export async function listDefinitions(opts: { categoryId?: string; includeInactive?: boolean } = {}) {
  const rows = await prisma.criterionDefinition.findMany({
    where: {
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.categoryId ? { OR: [{ categoryId: null }, { categoryId: opts.categoryId }] } : {}),
    },
    include: defInclude,
    orderBy: [{ sortOrder: 'asc' }, { labelEn: 'asc' }],
  });
  return rows.map(definitionView);
}

// ───────── job requirements ─────────
export interface ValidatedJobCriterion { criterionId: string; importance: 'MUST_HAVE' | 'PREFERRED'; value: Prisma.InputJsonValue }

/** Checks every requirement against its definition and the job's category; throws a readable 400 on the first problem. */
export async function validateJobCriteria(categoryId: string, items: JobCriterionInput[]): Promise<ValidatedJobCriterion[]> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.criterionId);
  if (new Set(ids).size !== ids.length) throw badRequest('Each sector requirement can only be listed once', { criteria: ['Each sector requirement can only be listed once'] });
  const defs = new Map((await prisma.criterionDefinition.findMany({ where: { id: { in: ids } } })).map((d) => [d.id, d]));
  const out: ValidatedJobCriterion[] = [];
  for (const item of items) {
    const def = defs.get(item.criterionId);
    if (!def || !def.isActive) throw badRequest('Unknown sector requirement', { criteria: ['One of the sector requirements does not exist or is hidden'] });
    if (def.categoryId !== null && def.categoryId !== categoryId) throw badRequest('Requirement does not belong to this sector', { criteria: [`"${def.labelEn}" does not apply to the chosen job category`] });
    const r = normalizeRequirement(def, item.importance, item.value);
    if (!r.ok) throw badRequest('Invalid sector requirement', { criteria: [`${def.labelEn}: ${r.message}`] });
    out.push({ criterionId: def.id, importance: item.importance, value: r.value as Prisma.InputJsonValue });
  }
  return out;
}

type JobCriterionRow = Prisma.JobCriterionGetPayload<{ include: { criterion: true } }>;
/** What a job page and the job form need: label, importance, the requirement in simple form, and readable text. */
export const jobCriteriaView = (rows: JobCriterionRow[]) =>
  rows
    .filter((r) => r.criterion.isActive)
    .sort((a, b) => a.criterion.sortOrder - b.criterion.sortOrder)
    .map((r) => {
      const simple = requirementToSimple(r.criterion.type, r.value);
      return {
        criterionId: r.criterionId, key: r.criterion.key, type: r.criterion.type, labelEn: r.criterion.labelEn, labelAm: r.criterion.labelAm, labelOm: r.criterion.labelOm,
        importance: r.importance, value: simple,
        text: r.criterion.type === 'NUMBER' && typeof simple === 'number' ? `at least ${describeValue(r.criterion, simple)}` : describeValue(r.criterion, simple),
        evidenceSuggested: r.criterion.evidenceSuggested,
      };
    });

// ───────── worker answers ─────────
export async function getWorkerCriteria(workerId: string) {
  const rows = await prisma.workerCriterion.findMany({ where: { workerId }, include: { criterion: true } });
  const pending = await prisma.verificationRequest.findMany({
    where: { targetType: 'CRITERION', targetId: { in: rows.map((r) => r.id) }, status: 'PENDING' },
    select: { targetId: true },
  });
  const pendingIds = new Set(pending.map((p) => p.targetId));
  return rows.map((r) => ({
    id: r.id, criterionId: r.criterionId, value: r.value, source: r.source, verifiedAt: r.verifiedAt,
    verificationPending: pendingIds.has(r.id), text: describeValue(r.criterion, r.value),
  }));
}

/** Saves answers. A changed answer loses its "verified" mark (the evidence was for the old answer). */
export async function setWorkerCriteria(workerId: string, items: z.infer<typeof workerCriteriaInput>['items']) {
  const ids = items.map((i) => i.criterionId);
  if (new Set(ids).size !== ids.length) throw badRequest('Each question can only be answered once', { items: ['Each question can only be answered once'] });
  const defs = new Map((await prisma.criterionDefinition.findMany({ where: { id: { in: ids } } })).map((d) => [d.id, d]));
  const existing = new Map((await prisma.workerCriterion.findMany({ where: { workerId, criterionId: { in: ids } } })).map((e) => [e.criterionId, e]));

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const errors: string[] = [];
  for (const item of items) {
    const def = defs.get(item.criterionId);
    if (!def || !def.isActive) { errors.push('One of the questions does not exist or is hidden'); continue; }
    const had = existing.get(def.id);
    if (item.value === null) {
      if (had) ops.push(prisma.workerCriterion.delete({ where: { id: had.id } }));
      continue;
    }
    const v = normalizeWorkerValue(def, item.value);
    if (!v.ok) { errors.push(`${def.labelEn}: ${v.message}`); continue; }
    const value = v.value as Prisma.InputJsonValue;
    if (!had) ops.push(prisma.workerCriterion.create({ data: { workerId, criterionId: def.id, value } }));
    else if (JSON.stringify(had.value) !== JSON.stringify(v.value)) {
      ops.push(prisma.workerCriterion.update({ where: { id: had.id }, data: { value, source: 'SELF_REPORTED', verifiedAt: null } }));
    }
  }
  if (errors.length) throw badRequest('Some answers are not valid', { items: errors });
  await prisma.$transaction(ops);
}

/** For an employer looking at a candidate: the sector answers with readable labels and their verification status. */
export async function workerCriteriaForEmployer(workerId: string) {
  const rows = await prisma.workerCriterion.findMany({ where: { workerId, criterion: { isActive: true } }, include: { criterion: { include: defInclude } } });
  return rows
    .sort((a, b) => a.criterion.sortOrder - b.criterion.sortOrder)
    .map((r) => ({
      criterionId: r.criterionId, labelEn: r.criterion.labelEn, category: r.criterion.category?.nameEn ?? null,
      text: describeValue(r.criterion, r.value), verified: r.source === 'VERIFIED',
    }));
}
