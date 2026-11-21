import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { deleteFileAsset, saveUpload } from '../files/storage';
import { reencodeImage } from '../files/safeImage';

/**
 * A worker's photos of finished work. Self-reported: nothing checks that the work is theirs, and the screens say so.
 * Every image is decoded (in a child process, see files/safeImage.ts) and re-encoded as a JPEG no larger than MAX_SIDE, which
 * rejects files that only look like pictures and strips hidden metadata (camera, time and GPS position) before an employer sees it.
 */
export const MAX_ITEMS = 8;
const MAX_SIDE = 1600;

export const portfolioSchema = z
  .object({
    caption: z.string().trim().max(120).nullable().optional(),
    skillId: z.string().uuid().nullable().optional(),
  })
  .strict();

const url = (fileId: string) => `/api/v1/files/${fileId}`;
const out = (i: { id: string; fileId: string; caption: string | null; skillId: string | null; skill: { nameEn: string } | null; createdAt: Date }) => ({
  id: i.id, url: url(i.fileId), caption: i.caption, skillId: i.skillId, skill: i.skill?.nameEn ?? null, createdAt: i.createdAt,
});
const include = { skill: { select: { nameEn: true } } } as const;

async function checkSkill(skillId: string | null | undefined) {
  if (skillId && !(await prisma.skill.findUnique({ where: { id: skillId }, select: { id: true } }))) throw badRequest('Unknown skill', { skillId: ['Choose a skill from the list'] });
}

export async function listPortfolio(workerId: string) {
  return (await prisma.portfolioItem.findMany({ where: { workerId }, orderBy: { createdAt: 'asc' }, include })).map(out);
}

export async function addPortfolioItem(userId: string, workerId: string, file: Express.Multer.File | undefined, input: z.infer<typeof portfolioSchema>) {
  if (!file) throw badRequest('No picture received. Send it as multipart field "file".');
  if ((await prisma.portfolioItem.count({ where: { workerId } })) >= MAX_ITEMS) throw conflict(`You can show up to ${MAX_ITEMS} pictures. Delete one first.`);
  await checkSkill(input.skillId);
  const clean = await reencodeImage(file.buffer, { maxSide: MAX_SIDE });
  const asset = await saveUpload(userId, 'PORTFOLIO', { ...file, buffer: clean, size: clean.length });
  try {
    return out(await prisma.portfolioItem.create({ data: { workerId, fileId: asset.id, caption: input.caption || null, skillId: input.skillId ?? null }, include }));
  } catch (err) {
    await deleteFileAsset(asset.id);
    throw err;
  }
}

export async function updatePortfolioItem(workerId: string, id: string, input: z.infer<typeof portfolioSchema>) {
  await checkSkill(input.skillId);
  const { count } = await prisma.portfolioItem.updateMany({
    where: { id, workerId },
    data: { ...(input.caption !== undefined ? { caption: input.caption || null } : {}), ...(input.skillId !== undefined ? { skillId: input.skillId } : {}) },
  });
  if (!count) throw notFound('Picture not found');
  return out(await prisma.portfolioItem.findUniqueOrThrow({ where: { id }, include }));
}

export async function deletePortfolioItem(workerId: string, id: string) {
  const item = await prisma.portfolioItem.findFirst({ where: { id, workerId }, select: { id: true, fileId: true } });
  if (!item) throw notFound('Picture not found');
  await prisma.portfolioItem.delete({ where: { id } });
  await deleteFileAsset(item.fileId);
}

/** Employers may open a portfolio picture only while its owner's profile is visible and the account is active. */
export async function employerMayViewPortfolio(fileId: string): Promise<boolean> {
  return !!(await prisma.portfolioItem.findFirst({ where: { fileId, worker: { isVisible: true, user: { status: 'ACTIVE' } } }, select: { id: true } }));
}
