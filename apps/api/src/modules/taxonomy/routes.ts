import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest } from '../../lib/errors';

// Public reference data used by forms. Small, cacheable, and contains nothing personal.
export function taxonomyRouter() {
  const router = Router();

  router.get('/categories', async (_req, res) => {
    const items = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { nameEn: 'asc' },
      select: { id: true, slug: true, nameEn: true, nameAm: true, nameOm: true },
    });
    res.set('Cache-Control', 'public, max-age=300').json({ items });
  });

  router.get('/skills', async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().max(60).optional(),
        categoryId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .safeParse(req.query);
    if (!q.success) throw badRequest('Invalid query');
    const { q: text, categoryId, limit } = q.data;
    const items = await prisma.skill.findMany({
      where: {
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
        ...(text
          ? {
              OR: [
                { nameEn: { contains: text, mode: 'insensitive' } },
                { aliases: { has: text.toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: { nameEn: 'asc' },
      take: limit,
      select: { id: true, slug: true, nameEn: true, nameAm: true, nameOm: true, categoryId: true },
    });
    res.json({ items });
  });

  router.get('/locations', async (req, res) => {
    const q = z
      .object({
        level: z.enum(['REGION', 'ZONE', 'WOREDA', 'KEBELE']).optional(),
        parentId: z.string().uuid().optional(),
      })
      .safeParse(req.query);
    if (!q.success) throw badRequest('Invalid query');
    const items = await prisma.location.findMany({
      where: { level: q.data.level ?? (q.data.parentId ? undefined : 'REGION'), parentId: q.data.parentId },
      orderBy: { nameEn: 'asc' },
      select: { id: true, level: true, nameEn: true, nameAm: true, nameOm: true, parentId: true },
      take: 500,
    });
    res.set('Cache-Control', 'public, max-age=300').json({ items });
  });

  return router;
}
