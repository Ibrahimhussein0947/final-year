import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { aiClient } from '../../integrations/aiClient';

export { isLikelyAfaanOromoo, isMostlyEthiopic, isUnsupportedForEmbedding, jobText, skillText, workerText } from './embeddingText';
import { isUnsupportedForEmbedding, jobText, workerText } from './embeddingText';

export async function refreshWorkerEmbedding(workerId: string): Promise<boolean> {
  const w = await prisma.workerProfile.findUnique({
    where: { id: workerId },
    select: { headline: true, occupation: true, bio: true, skills: { select: { skill: { select: { nameEn: true } } } } },
  });
  if (!w) return false;
  const text = workerText({ ...w, skills: w.skills.map((s) => s.skill.nameEn) });
  if (!text || isUnsupportedForEmbedding(w.headline, w.occupation, w.bio)) {
    await prisma.workerProfile.update({ where: { id: workerId }, data: { embedding: [], embeddingModel: null } });
    return false;
  }
  const r = await aiClient().embed([text]);
  if (!r) return false;
  await prisma.workerProfile.update({ where: { id: workerId }, data: { embedding: r.vectors[0], embeddingModel: r.model } });
  return true;
}

export async function refreshJobEmbedding(jobId: string): Promise<boolean> {
  const j = await prisma.job.findUnique({
    where: { id: jobId },
    select: { title: true, description: true, skills: { select: { importance: true, skill: { select: { nameEn: true } } } } },
  });
  if (!j) return false;
  if (isUnsupportedForEmbedding(j.title, j.description)) {
    await prisma.job.update({ where: { id: jobId }, data: { embedding: [], embeddingModel: null } });
    return false;
  }
  const r = await aiClient().embed([jobText({ ...j, skills: j.skills.map((s) => ({ name: s.skill.nameEn, required: s.importance === 'REQUIRED' })) })]);
  if (!r) return false;
  await prisma.job.update({ where: { id: jobId }, data: { embedding: r.vectors[0], embeddingModel: r.model } });
  return true;
}

// Profiles change in bursts (adding five skills in a row), so wait briefly and embed once.
const timers = new Map<string, NodeJS.Timeout>();
function debounce(key: string, fn: () => Promise<unknown>, ms = 1500) {
  if (!aiClient().enabled()) return;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn().catch((err) => logger.warn({ err: String(err), key }, 'embedding refresh failed'));
    }, ms),
  );
}
export const queueWorkerEmbedding = (id: string) => debounce(`w:${id}`, () => refreshWorkerEmbedding(id));
export const queueJobEmbedding = (id: string) => debounce(`j:${id}`, () => refreshJobEmbedding(id));
