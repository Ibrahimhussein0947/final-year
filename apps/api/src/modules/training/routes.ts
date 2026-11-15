import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/common';
import { workerIdFor } from '../workers/service';

const uuid = z.string().uuid();
const idOf = (req: Request) => {
  const r = uuid.safeParse(req.params.id);
  if (!r.success) throw notFound();
  return r.data;
};

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();
// Only web links, so a stored value can never be a javascript: or data: URL.
const url = z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'Use a full web address starting with http:// or https://').transform((v) => v || null).nullable().optional();

const courseSchema = z.object({
  title: z.string().trim().min(3).max(150),
  provider: z.string().trim().min(2).max(150),
  description: optionalText(1000),
  url,
  online: z.boolean().default(false),
  locationId: z.string().uuid().nullable().optional(),
  costEtb: z.number().int().min(0).max(10_000_000).nullable().optional(), // null = not stated; 0 = free
  durationText: optionalText(60),
  languages: z.array(z.string().trim().min(2).max(30)).max(6).default([]),
  skillIds: z.array(z.string().uuid()).min(1, 'Choose at least one skill the course teaches').max(15),
  isActive: z.boolean().default(true),
}).strict();
const courseUpdateSchema = courseSchema.partial().strict();

const courseInclude = { skills: { include: { skill: { select: { id: true, nameEn: true } } } }, location: { select: { id: true, nameEn: true } } } satisfies Prisma.TrainingCourseInclude;
type CourseRow = Prisma.TrainingCourseGetPayload<{ include: typeof courseInclude }>;

const courseOut = (c: CourseRow) => ({
  id: c.id, title: c.title, provider: c.provider, description: c.description, url: c.url, online: c.online,
  location: c.location ? { id: c.location.id, name: c.location.nameEn } : null,
  costEtb: c.costEtb, free: c.costEtb === 0, durationText: c.durationText, languages: c.languages, isActive: c.isActive,
  skills: c.skills.map((s) => ({ id: s.skill.id, name: s.skill.nameEn })),
});

async function checkReferences(skillIds: string[] | undefined, locationId: string | null | undefined) {
  if (skillIds) {
    const found = await prisma.skill.count({ where: { id: { in: skillIds }, isActive: true } });
    if (found !== new Set(skillIds).size) throw badRequest('Some of the chosen skills do not exist');
  }
  if (locationId && !(await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } }))) throw badRequest('Unknown location');
}

/** Courses are written by administrators. Nothing is listed unless one has been added, and nothing is invented here. */
export function trainingAdminRouter() {
  const router = Router();
  router.use(requireAuth, requireRole('ADMIN'));

  router.get('/', async (_req, res) => {
    const rows = await prisma.trainingCourse.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }], include: courseInclude });
    res.json({ items: rows.map(courseOut) });
  });

  router.post('/', validateBody(courseSchema), async (req, res) => {
    const { skillIds, ...data } = req.body as z.infer<typeof courseSchema>;
    await checkReferences(skillIds, data.locationId);
    const row = await prisma.trainingCourse.create({
      data: { ...data, createdById: req.user!.id, skills: { create: [...new Set(skillIds)].map((skillId) => ({ skillId })) } },
      include: courseInclude,
    });
    await audit(req, req.user!.id, 'training.created', 'TrainingCourse', row.id);
    res.status(201).json({ item: courseOut(row) });
  });

  router.patch('/:id', validateBody(courseUpdateSchema), async (req, res) => {
    const id = idOf(req);
    if (!(await prisma.trainingCourse.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Course not found');
    const { skillIds, ...data } = req.body as z.infer<typeof courseUpdateSchema>;
    await checkReferences(skillIds, data.locationId);
    const row = await prisma.$transaction(async (tx) => {
      if (skillIds) {
        await tx.trainingCourseSkill.deleteMany({ where: { courseId: id } });
        await tx.trainingCourseSkill.createMany({ data: [...new Set(skillIds)].map((skillId) => ({ courseId: id, skillId })) });
      }
      return tx.trainingCourse.update({ where: { id }, data, include: courseInclude });
    });
    await audit(req, req.user!.id, 'training.updated', 'TrainingCourse', id);
    res.json({ item: courseOut(row) });
  });

  router.delete('/:id', async (req, res) => {
    const id = idOf(req);
    const r = await prisma.trainingCourse.deleteMany({ where: { id } });
    if (r.count === 0) throw notFound('Course not found');
    await audit(req, req.user!.id, 'training.deleted', 'TrainingCourse', id);
    res.status(204).end();
  });

  return router;
}

const MAX_GAPS = 8;
const MAX_COURSES = 12;

/**
 * Courses that teach what a worker is missing. The gap is either the skills a chosen job asks for that the worker
 * does not list ("job"), or the skills most often required by open jobs in the worker's field that they lack ("market").
 * This is a pointer to learning options an administrator has listed, not a promise of a job or an endorsement.
 */
export function trainingRouter() {
  const router = Router();
  router.use(requireAuth, requireRole('WORKER'));

  router.get('/suggestions', async (req, res) => {
    const q = z.object({ jobId: z.string().uuid().optional() }).safeParse(req.query);
    if (!q.success) throw badRequest('Invalid request');
    const workerId = await workerIdFor(req.user!.id);
    const worker = await prisma.workerProfile.findUniqueOrThrow({
      where: { id: workerId },
      select: { categoryId: true, locationId: true, skills: { select: { skillId: true } }, location: { select: { parentId: true, parent: { select: { parentId: true, parent: { select: { parentId: true } } } } } } },
    });
    const owned = new Set(worker.skills.map((s) => s.skillId));

    let basis: 'job' | 'market' = 'market';
    let job: { id: string; title: string } | null = null;
    let gaps: { skillId: string; name: string; reason: string }[];

    if (q.data.jobId) {
      const found = await prisma.job.findFirst({
        where: { id: q.data.jobId, status: 'ACTIVE' },
        select: { id: true, title: true, skills: { select: { importance: true, skill: { select: { id: true, nameEn: true } } } } },
      });
      if (!found) throw notFound('Job not found');
      basis = 'job';
      job = { id: found.id, title: found.title };
      gaps = found.skills
        .filter((s) => !owned.has(s.skill.id))
        .sort((a, b) => (a.importance === b.importance ? 0 : a.importance === 'REQUIRED' ? -1 : 1))
        .map((s) => ({ skillId: s.skill.id, name: s.skill.nameEn, reason: s.importance === 'REQUIRED' ? 'Required for this job' : 'Preferred for this job' }));
    } else {
      const demand = await prisma.jobSkill.groupBy({
        by: ['skillId'],
        where: { importance: 'REQUIRED', job: { status: 'ACTIVE', ...(worker.categoryId ? { categoryId: worker.categoryId } : {}) }, ...(owned.size ? { skillId: { notIn: [...owned] } } : {}) },
        _count: true, orderBy: { _count: { skillId: 'desc' } }, take: MAX_GAPS,
      });
      const names = new Map((await prisma.skill.findMany({ where: { id: { in: demand.map((d) => d.skillId) } }, select: { id: true, nameEn: true } })).map((s) => [s.id, s.nameEn]));
      gaps = demand.map((d) => ({ skillId: d.skillId, name: names.get(d.skillId) ?? '', reason: `Required in ${d._count} open ${d._count === 1 ? 'job' : 'jobs'} in your field` }));
    }
    gaps = gaps.slice(0, MAX_GAPS);

    const gapIds = gaps.map((g) => g.skillId);
    const rows = gapIds.length
      ? await prisma.trainingCourse.findMany({ where: { isActive: true, skills: { some: { skillId: { in: gapIds } } } }, include: courseInclude })
      : [];
    // Places the worker lives in, to prefer a course nearby: their own place and the areas above it.
    const nearIds = new Set([worker.locationId, worker.location?.parentId, worker.location?.parent?.parentId, worker.location?.parent?.parent?.parentId].filter(Boolean) as string[]);
    const gapName = new Map(gaps.map((g) => [g.skillId, g.name]));

    const items = rows
      .map((c) => {
        const covers = c.skills.filter((s) => gapName.has(s.skillId)).map((s) => s.skill.nameEn);
        const local = c.locationId ? nearIds.has(c.locationId) : false;
        const score = covers.length * 10 + (c.costEtb === 0 ? 2 : 0) + (c.online ? 1 : 0) + (local ? 3 : 0);
        return { ...courseOut(c), covers, nearYou: local, _score: score };
      })
      .sort((a, b) => b._score - a._score)
      .slice(0, MAX_COURSES)
      .map(({ _score, ...c }) => c);

    const covered = new Set(items.flatMap((c) => c.covers));
    res.json({
      basis,
      job,
      gaps: gaps.map((g) => ({ ...g, hasCourse: covered.has(g.name) })),
      items,
      note: 'Courses are listed by the platform team. A listing is not an endorsement, and finishing a course does not guarantee a job.',
    });
  });

  return router;
}
