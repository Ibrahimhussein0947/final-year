import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { workerIdFor } from '../workers/service';

/**
 * Workers rate employers. To keep it fair and safe:
 * - only a worker who was interviewed or hired can rate, once per application;
 * - the rating is stars plus three yes/no questions, with no free text to moderate or to defame anyone;
 * - an employer sees only totals, never who rated, and totals are hidden until there are enough ratings (MIN_PUBLIC)
 *   so one angry or friendly worker cannot be identified or define an employer.
 */
export const MIN_PUBLIC = 3;

export const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    paidOnTime: z.boolean().nullable().optional(),
    respectful: z.boolean().nullable().optional(),
    asDescribed: z.boolean().nullable().optional(),
  })
  .strict();

export const canReviewEmployer = (status: string, interviews: number) =>
  status !== 'WITHDRAWN' && (status === 'INTERVIEW_SCHEDULED' || status === 'ACCEPTED' || interviews > 0);

export async function submitReview(userId: string, applicationId: string, input: z.infer<typeof reviewSchema>) {
  const workerId = await workerIdFor(userId);
  const app = await prisma.application.findFirst({ where: { id: applicationId, workerId }, select: { id: true, status: true, job: { select: { organizationId: true } }, _count: { select: { interviews: true } } } });
  if (!app) throw notFound('Application not found');
  if (!canReviewEmployer(app.status, app._count.interviews)) throw forbidden('You can rate an employer after you were interviewed or hired by them');
  if (await prisma.employerReview.findUnique({ where: { applicationId }, select: { id: true } })) throw conflict('You already rated this employer for this application');
  const r = await prisma.employerReview.create({
    data: { applicationId, workerId, organizationId: app.job.organizationId, rating: input.rating, paidOnTime: input.paidOnTime ?? null, respectful: input.respectful ?? null, asDescribed: input.asDescribed ?? null },
  });
  return { id: r.id, rating: r.rating };
}

export interface Rating {
  count: number;
  /** Hidden (null) until there are MIN_PUBLIC ratings. */
  average: number | null;
  paidOnTime: number | null;
  respectful: number | null;
  asDescribed: number | null;
  hidden: boolean;
}

/** Share of "yes" among the people who answered, as a whole percent; null when nobody answered. */
const share = (vals: (boolean | null)[]) => {
  const answered = vals.filter((v): v is boolean => v !== null);
  return answered.length ? Math.round((answered.filter(Boolean).length / answered.length) * 100) : null;
};

export async function organizationRating(organizationId: string): Promise<Rating> {
  const rows = await prisma.employerReview.findMany({ where: { organizationId }, select: { rating: true, paidOnTime: true, respectful: true, asDescribed: true } });
  const count = rows.length;
  if (count < MIN_PUBLIC) return { count, average: null, paidOnTime: null, respectful: null, asDescribed: null, hidden: true };
  return {
    count, hidden: false,
    average: Math.round((rows.reduce((a, r) => a + r.rating, 0) / count) * 10) / 10,
    paidOnTime: share(rows.map((r) => r.paidOnTime)),
    respectful: share(rows.map((r) => r.respectful)),
    asDescribed: share(rows.map((r) => r.asDescribed)),
  };
}
