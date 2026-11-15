import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { definitionView } from './service';

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();
const optionSchema = z
  .object({ value: z.string().regex(/^[a-z0-9][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and _'), labelEn: z.string().trim().min(1).max(80), labelAm: text(80), labelOm: text(80) })
  .strict();

const shared = {
  labelEn: z.string().trim().min(3).max(150),
  labelAm: text(150),
  labelOm: text(150),
  helpEn: text(300),
  unit: text(20),
  minValue: z.number().int().min(-1_000_000).max(1_000_000).nullable().optional(),
  maxValue: z.number().int().min(-1_000_000).max(1_000_000).nullable().optional(),
  mustHaveAllowed: z.boolean().optional(),
  evidenceSuggested: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};

export const createDefinitionSchema = z
  .object({
    categoryId: z.string().uuid().nullable().default(null),
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lowercase letters, digits and _, starting with a letter'),
    type: z.enum(['BOOLEAN', 'NUMBER', 'CHOICE', 'MULTI_CHOICE']),
    options: z.array(optionSchema).max(30).optional(),
    ...shared,
  })
  .strict();

// The key, type and sector of an existing criterion never change: stored answers and requirements depend on them.
export const updateDefinitionSchema = z.object({ ...shared, labelEn: shared.labelEn.optional(), options: z.array(optionSchema).max(30).optional(), isActive: z.boolean().optional() }).strict();

function checkShape(type: string, options: unknown[] | undefined, min: number | null | undefined, max: number | null | undefined) {
  const isChoice = type === 'CHOICE' || type === 'MULTI_CHOICE';
  if (isChoice && (!options || options.length < 2)) throw badRequest('Add at least two options', { options: ['A choice needs at least two options'] });
  if (!isChoice && options && options.length) throw badRequest('Options only apply to choice questions', { options: ['Only choice questions have options'] });
  if (options) {
    const values = (options as { value: string }[]).map((o) => o.value);
    if (new Set(values).size !== values.length) throw badRequest('Option values must be unique', { options: ['Each option needs a different value'] });
  }
  if (type !== 'NUMBER' && (min != null || max != null)) throw badRequest('A range only applies to numbers', { minValue: ['Only number questions have a range'] });
  if (min != null && max != null && min > max) throw badRequest('Minimum is above maximum', { maxValue: ['The maximum must be at least the minimum'] });
}

export async function adminListDefinitions() {
  const rows = await prisma.criterionDefinition.findMany({
    include: { category: { select: { id: true, slug: true, nameEn: true } }, _count: { select: { jobCriteria: true, workerCriteria: true } } },
    orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { labelEn: 'asc' }],
  });
  return rows.map((r) => ({ ...definitionView(r), usage: { jobs: r._count.jobCriteria, workers: r._count.workerCriteria } }));
}

export async function createDefinition(input: z.infer<typeof createDefinitionSchema>) {
  checkShape(input.type, input.options, input.minValue, input.maxValue);
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw badRequest('Unknown category', { categoryId: ['Choose a valid sector'] });
  if (await prisma.criterionDefinition.findFirst({ where: { categoryId: input.categoryId, key: input.key }, select: { id: true } })) throw conflict('A criterion with this key already exists for this sector');
  const last = await prisma.criterionDefinition.aggregate({ _max: { sortOrder: true } });
  const d = await prisma.criterionDefinition.create({
    data: {
      categoryId: input.categoryId, key: input.key, type: input.type, labelEn: input.labelEn, labelAm: input.labelAm ?? null, labelOm: input.labelOm ?? null,
      helpEn: input.helpEn ?? null, options: (input.options ?? undefined) as Prisma.InputJsonValue | undefined, unit: input.unit ?? null,
      minValue: input.minValue ?? null, maxValue: input.maxValue ?? null, mustHaveAllowed: input.mustHaveAllowed ?? true,
      evidenceSuggested: input.evidenceSuggested ?? false, sortOrder: input.sortOrder ?? (last._max.sortOrder ?? 0) + 1,
    },
  });
  return d.id;
}

export async function updateDefinition(id: string, input: z.infer<typeof updateDefinitionSchema>) {
  const d = await prisma.criterionDefinition.findUnique({ where: { id } });
  if (!d) throw notFound('Criterion not found');
  const nextMin = input.minValue === undefined ? d.minValue : input.minValue;
  const nextMax = input.maxValue === undefined ? d.maxValue : input.maxValue;
  const nextOptions = input.options ?? (Array.isArray(d.options) ? (d.options as unknown[]) : undefined);
  checkShape(d.type, nextOptions, nextMin, nextMax);
  const data: Prisma.CriterionDefinitionUpdateInput = {};
  for (const k of ['labelEn', 'labelAm', 'labelOm', 'helpEn', 'unit', 'minValue', 'maxValue', 'mustHaveAllowed', 'evidenceSuggested', 'sortOrder', 'isActive'] as const) {
    if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
  }
  if (input.options) data.options = input.options as Prisma.InputJsonValue;
  await prisma.criterionDefinition.update({ where: { id }, data });
}
