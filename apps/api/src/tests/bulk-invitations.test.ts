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
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Bulk ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}
const profileId = async (u: User) => (await prisma.workerProfile.findFirstOrThrow({ where: { userId: u.id } })).id;

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
    title: `Mechanic ${tag()}`, description: `Workshop role for the bulk invitation test. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE', skills: [{ skillId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}

describe('invite several workers at once', () => {
  it('invites everyone it can, tells the employer why each other person was skipped, and notifies the workers', async () => {
    const e = await signUp('EMPLOYER');
    const [a, b, applied, hidden] = [await signUp('WORKER'), await signUp('WORKER'), await signUp('WORKER'), await signUp('WORKER')];
    const jobId = await liveJob(e);
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(applied.token)).send({})).status).toBe(201);
    await prisma.workerProfile.update({ where: { id: await profileId(hidden) }, data: { isVisible: false } });
    const ids = [await profileId(a), await profileId(b), await profileId(applied), await profileId(hidden), randomUUID()];

    const res = await request(app).post(`/api/v1/jobs/${jobId}/invitations/bulk`).set(auth(e.token)).send({ workerIds: ids, message: 'We would like you to apply.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ sent: 2, failed: 3 });
    const by = Object.fromEntries(res.body.results.map((r: { workerId: string; sent: boolean; reason?: string }) => [r.workerId, r]));
    expect(by[ids[0]].sent).toBe(true);
    expect(by[ids[1]].sent).toBe(true);
    expect(by[ids[2]].reason).toMatch(/already applied/i);
    expect(by[ids[3]].reason).toMatch(/not found/i);
    expect(by[ids[4]].reason).toMatch(/not found/i);

    expect(await prisma.jobInvitation.count({ where: { jobId } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: a.id, type: 'job.invitation' } })).toBe(1);

    // sending again skips people who are already invited and does not duplicate anything
    const again = await request(app).post(`/api/v1/jobs/${jobId}/invitations/bulk`).set(auth(e.token)).send({ workerIds: [ids[0], ids[1]] });
    expect(again.body).toMatchObject({ sent: 0, failed: 2 });
    expect(await prisma.jobInvitation.count({ where: { jobId } })).toBe(2);
  });

  it('stops and explains when the monthly plan limit is reached', async () => {
    const e = await signUp('EMPLOYER');
    const w1 = await signUp('WORKER');
    const w2 = await signUp('WORKER');
    const w3 = await signUp('WORKER');
    const jobId = await liveJob(e);
    const org = (await prisma.employerProfile.findFirstOrThrow({ where: { userId: e.id } })).organizationId;
    const plan = await prisma.subscriptionPlan.create({ data: { slug: `bulk-${tag()}`, name: 'TEST Tiny', priceEtbMonthly: 0, maxInvitationsPerMonth: 1, canSearchWorkers: true } });
    await prisma.subscription.create({ data: { organizationId: org, planId: plan.id } });
    try {
      const res = await request(app).post(`/api/v1/jobs/${jobId}/invitations/bulk`).set(auth(e.token)).send({ workerIds: [await profileId(w1), await profileId(w2), await profileId(w3)] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ sent: 1, failed: 2 });
      expect(res.body.results[1].reason).toMatch(/plan allows 1 invitations/);
      expect(res.body.results[2].reason).toBe(res.body.results[1].reason);
    } finally {
      await prisma.subscription.deleteMany({ where: { organizationId: org } });
      await prisma.subscriptionPlan.delete({ where: { id: plan.id } });
    }
  });

  it('validates input and is for employers who own the job', async () => {
    const e = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const jobId = await liveJob(e);
    const post = (t: string, body: object, id = jobId) => request(app).post(`/api/v1/jobs/${id}/invitations/bulk`).set(auth(t)).send(body);
    expect((await post(e.token, { workerIds: [] })).status).toBe(400);
    expect((await post(e.token, { workerIds: Array.from({ length: 21 }, () => randomUUID()) })).status).toBe(400);
    expect((await post(e.token, { workerIds: ['nope'] })).status).toBe(400);
    expect((await post(w.token, { workerIds: [randomUUID()] })).status).toBe(403);
    const foreign = await post(other.token, { workerIds: [randomUUID()] });
    expect(foreign.body.sent ?? 0).toBe(0);
    expect(await prisma.jobInvitation.count({ where: { jobId } })).toBe(0);
  });
});
