import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { COMPONENT_KEYS, DEFAULT_WEIGHTS, type MatchWeights, type RelationMap } from './types';

const weightsSchema = z.object(Object.fromEntries(COMPONENT_KEYS.map((k) => [k, z.number().min(0).max(1)])) as Record<(typeof COMPONENT_KEYS)[number], z.ZodNumber>);

const TTL_MS = 60_000;
const weightCache = new Map<string, { at: number; value: { weights: MatchWeights; version: number | null } }>();
let relationCache: { at: number; value: RelationMap } | null = null;

export function clearMatchingCaches() {
  weightCache.clear();
  relationCache = null;
}

/**
 * Weights saved before sector criteria existed have six keys. They keep their ratios and give `criteria` its
 * default 12% share (the same scaling the built-in defaults use), so nothing changes for jobs without criteria.
 */
export function parseStoredWeights(raw: unknown): MatchWeights | null {
  const full = weightsSchema.safeParse(raw);
  if (full.success) return full.data;
  const { criteria: _ignored, ...core } = weightsSchema.shape;
  const legacy = z.object(core).safeParse(raw);
  if (!legacy.success) return null;
  const k = 1 - DEFAULT_WEIGHTS.criteria;
  return { ...(Object.fromEntries(Object.entries(legacy.data).map(([key, w]) => [key, Math.round(w * k * 1000) / 1000])) as Omit<MatchWeights, 'criteria'>), criteria: DEFAULT_WEIGHTS.criteria };
}

/** Active weights for a job category: the category's own set if one exists, otherwise the global set, otherwise the built-in defaults. */
export async function getWeights(categoryId: string | null): Promise<{ weights: MatchWeights; version: number | null }> {
  const key = categoryId ?? 'global';
  const hit = weightCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const rows = await prisma.matchWeights.findMany({
    where: { active: true, OR: [{ categoryId: null }, ...(categoryId ? [{ categoryId }] : [])] },
    orderBy: { version: 'desc' },
  });
  const pick = rows.find((r) => r.categoryId === categoryId && categoryId !== null) ?? rows.find((r) => r.categoryId === null);
  const parsed = pick ? parseStoredWeights(pick.weights) : null;
  const value = parsed && pick ? { weights: parsed, version: pick.version } : { weights: DEFAULT_WEIGHTS, version: null };
  weightCache.set(key, { at: Date.now(), value });
  return value;
}

/** Symmetric relation map built from the skill taxonomy. */
export async function getRelations(): Promise<RelationMap> {
  if (relationCache && Date.now() - relationCache.at < 5 * 60_000) return relationCache.value;
  const rows = await prisma.skillRelation.findMany();
  const map: RelationMap = new Map();
  const add = (a: string, b: string, w: number) => {
    const inner = map.get(a) ?? new Map<string, number>();
    inner.set(b, Math.max(inner.get(b) ?? 0, w));
    map.set(a, inner);
  };
  for (const r of rows) {
    add(r.skillAId, r.skillBId, r.weight);
    add(r.skillBId, r.skillAId, r.weight);
  }
  relationCache = { at: Date.now(), value: map };
  return map;
}

// Strict: an unknown key is an error, not something to quietly ignore.
export const weightsInputSchema = weightsSchema.strict().refine(
  (w) => Math.abs(Object.values(w).reduce((s, n) => s + n, 0) - 1) <= 0.01,
  { message: 'Weights must add up to 1 (100%)' },
);
