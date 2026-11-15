import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { buildIcs, sendInterviewReminders } from '../modules/applications/interviews';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const HOUR = 3_600_000;
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Cal ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let categoryId = '';
let skillId = '';
beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { categoryId } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

async function liveJob(e: User) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Mechanic ${tag()}`, description: `Workshop role for the interview test. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE', skills: [{ skillId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}
/** A shortlisted application, ready for an interview. */
async function shortlisted(e: User, w: User, jobId: string) {
  expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
  const a = await prisma.application.findFirstOrThrow({ where: { jobId, worker: { userId: w.id } } });
  expect((await request(app).patch(`/api/v1/applications/${a.id}/status`).set(auth(e.token)).send({ status: 'SHORTLISTED' })).status).toBe(200);
  return a.id;
}
const book = (e: User, appId: string, at: Date, extra: object = {}) =>
  request(app).post(`/api/v1/applications/${appId}/interviews`).set(auth(e.token)).send({ scheduledAt: at.toISOString(), mode: 'IN_PERSON', locationOrLink: 'Adama office', ...extra });
const inHours = (h: number) => new Date(Date.now() + h * HOUR);
const reminders = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'interview.reminder' }, orderBy: { createdAt: 'asc' } });

describe('interview reminders', () => {
  it('reminds both sides once about a day ahead and once about an hour ahead, never twice', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const jobId = await liveJob(e);
    const appId = await shortlisted(e, w, jobId);
    const at = inHours(48);
    expect((await book(e, appId, at)).status).toBe(201);

    // two days ahead: nothing yet
    expect(await sendInterviewReminders(new Date())).toEqual({ day: 0, hour: 0 });
    // a day ahead: one reminder each, and a second run adds nothing
    const dayNow = new Date(at.getTime() - 20 * HOUR);
    expect(await sendInterviewReminders(dayNow)).toMatchObject({ day: 1, hour: 0 });
    expect(await sendInterviewReminders(dayNow)).toEqual({ day: 0, hour: 0 });
    expect(await reminders(w.id)).toHaveLength(1);
    expect(await reminders(e.id)).toHaveLength(1);
    expect((await reminders(w.id))[0].payload).toMatchObject({ window: 'day', audience: 'worker', applicationId: appId });

    // an hour ahead: one more each
    const hourNow = new Date(at.getTime() - 30 * 60_000);
    expect(await sendInterviewReminders(hourNow)).toMatchObject({ hour: 1 });
    expect(await sendInterviewReminders(hourNow)).toEqual({ day: 0, hour: 0 });
    expect(await reminders(w.id)).toHaveLength(2);
    expect((await reminders(e.id)).map((n) => (n.payload as { window: string }).window)).toEqual(['day', 'hour']);
  });

  it('skips the day reminder for a last-minute booking, and nothing for cancelled or ended applications', async () => {
    const e = await signUp('EMPLOYER');
    const [w1, w2] = [await signUp('WORKER'), await signUp('WORKER')];
    const jobId = await liveJob(e);
    const a1 = await shortlisted(e, w1, jobId);
    const a2 = await shortlisted(e, w2, jobId);
    const soon = inHours(0.5);
    expect((await book(e, a1, soon)).status).toBe(201);
    expect((await book(e, a2, inHours(5))).status).toBe(201);
    const interview2 = await prisma.interview.findFirstOrThrow({ where: { applicationId: a2 } });
    await request(app).delete(`/api/v1/applications/${a2}/interviews/${interview2.id}`).set(auth(e.token));

    const r = await sendInterviewReminders(new Date());
    expect(r.hour).toBeGreaterThanOrEqual(1);
    const mine = await reminders(w1.id);
    expect(mine.map((n) => (n.payload as { window: string }).window)).toEqual(['hour']);
    expect(await reminders(w2.id)).toHaveLength(0);
  });

  it('starts the reminders over when an interview is moved, and tells the candidate', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const appId = await shortlisted(e, w, await liveJob(e));
    expect((await book(e, appId, inHours(10))).status).toBe(201);
    await sendInterviewReminders(new Date());
    const iv = await prisma.interview.findFirstOrThrow({ where: { applicationId: appId } });
    expect(iv.remindedDayAt).not.toBeNull();

    const later = inHours(30);
    const moved = await request(app).patch(`/api/v1/applications/${appId}/interviews/${iv.id}`).set(auth(e.token)).send({ scheduledAt: later.toISOString(), mode: 'VIDEO', locationOrLink: 'https://meet.example.org/abc' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const after = await prisma.interview.findUniqueOrThrow({ where: { id: iv.id } });
    expect(after).toMatchObject({ mode: 'VIDEO', remindedDayAt: null, remindedHourAt: null });
    expect(after.scheduledAt.getTime()).toBe(later.getTime());
    const told = await prisma.notification.findMany({ where: { userId: w.id, type: 'interview.scheduled' }, orderBy: { createdAt: 'desc' } });
    expect(told[0].payload).toMatchObject({ rescheduled: true });
    // another employer cannot move it
    const other = await signUp('EMPLOYER');
    expect((await request(app).patch(`/api/v1/applications/${appId}/interviews/${iv.id}`).set(auth(other.token)).send({ scheduledAt: inHours(40).toISOString(), mode: 'PHONE' })).status).toBe(404);
  });
});

describe('clashes', () => {
  it('refuses to double-book a candidate (without naming the other employer) but only warns about the employer\'s own diary', async () => {
    const e1 = await signUp('EMPLOYER');
    const e2 = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const w2 = await signUp('WORKER');
    const j1 = await liveJob(e1);
    const j2 = await liveJob(e2);
    const a1 = await shortlisted(e1, w, j1);
    const a2 = await shortlisted(e2, w, j2);
    const a3 = await shortlisted(e1, w2, j1);
    const at = inHours(72);
    expect((await book(e1, a1, at)).status).toBe(201);

    const clash = await book(e2, a2, new Date(at.getTime() + 30 * 60_000));
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(/not available at that time/);
    expect(JSON.stringify(clash.body)).not.toMatch(/TEST_ORG/);
    expect((await book(e2, a2, new Date(at.getTime() + 90 * 60_000))).status).toBe(201); // an hour and a half later is fine

    const own = await book(e1, a3, new Date(at.getTime() + 20 * 60_000)); // different candidate, same diary
    expect(own.status).toBe(201);
    expect(own.body.warnings[0]).toMatch(/already have an interview with/);
  });
});

describe('calendar listing and .ics', () => {
  it('shows each side its own interviews, with the other party by name only, and exports a calendar file', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const stranger = await signUp('WORKER');
    const appId = await shortlisted(e, w, await liveJob(e));
    const at = inHours(96);
    expect((await book(e, appId, at, { locationOrLink: 'Adama, near the bus station; ask for "Hanna"' })).status).toBe(201);

    const mineW = await request(app).get('/api/v1/interviews/mine').set(auth(w.token));
    expect(mineW.status).toBe(200);
    expect(mineW.body.items).toHaveLength(1);
    expect(mineW.body.items[0]).toMatchObject({ applicationId: appId, mode: 'IN_PERSON', status: 'SCHEDULED' });
    expect(mineW.body.items[0].with).toMatch(/TEST_ORG Cal/); // the worker sees the organisation
    expect(JSON.stringify(mineW.body)).not.toMatch(/\+251/);
    const mineE = await request(app).get('/api/v1/interviews/mine').set(auth(e.token));
    expect(mineE.body.items[0].with).toMatch(/^Test WORKER/); // the employer sees the candidate
    expect((await request(app).get('/api/v1/interviews/mine').set(auth(stranger.token))).body.items).toHaveLength(0);
    expect((await request(app).get('/api/v1/interviews/mine')).status).toBe(401);
    expect((await request(app).get('/api/v1/interviews/mine?from=2020-01-01&to=2020-06-01').set(auth(w.token))).body.items).toHaveLength(0);
    expect((await request(app).get('/api/v1/interviews/mine?from=2020-01-01&to=2026-12-31').set(auth(w.token))).status).toBe(400); // range too long

    const ics = await request(app).get('/api/v1/interviews/mine.ics').set(auth(w.token));
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect(ics.text).toContain(`UID:${mineW.body.items[0].id}@ethiotalent.ai`);
    expect(ics.text).toContain('TRIGGER:-PT1H');
    expect(ics.text).toContain('\\;'); // the semicolon in the place is escaped
    expect(ics.text).not.toMatch(/[^\r]\n/); // every line ends with CRLF, never a bare newline
  });

  it('builds valid, escaped calendar text', () => {
    const text = buildIcs([{ id: 'i1', applicationId: 'a', scheduledAt: new Date('2027-01-05T08:00:00Z'), endsAt: new Date('2027-01-05T09:00:00Z'), mode: 'VIDEO', video: null, locationOrLink: 'https://x.test/a,b', status: 'SCHEDULED', job: { id: 'j', title: 'Driver; night' }, with: 'ABC' }], 'WORKER', new Date('2027-01-01T00:00:00Z'));
    expect(text).toContain('DTSTART:20270105T080000Z');
    expect(text).toContain('DTEND:20270105T090000Z');
    expect(text).toContain('SUMMARY:Interview: Driver\\; night (ABC)');
    expect(text).toContain('LOCATION:https://x.test/a\\,b');
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
