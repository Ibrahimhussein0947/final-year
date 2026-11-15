import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', name = `Test ${role}`): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: name, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Alerts ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let transportId = '';
let heavyId = '';
let guardId = '';
let adamaId = '';

beforeAll(async () => {
  transportId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  heavyId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
  guardId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'guard-duty' } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

async function worker(name: string, skill = heavyId) {
  const w = await signUp('WORKER', name);
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({
    categoryId: transportId, headline: `Driver ${name}`, yearsExperience: 6, availability: 'IMMEDIATELY', locationId: adamaId,
  });
  expect((await request(app).put(`/api/v1/workers/me/skills/${skill}`).set(auth(w.token)).send({ proficiency: 4 })).status).toBe(200);
  const profile = await prisma.workerProfile.findFirstOrThrow({ where: { userId: w.id } });
  return { ...w, profileId: profile.id };
}

async function liveJob(e: User) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Driver ${tag()}`, description: `We need a heavy truck driver for regional deliveries. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId: transportId, employmentType: 'FULL_TIME', deadline: future(30), locationId: adamaId, skills: [{ skillId: heavyId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}

const notificationsOf = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type } });

describe('education: department and GPA', () => {
  it('stores department and a GPA with its scale, and rejects inconsistent values', async () => {
    const w = await worker(`Edu ${tag()}`);
    const post = (body: object) => request(app).post('/api/v1/workers/me/education').set(auth(w.token)).send(body);
    expect((await post({ level: 'BACHELOR', institution: 'Adama Science and Technology University', department: 'Software Engineering', gpa: 3.4, gpaScale: 4 })).status).toBe(201);
    expect((await post({ level: 'BACHELOR', gpa: 3.4 })).status).toBe(400); // scale missing
    expect((await post({ level: 'BACHELOR', gpa: 4.5, gpaScale: 4 })).status).toBe(400); // above its scale
    expect((await post({ level: 'BACHELOR', gpaScale: 4 })).status).toBe(400); // scale without a GPA
    const mine = await request(app).get('/api/v1/workers/me').set(auth(w.token));
    expect(mine.body.profile.education).toHaveLength(1);
    expect(mine.body.profile.education[0]).toMatchObject({ department: 'Software Engineering', gpa: 3.4, gpaScale: 4 });
  });

  it('works without any GPA, for informal and vocational routes', async () => {
    const w = await worker(`NoGpa ${tag()}`);
    const r = await request(app).post('/api/v1/workers/me/education').set(auth(w.token)).send({ level: 'PRIMARY' });
    expect(r.status).toBe(201);
    const row = r.body.profile.education[0];
    expect(row.gpa).toBeNull();
    expect(row.gpaScale).toBeNull();
  });
});

describe('internships, volunteering, training, apprenticeships and references', () => {
  it('lets a worker without formal schooling document how they learned their trade', async () => {
    const w = await worker(`Informal ${tag()}`);
    const post = (body: object) => request(app).post('/api/v1/workers/me/activities').set(auth(w.token)).send(body);
    expect((await post({ kind: 'APPRENTICESHIP', title: 'Truck mechanic apprentice', organization: 'Ato Kebede garage, Adama', startDate: '2019-02-01', endDate: '2021-02-01', hours: 3000 })).status).toBe(201);
    expect((await post({ kind: 'REFERENCE', title: 'Ato Kebede Alemu', organization: 'Former master / garage owner' })).status).toBe(201);
    expect((await post({ kind: 'VOLUNTEER', title: 'Road safety volunteer', organization: 'Red Cross branch' })).status).toBe(201);
    expect((await post({ kind: 'COOKING', title: 'x' })).status).toBe(400);
    expect((await post({ kind: 'TRAINING', title: 'Defensive driving', startDate: '2022-05-01', endDate: '2022-04-01' })).status).toBe(400);
    const mine = await request(app).get('/api/v1/workers/me').set(auth(w.token));
    expect(mine.body.profile.activities.map((a: { kind: string }) => a.kind).sort()).toEqual(['APPRENTICESHIP', 'REFERENCE', 'VOLUNTEER']);
    // An activity alone counts as background for profile completion.
    expect(mine.body.profile.completion.items.find((i: { key: string }) => i.key === 'background').done).toBe(true);
  });

  it('cannot be edited or deleted by someone else', async () => {
    const a = await worker(`A ${tag()}`);
    const b = await worker(`B ${tag()}`);
    const made = await request(app).post('/api/v1/workers/me/activities').set(auth(a.token)).send({ kind: 'TRAINING', title: 'First aid course' });
    const id = made.body.profile.activities[0].id;
    expect((await request(app).put(`/api/v1/workers/me/activities/${id}`).set(auth(b.token)).send({ kind: 'TRAINING', title: 'Hijacked' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/workers/me/activities/${id}`).set(auth(b.token))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/workers/me/activities/${id}`).set(auth(a.token))).status).toBe(200);
  });

  it('shows employers the activities, with no referee contact details anywhere', async () => {
    const e = await signUp('EMPLOYER');
    const w = await worker(`Seen ${tag()}`);
    await request(app).post('/api/v1/workers/me/activities').set(auth(w.token)).send({ kind: 'REFERENCE', title: 'Woizero Almaz', organization: 'Neighbour and former customer' });
    const view = await request(app).get(`/api/v1/workers/${w.profileId}`).set(auth(e.token));
    expect(view.status).toBe(200);
    expect(view.body.profile.activities[0]).toMatchObject({ kind: 'REFERENCE', title: 'Woizero Almaz' });
    expect(view.body.profile.contact).toBeNull();
    expect(JSON.stringify(view.body)).not.toMatch(/\+251|"phone"/);
  });
});

describe('supporting documents', () => {
  it('are readable by the owner and by an employer only after the worker applied to them', async () => {
    const e = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const w = await worker(`Doc ${tag()}`);
    const edu = await request(app).post('/api/v1/workers/me/education').set(auth(w.token)).send({ level: 'DIPLOMA', field: 'Mechanics' });
    const id = edu.body.profile.education[0].id;
    const up = await request(app).post(`/api/v1/workers/me/education/${id}/document`).set(auth(w.token)).attach('file', PDF, 'diploma.pdf');
    expect(up.status).toBe(201);
    const url = up.body.profile.education[0].documentUrl as string;
    expect(url).toMatch(/^\/api\/v1\/files\//);

    expect((await request(app).get(url).set(auth(w.token))).status).toBe(200);
    expect((await request(app).get(url).set(auth(e.token))).status).toBe(403); // has not applied yet
    const jobId = await liveJob(e);
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
    expect((await request(app).get(url).set(auth(e.token))).status).toBe(200);
    expect((await request(app).get(url).set(auth(other.token))).status).toBe(403); // a different employer
    // A file that is not a PDF/JPG/PNG is refused, and someone else's row cannot be used.
    expect((await request(app).post(`/api/v1/workers/me/education/${id}/document`).set(auth(w.token)).attach('file', Buffer.from('MZ not a document'), 'x.exe')).status).toBe(415);
    const stranger = await worker(`Stranger ${tag()}`);
    expect((await request(app).post(`/api/v1/workers/me/education/${id}/document`).set(auth(stranger.token)).attach('file', PDF, 'd.pdf')).status).toBe(404);
  });
});

describe('automatic application settings', () => {
  it('are off by default, opt-in, bounded, and for job seekers only', async () => {
    const w = await worker(`Set ${tag()}`);
    const e = await signUp('EMPLOYER');
    const get = await request(app).get('/api/v1/notifications/settings').set(auth(w.token));
    expect(get.body).toMatchObject({ autoApply: false, autoApplyMinScore: 80 });
    const on = await request(app).patch('/api/v1/notifications/settings').set(auth(w.token)).send({ autoApply: true, autoApplyMinScore: 70 });
    expect(on.body).toMatchObject({ autoApply: true, autoApplyMinScore: 70 });
    for (const bad of [{ autoApplyMinScore: 49 }, { autoApplyMinScore: 101 }, { autoApplyMinScore: 80.5 }]) {
      expect((await request(app).patch('/api/v1/notifications/settings').set(auth(w.token)).send(bad)).status).toBe(400);
    }
    expect((await request(app).patch('/api/v1/notifications/settings').set(auth(e.token)).send({ autoApply: true })).status).toBe(400);
  });
});

describe('match alerts, automatic application and "not selected" reasons', () => {
  it('tells the employer how many match, applies for opted-in workers, alerts the others, and skips workers who miss the required skill', async () => {
    const e = await signUp('EMPLOYER');
    const eUser = e.id;
    const optedIn = await worker(`Auto ${tag()}`);
    const alertOnly = await worker(`Alert ${tag()}`);
    const wrongSkill = await worker(`Wrong ${tag()}`, guardId);
    await request(app).patch('/api/v1/notifications/settings').set(auth(optedIn.token)).send({ autoApply: true, autoApplyMinScore: 50 });

    const jobId = await liveJob(e);

    const employerNote = await notificationsOf(eUser, 'job.matches');
    expect(employerNote).toHaveLength(1);
    const payload = employerNote[0].payload as { matching: number; jobId: string };
    expect(payload.jobId).toBe(jobId);
    expect(payload.matching).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(employerNote[0].payload)).not.toMatch(/phone|fullName|Auto |Alert /); // a count only

    const app1 = await prisma.application.findFirst({ where: { jobId, workerId: optedIn.profileId } });
    expect(app1?.autoApplied).toBe(true);
    expect((await notificationsOf(optedIn.id, 'application.auto'))[0]?.payload).toMatchObject({ jobId, organizationName: expect.any(String), score: expect.any(Number) });
    // The employer sees it as an ordinary received application, marked as automatic.
    expect((await notificationsOf(eUser, 'application.received'))[0].payload).toMatchObject({ autoApplied: true });

    expect(await prisma.application.count({ where: { jobId, workerId: alertOnly.profileId } })).toBe(0);
    const alert = await notificationsOf(alertOnly.id, 'job.recommended');
    expect(alert[0].payload).toMatchObject({ jobId, organizationName: expect.any(String), score: expect.any(Number) });

    expect(await prisma.application.count({ where: { jobId, workerId: wrongSkill.profileId } })).toBe(0);
    expect(await notificationsOf(wrongSkill.id, 'job.recommended')).toHaveLength(0);

    // Tracking: the worker sees the automatic application and whether they qualify.
    const mine = await request(app).get('/api/v1/applications/mine').set(auth(optedIn.token));
    expect(mine.body.items[0]).toMatchObject({ autoApplied: true, qualified: true });
  });

  it('does not apply for a worker whose own threshold is higher than their match', async () => {
    const e = await signUp('EMPLOYER');
    const picky = await worker(`Picky ${tag()}`);
    await request(app).patch('/api/v1/notifications/settings').set(auth(picky.token)).send({ autoApply: true, autoApplyMinScore: 100 });
    const jobId = await liveJob(e);
    const r = await prisma.application.count({ where: { jobId, workerId: picky.profileId } });
    expect(r).toBe(0);
  });

  it('explains a rejection with the unmet requirements, and the profile stays available', async () => {
    const e = await signUp('EMPLOYER');
    const w = await worker(`Rej ${tag()}`, guardId); // lacks the required driving skill
    const jobId = await liveJob(e);
    const applied = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    expect(applied.status).toBe(201);
    const appId = applied.body.application?.id ?? applied.body.id ?? (await prisma.application.findFirstOrThrow({ where: { jobId, workerId: w.profileId } })).id;
    const res = await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status: 'REJECTED', note: 'Position needs a driving licence' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const note = (await notificationsOf(w.id, 'application.status')).find((n) => (n.payload as { status: string }).status === 'REJECTED');
    const p = note!.payload as { reasons: string[]; otherMatches: number };
    expect(p.reasons.join(' ')).toMatch(/Required skills not on your profile/);
    expect(typeof p.otherMatches).toBe('number');
    const profile = await prisma.workerProfile.findUniqueOrThrow({ where: { id: w.profileId }, select: { isVisible: true } });
    expect(profile.isVisible).toBe(true);
    const mine = await request(app).get('/api/v1/applications/mine').set(auth(w.token));
    expect(mine.body.items[0].qualified).toBe(false);
  });
});
