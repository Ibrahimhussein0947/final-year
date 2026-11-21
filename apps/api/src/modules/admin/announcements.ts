import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/errors';

/**
 * Announcements from the administrators: shown as a banner to the people they are meant for while they are active,
 * and optionally also put in each person's notifications once, when the announcement is created.
 * Audience is everyone, workers or employers, optionally limited to one region. Text is written by an administrator only.
 */

export const announcementCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(1000),
    audience: z.enum(['ALL', 'WORKERS', 'EMPLOYERS']).default('ALL'),
    regionId: z.string().uuid().nullable().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    /** Also add it to each recipient's notifications now. */
    notify: z.boolean().default(false),
  })
  .strict();

export const announcementUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(1000),
    endsAt: z.coerce.date().nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');

type Audience = 'ALL' | 'WORKERS' | 'EMPLOYERS';

/** The region (a Location of level REGION) a place belongs to, found by walking up the parents. */
export async function regionOf(locationId: string | null | undefined): Promise<string | null> {
  let id = locationId ?? null;
  for (let i = 0; id && i < 6; i++) {
    const loc = await prisma.location.findUnique({ where: { id }, select: { id: true, level: true, parentId: true } });
    if (!loc) return null;
    if (loc.level === 'REGION') return loc.id;
    id = loc.parentId;
  }
  return null;
}

/** A place is in the region when it is the region itself or one of up to three levels below it. */
const inRegion = (regionId: string): Prisma.LocationWhereInput => ({
  OR: [{ id: regionId }, { parentId: regionId }, { parent: { parentId: regionId } }, { parent: { parent: { parentId: regionId } } }],
});

export const statusOf = (a: { startsAt: Date; endsAt: Date | null; withdrawnAt: Date | null }, now = new Date()) =>
  a.withdrawnAt ? 'withdrawn' : a.startsAt > now ? 'scheduled' : a.endsAt && a.endsAt <= now ? 'ended' : 'active';

export async function createAnnouncement(adminId: string, input: z.infer<typeof announcementCreateSchema>) {
  if (input.regionId) {
    const region = await prisma.location.findFirst({ where: { id: input.regionId, level: 'REGION' }, select: { id: true } });
    if (!region) throw badRequest('Choose a region from the list', { regionId: ['Unknown region'] });
  }
  const startsAt = input.startsAt ?? new Date();
  if (input.endsAt && input.endsAt <= startsAt) throw badRequest('The end must be after the start', { endsAt: ['Choose a later time'] });
  if (input.notify && startsAt.getTime() > Date.now() + 60_000) throw badRequest('Notifications go out when you create the announcement, so they cannot be used with a later start time', { notify: ['Turn off, or start now'] });

  const created = await prisma.announcement.create({
    data: { title: input.title, body: input.body, audience: input.audience, regionId: input.regionId ?? null, startsAt, endsAt: input.endsAt ?? null, createdById: adminId },
  });
  let notified = 0;
  if (input.notify) {
    const roles = input.audience === 'ALL' ? (['WORKER', 'EMPLOYER'] as const) : input.audience === 'WORKERS' ? (['WORKER'] as const) : (['EMPLOYER'] as const);
    const regionFilter = input.regionId
      ? {
          OR: [
            { workerProfile: { is: { location: { is: inRegion(input.regionId) } } } },
            { employerProfile: { is: { organization: { location: { is: inRegion(input.regionId) } } } } },
          ],
        }
      : {};
    const users = await prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: [...roles] }, ...regionFilter }, select: { id: true } });
    const payload = { announcementId: created.id, title: created.title } as Prisma.InputJsonValue;
    for (let i = 0; i < users.length; i += 1000) {
      const batch = users.slice(i, i + 1000);
      await prisma.notification.createMany({ data: batch.map((u) => ({ userId: u.id, type: 'announcement', payload })) });
    }
    notified = users.length;
    await prisma.announcement.update({ where: { id: created.id }, data: { notifiedCount: notified } });
  }
  return { ...created, notifiedCount: notified, status: statusOf(created) };
}

export async function listAnnouncements() {
  const rows = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const regions = await prisma.location.findMany({ where: { id: { in: rows.flatMap((r) => (r.regionId ? [r.regionId] : [])) } }, select: { id: true, nameEn: true } });
  const name = new Map(regions.map((r) => [r.id, r.nameEn]));
  return rows.map((a) => ({ ...a, region: a.regionId ? name.get(a.regionId) ?? null : null, status: statusOf(a) }));
}

export async function updateAnnouncement(id: string, patch: z.infer<typeof announcementUpdateSchema>) {
  const a = await prisma.announcement.findUnique({ where: { id } });
  if (!a) throw notFound('Announcement not found');
  if (patch.endsAt && patch.endsAt <= a.startsAt) throw badRequest('The end must be after the start', { endsAt: ['Choose a later time'] });
  return prisma.announcement.update({ where: { id }, data: patch });
}

export async function withdrawAnnouncement(id: string) {
  const a = await prisma.announcement.findUnique({ where: { id } });
  if (!a) throw notFound('Announcement not found');
  if (a.withdrawnAt) return a;
  return prisma.announcement.update({ where: { id }, data: { withdrawnAt: new Date() } });
}

/** What a signed-in person should see right now: active, for their role, and for their region when it is limited to one. */
export async function activeFor(user: { id: string; role: string }) {
  const now = new Date();
  const audiences: Audience[] = user.role === 'WORKER' ? ['ALL', 'WORKERS'] : user.role === 'EMPLOYER' ? ['ALL', 'EMPLOYERS'] : ['ALL'];
  const rows = await prisma.announcement.findMany({
    where: { withdrawnAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }], audience: { in: audiences } },
    orderBy: { startsAt: 'desc' },
    take: 20,
  });
  if (rows.length === 0) return [];
  let region: string | null | undefined;
  const mine = async () => {
    if (region !== undefined) return region;
    const w = await prisma.workerProfile.findUnique({ where: { userId: user.id }, select: { locationId: true } });
    const e = w ? null : await prisma.employerProfile.findUnique({ where: { userId: user.id }, select: { organization: { select: { locationId: true } } } });
    region = await regionOf(w?.locationId ?? e?.organization.locationId);
    return region;
  };
  const out = [];
  for (const a of rows) {
    if (a.regionId && a.regionId !== (await mine())) continue;
    out.push({ id: a.id, title: a.title, body: a.body, startsAt: a.startsAt, endsAt: a.endsAt });
  }
  return out.slice(0, 5);
}
