import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

/**
 * A worker who was hired should stop appearing in employers' matching and stop getting job alerts. Matching already skips
 * NOT_AVAILABLE workers, so a hire sets that, remembering the earlier value so it can be restored if the hire falls through.
 */
export async function markHired(workerId: string) {
  const w = await prisma.workerProfile.findUnique({ where: { id: workerId }, select: { availability: true, availabilityBeforeHire: true } });
  if (!w || w.availability === 'NOT_AVAILABLE') return;
  await prisma.workerProfile.update({ where: { id: workerId }, data: { availability: 'NOT_AVAILABLE', availabilityBeforeHire: w.availability } });
}

/** Restore availability after a declined, withdrawn or expired offer, unless the worker has another live hire. */
export async function releaseHired(workerId: string, exceptApplicationId: string) {
  const w = await prisma.workerProfile.findUnique({ where: { id: workerId }, select: { availability: true, availabilityBeforeHire: true } });
  if (!w?.availabilityBeforeHire) return;
  const stillHired = await prisma.application.count({
    where: { workerId, status: 'ACCEPTED', id: { not: exceptApplicationId }, NOT: { offer: { is: { status: { in: ['DECLINED', 'WITHDRAWN', 'EXPIRED'] } } } } },
  });
  if (stillHired) return;
  await prisma.workerProfile.update({ where: { id: workerId }, data: { availability: w.availabilityBeforeHire, availabilityBeforeHire: null } });
}

/** Close jobs whose application deadline has passed, so they no longer look open. Matching already ignores them. */
export async function closeExpiredJobs(now = new Date()): Promise<number> {
  const r = await prisma.job.updateMany({ where: { status: 'ACTIVE', deadline: { lt: now } }, data: { status: 'CLOSED', featuredAt: null } });
  return r.count;
}

export function startJobCloseLoop(everyMs = 10 * 60_000): () => void {
  const run = () => closeExpiredJobs().catch((err) => logger.warn({ err: String(err) }, 'closing expired jobs failed'));
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
