import { z } from 'zod';
import type { JobOffer, OfferStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { notify } from '../notifications/service';
import { orgIdFor } from '../jobs/service';
import { workerIdFor } from '../workers/service';
import { getPolicy } from '../hiring/service';

/**
 * Offer, accepted, started. The decision to hire stays in the application workflow (and its hiring rules): an offer can
 * only be written for an application that is already ACCEPTED. The offer records the terms (start date, pay), the
 * worker's answer, and that the person actually started, and it reminds both sides before the start date.
 */
export const DEFAULT_RESPOND_DAYS = 7;
const MAX_START_DAYS = 366;
const DAY = 86_400_000;

/** Today's date in Ethiopia (UTC+3) as a UTC-midnight Date, because offer dates are plain calendar days. */
export function today(now = new Date()): Date {
  const eat = new Date(now.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const day = (d: Date) => d.toISOString().slice(0, 10);

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
export const offerSchema = z
  .object({
    startDate: dateText,
    respondBy: dateText.optional(),
    salary: z.number().int().positive().max(10_000_000).nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
    /** Days of probation stated in the offer. Limited by the organization type (see HiringPolicy.maxProbationDays). */
    probationDays: z.number().int().min(0).max(365).nullable().optional(),
  })
  .strict();

function parseDay(v: string, field: string): Date {
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || day(d) !== v) throw badRequest('That date does not exist', { [field]: ['Enter a real date'] });
  return d;
}

const LIVE: OfferStatus[] = ['OFFERED', 'ACCEPTED', 'STARTED'];

export interface OfferView {
  id: string; applicationId: string; status: OfferStatus; salary: number | null; currency: string; startDate: string; respondBy: string;
  note: string | null; probationDays: number | null; respondedAt: Date | null; startedAt: Date | null; createdAt: Date;
  /** Days until the start date (negative once it has passed). */
  startsInDays: number;
  job: { id: string; title: string }; organization: string;
}
type Row = JobOffer & { application: { job: { id: string; title: string } }; organization: { name: string } };
const rowInclude = { application: { select: { job: { select: { id: true, title: true } } } }, organization: { select: { name: true } } } as const;

const view = (o: Row, now = new Date()): OfferView => ({
  id: o.id, applicationId: o.applicationId, status: o.status, salary: o.salary, currency: o.currency, startDate: day(o.startDate), respondBy: day(o.respondBy),
  note: o.note, probationDays: o.probationDays, respondedAt: o.respondedAt, startedAt: o.startedAt, createdAt: o.createdAt,
  startsInDays: Math.round((o.startDate.getTime() - today(now).getTime()) / DAY),
  job: o.application.job, organization: o.organization.name,
});

/** An offer nobody answered by its date is treated as expired the moment it is read or answered, whether or not the sweep has run yet. */
async function settleExpiry(o: Row): Promise<Row> {
  if (o.status === 'OFFERED' && o.respondBy.getTime() < today().getTime()) {
    const claimed = await prisma.jobOffer.updateMany({ where: { id: o.id, status: 'OFFERED' }, data: { status: 'EXPIRED' } });
    if (claimed.count) await tellEmployer(o, 'offer.expired');
    return { ...o, status: 'EXPIRED' };
  }
  return o;
}

async function tellEmployer(o: Row, type: 'offer.responded' | 'offer.expired' | 'offer.started', extra: Record<string, unknown> = {}) {
  const app = await prisma.application.findUnique({ where: { id: o.applicationId }, select: { job: { select: { postedById: true } }, worker: { select: { user: { select: { fullName: true } } } } } });
  if (!app) return;
  await notify(app.job.postedById, type, { offerId: o.id, applicationId: o.applicationId, jobId: o.application.job.id, jobTitle: o.application.job.title, candidateName: app.worker.user.fullName, ...extra });
}

// ───────── employer ─────────

export async function makeOffer(userId: string, applicationId: string, input: z.infer<typeof offerSchema>): Promise<OfferView> {
  const orgId = await orgIdFor(userId);
  const app = await prisma.application.findFirst({
    where: { id: applicationId, job: { organizationId: orgId } },
    select: { id: true, status: true, worker: { select: { id: true, userId: true } }, job: { select: { id: true, title: true, organization: { select: { name: true, type: true } } } }, offer: true },
  });
  if (!app) throw notFound('Application not found');
  if (app.status !== 'ACCEPTED') throw conflict('Accept the application first. An offer is written for someone you have decided to hire.');
  if (app.offer && LIVE.includes(app.offer.status)) throw conflict(app.offer.status === 'OFFERED' ? 'This person already has an offer waiting for their answer' : 'This offer was already accepted');

  // The longest probation this kind of organization may state (confirm the limits with a legal adviser).
  const limit = (await getPolicy(app.job.organization.type)).maxProbationDays;
  if (input.probationDays != null && limit !== null && input.probationDays > limit) throw badRequest(`The probation period is too long for this kind of organization`, { probationDays: [`At most ${limit} days`] });

  const t = today();
  const startDate = parseDay(input.startDate, 'startDate');
  if (startDate.getTime() < t.getTime()) throw badRequest('The start date is in the past', { startDate: ['Choose today or a later date'] });
  if (startDate.getTime() > addDays(t, MAX_START_DAYS).getTime()) throw badRequest('The start date is too far ahead', { startDate: ['Choose a date within a year'] });
  const respondBy = input.respondBy ? parseDay(input.respondBy, 'respondBy') : new Date(Math.min(addDays(t, DEFAULT_RESPOND_DAYS).getTime(), startDate.getTime()));
  if (respondBy.getTime() < t.getTime() || respondBy.getTime() > startDate.getTime()) throw badRequest('Check the answer date', { respondBy: ['It must be between today and the start date'] });

  const data = { organizationId: orgId, workerId: app.worker.id, status: 'OFFERED' as const, salary: input.salary ?? null, probationDays: input.probationDays ?? null, startDate, respondBy, note: input.note || null, respondedAt: null, startedAt: null, expiryRemindedAt: null, startRemindedAt: null };
  const row = app.offer
    ? await prisma.jobOffer.update({ where: { id: app.offer.id }, data, include: rowInclude }) // a new offer after a declined, withdrawn or expired one
    : await prisma.jobOffer.create({ data: { ...data, applicationId }, include: rowInclude });
  await notify(app.worker.userId, 'offer.made', { offerId: row.id, applicationId, jobId: app.job.id, jobTitle: app.job.title, organizationName: app.job.organization.name, startDate: day(startDate), respondBy: day(respondBy) });
  return view(row);
}

export async function withdrawOffer(userId: string, offerId: string): Promise<OfferView> {
  const orgId = await orgIdFor(userId);
  const o = await prisma.jobOffer.findFirst({ where: { id: offerId, organizationId: orgId }, include: rowInclude });
  if (!o) throw notFound('Offer not found');
  if (o.status !== 'OFFERED' && o.status !== 'ACCEPTED') throw conflict(o.status === 'STARTED' ? 'The person already started' : 'This offer is already closed');
  const row = await prisma.jobOffer.update({ where: { id: o.id }, data: { status: 'WITHDRAWN' }, include: rowInclude });
  const w = await prisma.workerProfile.findUnique({ where: { id: o.workerId }, select: { userId: true } });
  if (w) await notify(w.userId, 'offer.withdrawn', { offerId: o.id, applicationId: o.applicationId, jobId: o.application.job.id, jobTitle: o.application.job.title, organizationName: o.organization.name, wasAccepted: o.status === 'ACCEPTED' });
  return view(row);
}

export async function sentOffers(userId: string): Promise<OfferView[]> {
  const rows = await prisma.jobOffer.findMany({ where: { organizationId: await orgIdFor(userId) }, orderBy: { updatedAt: 'desc' }, take: 100, include: rowInclude });
  return Promise.all(rows.map(async (r) => view(await settleExpiry(r))));
}

// ───────── worker ─────────

export async function myOffers(userId: string): Promise<OfferView[]> {
  const rows = await prisma.jobOffer.findMany({ where: { workerId: await workerIdFor(userId) }, orderBy: { updatedAt: 'desc' }, take: 100, include: rowInclude });
  return Promise.all(rows.map(async (r) => view(await settleExpiry(r))));
}

export async function respondToOffer(userId: string, offerId: string, accept: boolean): Promise<OfferView> {
  const workerId = await workerIdFor(userId);
  const found = await prisma.jobOffer.findFirst({ where: { id: offerId, workerId }, include: rowInclude });
  if (!found) throw notFound('Offer not found');
  const o = await settleExpiry(found);
  if (o.status === 'EXPIRED') throw conflict('This offer ran out on ' + day(o.respondBy) + '. Ask the employer to send it again if you are still interested.');
  if (o.status !== 'OFFERED') throw conflict('This offer is no longer waiting for an answer');
  const claimed = await prisma.jobOffer.updateMany({ where: { id: o.id, status: 'OFFERED' }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() } });
  if (!claimed.count) throw conflict('This offer is no longer waiting for an answer');
  await tellEmployer(o, 'offer.responded', { accepted: accept, startDate: day(o.startDate) });
  return view((await prisma.jobOffer.findUniqueOrThrow({ where: { id: o.id }, include: rowInclude })));
}

// ───────── both ─────────

/** Either side confirms that the person started work. Possible from the start date on, after the offer was accepted. */
export async function confirmStarted(userId: string, role: 'WORKER' | 'EMPLOYER', offerId: string): Promise<OfferView> {
  const where: Prisma.JobOfferWhereInput = role === 'WORKER' ? { id: offerId, workerId: await workerIdFor(userId) } : { id: offerId, organizationId: await orgIdFor(userId) };
  const o = await prisma.jobOffer.findFirst({ where, include: rowInclude });
  if (!o) throw notFound('Offer not found');
  if (o.status === 'STARTED') return view(o);
  if (o.status !== 'ACCEPTED') throw conflict('Only an accepted offer can be marked as started');
  if (o.startDate.getTime() > today().getTime()) throw conflict(`The start date is ${day(o.startDate)}. You can confirm from that day.`);
  const claimed = await prisma.jobOffer.updateMany({ where: { id: o.id, status: 'ACCEPTED' }, data: { status: 'STARTED', startedAt: new Date() } });
  const row = await prisma.jobOffer.findUniqueOrThrow({ where: { id: o.id }, include: rowInclude });
  if (claimed.count) {
    const other = role === 'WORKER'
      ? (await prisma.application.findUnique({ where: { id: o.applicationId }, select: { job: { select: { postedById: true } } } }))?.job.postedById
      : (await prisma.workerProfile.findUnique({ where: { id: o.workerId }, select: { userId: true } }))?.userId;
    if (other) await notify(other, 'offer.started', { offerId: o.id, applicationId: o.applicationId, jobId: o.application.job.id, jobTitle: o.application.job.title, by: role.toLowerCase() });
  }
  return view(row);
}

// ───────── reminders ─────────

/**
 * Once a day's worth of work: expire offers nobody answered; remind a worker one day before an unanswered offer runs out;
 * and remind both sides on the day before the start (or the start day if the offer came later). Each reminder is claimed
 * with a flag first, so running this on a timer, on several servers, or twice in a row never sends a duplicate.
 */
export async function runOfferChecks(now = new Date()): Promise<{ expired: number; expiryReminders: number; startReminders: number }> {
  const t = today(now);
  const out = { expired: 0, expiryReminders: 0, startReminders: 0 };

  const late = await prisma.jobOffer.findMany({ where: { status: 'OFFERED', respondBy: { lt: t } }, include: rowInclude, take: 500 });
  for (const o of late) {
    if ((await prisma.jobOffer.updateMany({ where: { id: o.id, status: 'OFFERED' }, data: { status: 'EXPIRED' } })).count) { await tellEmployer(o, 'offer.expired'); out.expired++; }
  }

  const closing = await prisma.jobOffer.findMany({ where: { status: 'OFFERED', respondBy: { lte: addDays(t, 1), gte: t }, expiryRemindedAt: null }, include: rowInclude, take: 500 });
  for (const o of closing) {
    if (!(await prisma.jobOffer.updateMany({ where: { id: o.id, status: 'OFFERED', expiryRemindedAt: null }, data: { expiryRemindedAt: now } })).count) continue;
    const w = await prisma.workerProfile.findUnique({ where: { id: o.workerId }, select: { userId: true } });
    if (w) await notify(w.userId, 'offer.reminder', { kind: 'answer', offerId: o.id, jobId: o.application.job.id, jobTitle: o.application.job.title, organizationName: o.organization.name, respondBy: day(o.respondBy), audience: 'worker' });
    out.expiryReminders++;
  }

  const starting = await prisma.jobOffer.findMany({ where: { status: 'ACCEPTED', startDate: { lte: addDays(t, 1), gte: t }, startRemindedAt: null }, include: rowInclude, take: 500 });
  for (const o of starting) {
    if (!(await prisma.jobOffer.updateMany({ where: { id: o.id, status: 'ACCEPTED', startRemindedAt: null }, data: { startRemindedAt: now } })).count) continue;
    const app = await prisma.application.findUnique({ where: { id: o.applicationId }, select: { job: { select: { postedById: true } }, worker: { select: { userId: true } } } });
    const payload = { kind: 'start', offerId: o.id, jobId: o.application.job.id, jobTitle: o.application.job.title, organizationName: o.organization.name, startDate: day(o.startDate) };
    if (app) {
      await notify(app.worker.userId, 'offer.reminder', { ...payload, audience: 'worker' });
      await notify(app.job.postedById, 'offer.reminder', { ...payload, audience: 'employer' });
    }
    out.startReminders++;
  }
  return out;
}

export function startOfferLoop(everyMs = 30 * 60_000): () => void {
  const run = () => runOfferChecks().catch((err) => logger.warn({ err: String(err) }, 'offer checks failed'));
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
