import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { uploadRoot } from '../modules/files/storage';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}
type User = { token: string; id: string; phone: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const phone = newPhone();
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Apps ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}

let categoryId = '';
let adamaId = '';
let skillIds: string[] = [];
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function liveJob(e: User, over: Record<string, unknown> = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Mechanic ${tag()}`, description: `Repair vehicles in our garage. ${randomUUID()} ${randomUUID()} Reliable people only, please apply with your experience.`,
    categoryId, employmentType: 'FULL_TIME', locationId: adamaId, deadline: future(30),
    skills: [{ skillId: skillIds[0], importance: 'REQUIRED' }, { skillId: skillIds[1], importance: 'REQUIRED' }, { skillId: skillIds[2], importance: 'PREFERRED' }],
    ...over,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const id = create.body.job.id as string;
  const pub = await request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({});
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return id;
}
const apply = (w: User, jobId: string, body: Record<string, unknown> = {}) => request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send(body);
const setStatus = (e: User, appId: string, status: string, note?: string) => request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status, note });
const mine = async (w: User) => (await request(app).get('/api/v1/applications/mine').set(auth(w.token))).body.items as { id: string; status: string; interviews: { id: string }[]; history: { to: string }[] }[];
const unread = async (u: User) => (await request(app).get('/api/v1/notifications').set(auth(u.token))).body;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { level: 'ZONE', nameEn: 'Adama' } })).id;
  skillIds = (await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems', 'welding'] } }, orderBy: { slug: 'asc' } })).map((s) => s.id);
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const files = await prisma.fileAsset.findMany({ where: { ownerId: { in: ids } } });
  for (const f of files) fs.rmSync(path.join(uploadRoot, f.storagePath), { force: true });
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } }); // cascades applications
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('applying', () => {
  it('lets a worker apply once and notifies the employer', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);
    const r = await apply(w, job, { coverNote: 'I have 5 years of experience.' });
    expect(r.status).toBe(201);
    expect((await apply(w, job)).status).toBe(409);
    expect((await mine(w))[0]).toMatchObject({ status: 'PENDING' });
    const n = await unread(e);
    expect(n.unread).toBe(1);
    expect(n.items[0].type).toBe('application.received');
    expect(n.items[0].payload.applicationId).toBe(r.body.applicationId);
  });

  it('is only for signed-in workers, on open jobs, with valid input', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);
    expect((await request(app).post(`/api/v1/jobs/${job}/apply`).send({})).status).toBe(401);
    expect((await request(app).post(`/api/v1/jobs/${job}/apply`).set(auth(e.token)).send({})).status).toBe(403);
    expect((await apply(w, job, { coverNote: 'x'.repeat(1501) })).status).toBe(400);
    expect((await apply(w, job, { status: 'ACCEPTED' })).status).toBe(400);
    expect((await apply(w, '00000000-0000-4000-8000-000000000000')).status).toBe(404);

    const draft = (await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
      title: `Draft ${tag()}`, description: 'A draft job that is not published yet and should not accept applications at all.', categoryId, employmentType: 'FULL_TIME', locationId: adamaId,
    })).body.job.id;
    expect((await apply(w, draft)).status).toBe(404);

    const closed = await liveJob(e);
    await request(app).post(`/api/v1/jobs/${closed}/close`).set(auth(e.token)).send({});
    expect((await apply(w, closed)).status).toBe(404);

    const expired = await liveJob(e);
    await prisma.job.update({ where: { id: expired }, data: { deadline: new Date(Date.now() - 3600_000) } });
    expect((await apply(w, expired)).status).toBe(404);
  });

  it('enforces a daily application limit', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const ep = await prisma.employerProfile.findUniqueOrThrow({ where: { userId: e.id } });
    const worker = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } });
    const jobs = Array.from({ length: 30 }, () => ({
      id: randomUUID(), organizationId: ep.organizationId, postedById: e.id, title: `Bulk ${tag()}`, description: 'bulk job for the application limit test', categoryId,
      employmentType: 'FULL_TIME' as const, status: 'ACTIVE' as const, descriptionHash: randomUUID(),
    }));
    await prisma.job.createMany({ data: jobs });
    await prisma.application.createMany({ data: jobs.map((j) => ({ jobId: j.id, workerId: worker.id })) });
    // 30 open jobs is above the default plan's limit; this test is about applications, so use the unlimited plan.
    await prisma.subscription.create({ data: { organizationId: ep.organizationId, planId: (await prisma.subscriptionPlan.findFirstOrThrow({ where: { slug: 'premium' } })).id } });
    const extra = await liveJob(e);
    expect((await apply(w, extra)).status).toBe(429);
  });
});

describe('tracking and withdrawing', () => {
  it('records history, lets the worker withdraw, and allows re-applying only after a withdrawal', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const other = await signUp('WORKER');
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;

    expect((await request(app).post(`/api/v1/applications/${appId}/withdraw`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).post(`/api/v1/applications/${appId}/withdraw`).set(auth(e.token))).status).toBe(403);

    expect((await request(app).post(`/api/v1/applications/${appId}/withdraw`).set(auth(w.token))).status).toBe(204);
    const list = await mine(w);
    expect(list[0].status).toBe('WITHDRAWN');
    expect(list[0].history.map((h) => h.to)).toEqual(['PENDING', 'WITHDRAWN']);
    expect((await request(app).post(`/api/v1/applications/${appId}/withdraw`).set(auth(w.token))).status).toBe(409);
    expect((await unread(e)).items.some((n: { type: string }) => n.type === 'application.withdrawn')).toBe(true);

    const again = await apply(w, job);
    expect(again.status).toBe(201);
    expect(again.body.applicationId).toBe(appId); // same row, history kept
    expect((await mine(w))[0].history.map((h) => h.to)).toEqual(['PENDING', 'WITHDRAWN', 'PENDING']);

    await setStatus(e, appId, 'REJECTED');
    expect((await apply(w, job)).status).toBe(409); // rejected applicants cannot reapply
    expect((await request(app).post(`/api/v1/applications/${appId}/withdraw`).set(auth(w.token))).status).toBe(409);
  });
});

describe('employer review workflow', () => {
  it('lists applicants with counts, hides phones until shortlisting, and isolates other employers', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;

    let list = await request(app).get(`/api/v1/jobs/${job}/applications`).set(auth(e.token));
    expect(list.status).toBe(200);
    expect(list.body.counts).toEqual({ PENDING: 1 });
    expect(list.body.items[0].candidate.phone).toBeNull();
    expect(JSON.stringify(list.body)).not.toContain(w.phone);
    expect(list.body.items[0].allowedNext).toEqual(['UNDER_REVIEW', 'SHORTLISTED', 'REJECTED']);

    const stranger = await signUp('EMPLOYER');
    expect((await request(app).get(`/api/v1/jobs/${job}/applications`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).get(`/api/v1/applications/${appId}`).set(auth(stranger.token))).status).toBe(404);
    expect((await setStatus(stranger, appId, 'SHORTLISTED')).status).toBe(404);
    expect((await request(app).get(`/api/v1/jobs/${job}/applications`).set(auth(w.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/jobs/${job}/applications?status=BOGUS`).set(auth(e.token))).status).toBe(400);

    await setStatus(e, appId, 'SHORTLISTED');
    list = await request(app).get(`/api/v1/jobs/${job}/applications?status=SHORTLISTED`).set(auth(e.token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].candidate.phone).toBe(w.phone);
    expect((await request(app).get(`/api/v1/jobs/${job}/applications?status=PENDING`).set(auth(e.token))).body.items).toHaveLength(0);
  });

  it('enforces the status machine and notifies the worker', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;

    const skip = await setStatus(e, appId, 'ACCEPTED');
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');
    expect((await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status: 'INTERVIEW_SCHEDULED' })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(w.token)).send({ status: 'ACCEPTED' })).status).toBe(403);

    expect((await setStatus(e, appId, 'UNDER_REVIEW')).status).toBe(200);
    expect((await setStatus(e, appId, 'SHORTLISTED', 'Strong experience')).status).toBe(200);
    expect((await setStatus(e, appId, 'ACCEPTED')).status).toBe(200);
    expect((await setStatus(e, appId, 'REJECTED')).status).toBe(409); // accepted is final

    const history = (await mine(w))[0].history.map((h) => h.to);
    expect(history).toEqual(['PENDING', 'UNDER_REVIEW', 'SHORTLISTED', 'ACCEPTED']);
    const n = await unread(w);
    expect(n.items.filter((x: { type: string }) => x.type === 'application.status')).toHaveLength(3);
    expect(n.items[0].payload.status).toBe('ACCEPTED');
  });

  it('schedules and cancels interviews with the right status changes', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;
    const book = (body: Record<string, unknown>) => request(app).post(`/api/v1/applications/${appId}/interviews`).set(auth(e.token)).send(body);

    expect((await book({ scheduledAt: inHours(48), mode: 'PHONE' })).status).toBe(409); // still pending
    await setStatus(e, appId, 'SHORTLISTED');
    expect((await book({ scheduledAt: inHours(-2), mode: 'PHONE' })).status).toBe(400);
    expect((await book({ scheduledAt: inHours(48), mode: 'TELEPATHY' })).status).toBe(400);

    const ok = await book({ scheduledAt: inHours(48), mode: 'IN_PERSON', locationOrLink: 'Adama garage, Bole road' });
    expect(ok.status).toBe(201);
    expect(ok.body.application.status).toBe('INTERVIEW_SCHEDULED');
    const second = await book({ scheduledAt: inHours(72), mode: 'VIDEO', locationOrLink: 'https://meet.example.com/x' });
    expect(second.body.interviews).toHaveLength(2);

    const seen = (await mine(w))[0];
    expect(seen.status).toBe('INTERVIEW_SCHEDULED');
    expect(seen.interviews).toHaveLength(2);
    expect((await unread(w)).items.some((n: { type: string }) => n.type === 'interview.scheduled')).toBe(true);

    const [i1, i2] = second.body.interviews as { id: string }[];
    const cancelOne = await request(app).delete(`/api/v1/applications/${appId}/interviews/${i1.id}`).set(auth(e.token));
    expect(cancelOne.body.application.status).toBe('INTERVIEW_SCHEDULED');
    const cancelLast = await request(app).delete(`/api/v1/applications/${appId}/interviews/${i2.id}`).set(auth(e.token));
    expect(cancelLast.body.application.status).toBe('SHORTLISTED');
    expect((await request(app).delete(`/api/v1/applications/${appId}/interviews/${i2.id}`).set(auth(e.token))).status).toBe(404);
  });

  it('cancels open interviews when the application is accepted, rejected or withdrawn', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;
    await setStatus(e, appId, 'SHORTLISTED');
    await request(app).post(`/api/v1/applications/${appId}/interviews`).set(auth(e.token)).send({ scheduledAt: inHours(24), mode: 'PHONE' });
    await setStatus(e, appId, 'REJECTED');
    expect(await prisma.interview.count({ where: { applicationId: appId, status: 'SCHEDULED' } })).toBe(0);
  });

  it('shows hidden-profile applicants but keeps the contact number private until shortlisting', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ isVisible: false, headline: 'Quiet mechanic' });
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;
    const view = await request(app).get(`/api/v1/applications/${appId}`).set(auth(e.token));
    expect(view.status).toBe(200);
    expect(view.body.profile.headline).toBe('Quiet mechanic');
    expect(view.body.profile.contact).toBeNull();
    await setStatus(e, appId, 'SHORTLISTED');
    const after = await request(app).get(`/api/v1/applications/${appId}`).set(auth(e.token));
    expect(after.body.profile.contact).toEqual({ phone: w.phone });
  });

  it('reports which of the job skills a candidate holds', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    await request(app).put(`/api/v1/workers/me/skills/${skillIds[0]}`).set(auth(w.token)).send({ proficiency: 4 });
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;
    const view = await request(app).get(`/api/v1/applications/${appId}`).set(auth(e.token));
    const held = view.body.skillOverlap.filter((s: { has: boolean }) => s.has);
    expect(held).toHaveLength(1);
    expect(view.body.skillOverlap).toHaveLength(3);
  });
});

describe('CV access for employers', () => {
  it('opens the CV only to employers the worker applied to, and closes it on withdrawal', async () => {
    const e = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    await request(app).post('/api/v1/workers/me/cv').set(auth(w.token)).attach('file', PDF, 'cv.pdf');
    const own = await request(app).get('/api/v1/workers/me').set(auth(w.token));
    const cvUrl = own.body.profile.cvUrl as string;

    expect((await request(app).get(cvUrl).set(auth(e.token))).status).toBe(403); // has not applied yet
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;
    expect((await request(app).get(cvUrl).set(auth(e.token))).status).toBe(200);
    expect((await request(app).get(cvUrl).set(auth(other.token))).status).toBe(403);
    const view = await request(app).get(`/api/v1/applications/${appId}`).set(auth(e.token));
    expect(view.body.cvUrl).toBe(cvUrl);

    await request(app).post(`/api/v1/applications/${appId}/withdraw`).set(auth(w.token));
    expect((await request(app).get(cvUrl).set(auth(e.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/applications/${appId}`).set(auth(e.token))).body.cvUrl).toBeNull();
  });
});

describe('comparing candidates', () => {
  it('compares 2 to 4 applicants of the same job only', async () => {
    const e = await signUp('EMPLOYER');
    const stranger = await signUp('EMPLOYER');
    const [w1, w2] = [await signUp('WORKER'), await signUp('WORKER')];
    const job = await liveJob(e);
    const job2 = await liveJob(e);
    const a1 = (await apply(w1, job)).body.applicationId;
    const a2 = (await apply(w2, job)).body.applicationId;
    const b1 = (await apply(w1, job2)).body.applicationId;
    const cmp = (ids: string[], u = e) => request(app).get(`/api/v1/applications/compare?ids=${ids.join(',')}`).set(auth(u.token));

    const ok = await cmp([a1, a2]);
    expect(ok.status).toBe(200);
    expect(ok.body.columns.map((c: { applicationId: string }) => c.applicationId)).toEqual([a1, a2]);
    expect(ok.body.requiredSkills).toHaveLength(2);
    expect((await cmp([a1])).status).toBe(400);
    expect((await cmp([a1, a1])).status).toBe(400);
    expect((await cmp([a1, 'nope'])).status).toBe(400);
    expect((await cmp([a1, b1])).status).toBe(400); // different jobs
    expect((await cmp([a1, a2], stranger)).status).toBe(404);
    expect((await cmp([a1, a2], w1)).status).toBe(403);
  });
});

describe('saved jobs', () => {
  it('saves, lists, flags closed jobs and reports state on the job page', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);

    expect((await request(app).put(`/api/v1/jobs/${job}/save`).set(auth(w.token))).status).toBe(204);
    expect((await request(app).put(`/api/v1/jobs/${job}/save`).set(auth(w.token))).status).toBe(204); // idempotent
    expect((await request(app).put(`/api/v1/jobs/${job}/save`).set(auth(e.token))).status).toBe(403);
    expect((await request(app).put('/api/v1/jobs/00000000-0000-4000-8000-000000000000/save').set(auth(w.token))).status).toBe(404);

    const detail = await request(app).get(`/api/v1/jobs/${job}`).set(auth(w.token));
    expect(detail.body.viewer).toEqual({ application: null, saved: true });
    await apply(w, job);
    const detail2 = await request(app).get(`/api/v1/jobs/${job}`).set(auth(w.token));
    expect(detail2.body.viewer.application.status).toBe('PENDING');
    expect((await request(app).get(`/api/v1/jobs/${job}`)).body.viewer).toBeNull();

    let list = (await request(app).get('/api/v1/saved-jobs').set(auth(w.token))).body.items;
    expect(list).toHaveLength(1);
    expect(list[0].job.open).toBe(true);
    await request(app).post(`/api/v1/jobs/${job}/close`).set(auth(e.token)).send({});
    list = (await request(app).get('/api/v1/saved-jobs').set(auth(w.token))).body.items;
    expect(list[0].job.open).toBe(false);

    expect((await request(app).delete(`/api/v1/jobs/${job}/save`).set(auth(w.token))).status).toBe(204);
    expect((await request(app).get('/api/v1/saved-jobs').set(auth(w.token))).body.items).toHaveLength(0);
  });
});

describe('notifications and summaries', () => {
  it('lets users read only their own notifications', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);
    // Publishing may already tell the employer how many workers match (job.matches); this test is about applications.
    await request(app).post('/api/v1/notifications/read-all').set(auth(e.token));
    await apply(w, job);
    const n = await unread(e);
    expect(n.unread).toBe(1);
    expect((await request(app).post(`/api/v1/notifications/${n.items[0].id}/read`).set(auth(w.token))).status).toBe(404);
    expect((await request(app).post(`/api/v1/notifications/${n.items[0].id}/read`).set(auth(e.token))).status).toBe(204);
    expect((await unread(e)).unread).toBe(0);
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
    await apply(await signUp('WORKER'), job);
    await apply(await signUp('WORKER'), job);
    expect((await unread(e)).unread).toBe(2);
    expect((await request(app).post('/api/v1/notifications/read-all').set(auth(e.token))).status).toBe(204);
    expect((await unread(e)).unread).toBe(0);
  });

  it('summarizes applications for each role', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e);
    const appId = (await apply(w, job)).body.applicationId;
    await setStatus(e, appId, 'SHORTLISTED');
    await request(app).post(`/api/v1/applications/${appId}/interviews`).set(auth(e.token)).send({ scheduledAt: inHours(24), mode: 'PHONE' });
    await request(app).put(`/api/v1/jobs/${job}/save`).set(auth(w.token));

    const ws = await request(app).get('/api/v1/applications/summary').set(auth(w.token));
    expect(ws.body).toEqual({ applications: { INTERVIEW_SCHEDULED: 1 }, saved: 1, upcomingInterviews: 1 });
    const es = await request(app).get('/api/v1/applications/summary').set(auth(e.token));
    expect(es.body).toEqual({ applications: { INTERVIEW_SCHEDULED: 1 }, activeJobs: 1, upcomingInterviews: 1 });
  });
});
