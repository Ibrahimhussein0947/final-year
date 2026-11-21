import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requireAuth, requireRole } from '../../middleware/auth';
import { notify } from '../notifications/service';
import { orgIdFor } from '../jobs/service';

const HOUR = 3_600_000;
const DEFAULT_LENGTH_MS = HOUR; // interviews have no end time in the data, so calendars show one hour
const CONFLICT_WINDOW_MS = HOUR; // two interviews closer than this clash

// ───────────────────────── Video rooms ─────────────────────────

const JOIN_OPENS_BEFORE_MS = 15 * 60_000;
const JOIN_CLOSES_AFTER_MS = 2 * HOUR;

export const videoEnabled = () => env.videoBaseUrl !== null;

/** A private meeting room on the configured service. The name is random, so the link cannot be guessed. */
export function makeVideoRoom(): { room: string; url: string } {
  if (!env.videoBaseUrl) throw badRequest('Video rooms are not set up on this platform. Paste your own meeting link instead.');
  const room = `et-${randomBytes(12).toString('hex')}`;
  return { room, url: `${env.videoBaseUrl}/${room}` };
}

/** The call can be joined from a quarter of an hour before the start until two hours after it. */
export function joinWindow(scheduledAt: Date, now = new Date()) {
  const opensAt = new Date(scheduledAt.getTime() - JOIN_OPENS_BEFORE_MS);
  const closesAt = new Date(scheduledAt.getTime() + JOIN_CLOSES_AFTER_MS);
  return { opensAt, closesAt, canJoinNow: now >= opensAt && now <= closesAt };
}

// ───────────────────────── Reminders ─────────────────────────

/**
 * Remind both sides of interviews that are coming up: once about a day ahead and once about an hour ahead.
 * Each reminder is sent at most once per interview (the flags are reset if the time is changed), so running this
 * on a timer, on several servers, or twice in a row never sends a duplicate for the same window.
 * An interview booked less than a day ahead skips the day reminder; one booked less than an hour ahead gets neither
 * (the scheduling notification already told the worker).
 */
export async function sendInterviewReminders(now = new Date()): Promise<{ day: number; hour: number }> {
  const horizon = new Date(now.getTime() + 24 * HOUR);
  const due = await prisma.interview.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { gt: now, lte: horizon }, OR: [{ remindedDayAt: null }, { remindedHourAt: null }] },
    include: {
      application: {
        select: {
          id: true, status: true,
          worker: { select: { userId: true } },
          job: { select: { id: true, title: true, postedById: true, organization: { select: { name: true } } } },
        },
      },
    },
    take: 500,
  });

  let day = 0;
  let hour = 0;
  for (const i of due) {
    if (['REJECTED', 'WITHDRAWN'].includes(i.application.status)) continue;
    const msAway = i.scheduledAt.getTime() - now.getTime();
    const window: 'hour' | 'day' | null = msAway <= HOUR ? (i.remindedHourAt ? null : 'hour') : i.remindedDayAt ? null : 'day';
    if (!window) continue;

    // Claim the reminder first, so a second runner cannot send it too.
    const flag = window === 'hour' ? { remindedHourAt: now, remindedDayAt: i.remindedDayAt ?? now } : { remindedDayAt: now };
    const claimed = await prisma.interview.updateMany({
      where: { id: i.id, status: 'SCHEDULED', scheduledAt: i.scheduledAt, ...(window === 'hour' ? { remindedHourAt: null } : { remindedDayAt: null }) },
      data: flag,
    });
    if (claimed.count === 0) continue;

    const payload = {
      applicationId: i.application.id, jobId: i.application.job.id, jobTitle: i.application.job.title,
      organizationName: i.application.job.organization.name, scheduledAt: i.scheduledAt.toISOString(), mode: i.mode, window,
    };
    await notify(i.application.worker.userId, 'interview.reminder', { ...payload, audience: 'worker' });
    await notify(i.application.job.postedById, 'interview.reminder', { ...payload, audience: 'employer' });
    if (window === 'hour') hour++;
    else day++;
  }
  return { day, hour };
}

/** Check for due reminders every few minutes while the server runs. */
export function startReminderLoop(everyMs = 5 * 60_000): () => void {
  const run = () => sendInterviewReminders().catch((err) => logger.warn({ err: String(err) }, 'interview reminders failed'));
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

// ───────────────────────── Clashes ─────────────────────────

/**
 * Other scheduled interviews close to a given time. For the candidate this blocks the booking (a person cannot be in
 * two places, and the message does not say who the other employer is); for the employer's own diary it only warns.
 */
export async function findClashes(opts: { at: Date; workerId: string; organizationId: string; exceptInterviewId?: string }) {
  const from = new Date(opts.at.getTime() - CONFLICT_WINDOW_MS);
  const to = new Date(opts.at.getTime() + CONFLICT_WINDOW_MS);
  const base = { status: 'SCHEDULED' as const, scheduledAt: { gt: from, lt: to }, ...(opts.exceptInterviewId ? { id: { not: opts.exceptInterviewId } } : {}) };
  const [candidate, own] = await Promise.all([
    prisma.interview.count({ where: { ...base, application: { workerId: opts.workerId } } }),
    prisma.interview.findMany({
      where: { ...base, application: { workerId: { not: opts.workerId }, job: { organizationId: opts.organizationId } } },
      select: { scheduledAt: true, application: { select: { worker: { select: { user: { select: { fullName: true } } } } } } },
      take: 5,
    }),
  ]);
  return {
    candidateBusy: candidate > 0,
    ownWarnings: own.map((o) => `You already have an interview with ${o.application.worker.user.fullName} at ${o.scheduledAt.toISOString().slice(11, 16)} UTC, within an hour of this one.`),
  };
}

// ───────────────────────── Calendar listing ─────────────────────────

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  includePast: z.enum(['true', 'false']).optional(),
});

const MODE_LABEL: Record<string, string> = { IN_PERSON: 'In person', PHONE: 'Phone call', VIDEO: 'Video call' };

/** A person's interviews: a worker sees the organisation, an employer sees the candidate. Never a phone number. */
export async function listMyInterviews(userId: string, role: 'WORKER' | 'EMPLOYER', range: z.infer<typeof rangeSchema>) {
  const from = range.from ?? (range.includePast === 'true' ? new Date(Date.now() - 90 * 86_400_000) : new Date(Date.now() - 6 * HOUR));
  const to = range.to ?? new Date(Date.now() + 120 * 86_400_000);
  if (to.getTime() - from.getTime() > 400 * 86_400_000) throw badRequest('Choose a shorter date range (up to about a year)');

  const where =
    role === 'WORKER'
      ? { application: { worker: { userId } } }
      : { application: { job: { organizationId: await orgIdFor(userId) } } };
  const rows = await prisma.interview.findMany({
    where: { ...where, status: { in: ['SCHEDULED', 'COMPLETED'] }, scheduledAt: { gte: from, lte: to } },
    orderBy: { scheduledAt: 'asc' },
    take: 500,
    include: {
      application: {
        select: {
          id: true, status: true,
          worker: { select: { user: { select: { fullName: true } } } },
          job: { select: { id: true, title: true, organization: { select: { name: true } } } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.application.id,
    scheduledAt: r.scheduledAt,
    endsAt: new Date(r.scheduledAt.getTime() + DEFAULT_LENGTH_MS),
    video: r.mode === 'VIDEO' && r.locationOrLink ? { platformRoom: r.videoRoom !== null, ...joinWindow(r.scheduledAt) } : null,
    mode: r.mode,
    locationOrLink: r.locationOrLink,
    status: r.status,
    response: r.workerResponse,
    declineNote: role === 'EMPLOYER' ? r.declineNote : null,
    job: { id: r.application.job.id, title: r.application.job.title },
    with: role === 'WORKER' ? r.application.job.organization.name : r.application.worker.user.fullName,
  }));
}

// ───────────────────────── .ics export ─────────────────────────

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Lines longer than 75 bytes are folded, as the format requires. */
const fold = (line: string) => (line.length <= 73 ? line : line.match(/.{1,73}/g)!.join('\r\n '));

type CalItem = Awaited<ReturnType<typeof listMyInterviews>>[number];

/** An iCalendar file that Google Calendar, Outlook and phone calendars can import. Each event has a one-hour alert. */
export function buildIcs(items: CalItem[], role: 'WORKER' | 'EMPLOYER', now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EthioTalent AI//Interviews//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:EthioTalent AI interviews'];
  for (const i of items.filter((x) => x.status === 'SCHEDULED')) {
    const summary = role === 'WORKER' ? `Interview: ${i.job.title} (${i.with})` : `Interview: ${i.with} for ${i.job.title}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${i.id}@ethiotalent.ai`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(i.scheduledAt)}`,
      `DTEND:${icsDate(i.endsAt)}`,
      fold(`SUMMARY:${icsEscape(summary)}`),
      fold(`DESCRIPTION:${icsEscape(`${MODE_LABEL[i.mode] ?? i.mode}${i.locationOrLink ? `. ${i.locationOrLink}` : ''}`)}`),
      ...(i.locationOrLink ? [fold(`LOCATION:${icsEscape(i.locationOrLink)}`)] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Interview in one hour', 'TRIGGER:-PT1H', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

const respondSchema = z.object({ response: z.enum(['CONFIRMED', 'DECLINED']), note: z.string().max(300).optional() });

export function interviewsRouter() {
  const router = Router();
  router.use(requireAuth, requireRole('WORKER', 'EMPLOYER'));

  router.get('/config', (_req, res) => {
    res.json({ videoRooms: videoEnabled(), videoHost: env.videoBaseUrl ? new URL(env.videoBaseUrl).host : null });
  });

  // The link to the call, for the worker or the employer organization of that interview, inside the join window.
  router.get('/:id/join', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound('Interview not found');
    const role = req.user!.role as 'WORKER' | 'EMPLOYER';
    const iv = await prisma.interview.findFirst({
      where: {
        id: id.data, status: 'SCHEDULED',
        application: role === 'WORKER' ? { worker: { userId: req.user!.id } } : { job: { organizationId: await orgIdFor(req.user!.id) } },
      },
      select: { scheduledAt: true, mode: true, locationOrLink: true },
    });
    if (!iv) throw notFound('Interview not found');
    if (iv.mode !== 'VIDEO' || !iv.locationOrLink) throw conflict('This interview is not a video call');
    const w = joinWindow(iv.scheduledAt);
    if (!w.canJoinNow) {
      throw conflict(w.opensAt > new Date() ? `The call can be joined from ${w.opensAt.toISOString()} (15 minutes before it starts).` : 'This call has ended.');
    }
    res.json({ url: iv.locationOrLink, opensAt: w.opensAt, closesAt: w.closesAt });
  });

  // The candidate answers a proposed time: confirm it, or say they cannot come (the employer is told and can move it).
  router.post('/:id/respond', requireRole('WORKER'), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw notFound('Interview not found');
    const body = respondSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Choose confirm or decline', body.error.flatten().fieldErrors);
    const iv = await prisma.interview.findFirst({
      where: { id: id.data, status: 'SCHEDULED', application: { worker: { userId: req.user!.id } } },
      include: { application: { select: { id: true, status: true, worker: { select: { user: { select: { fullName: true } } } }, job: { select: { id: true, title: true, postedById: true } } } } },
    });
    if (!iv) throw notFound('Interview not found');
    if (['REJECTED', 'WITHDRAWN'].includes(iv.application.status)) throw conflict('This application is closed');
    if (iv.scheduledAt <= new Date()) throw conflict('This interview time has already passed');
    const note = body.data.response === 'DECLINED' ? body.data.note?.trim() || null : null;
    await prisma.interview.update({ where: { id: iv.id }, data: { workerResponse: body.data.response, respondedAt: new Date(), declineNote: note } });
    await notify(iv.application.job.postedById, 'interview.responded', {
      applicationId: iv.application.id, jobId: iv.application.job.id, jobTitle: iv.application.job.title,
      scheduledAt: iv.scheduledAt.toISOString(), response: body.data.response, candidateName: iv.application.worker.user.fullName, note,
    });
    res.json({ response: body.data.response });
  });

  router.get('/mine', async (req, res) => {
    const q = rangeSchema.safeParse(req.query);
    if (!q.success) throw badRequest('Invalid date range');
    res.json({ items: await listMyInterviews(req.user!.id, req.user!.role as 'WORKER' | 'EMPLOYER', q.data) });
  });

  router.get('/mine.ics', async (req, res) => {
    const role = req.user!.role as 'WORKER' | 'EMPLOYER';
    const items = await listMyInterviews(req.user!.id, role, {});
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my-interviews.ics"');
    res.send(buildIcs(items, role));
  });

  return router;
}
