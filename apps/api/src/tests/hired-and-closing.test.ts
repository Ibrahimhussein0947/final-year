import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { today } from '../modules/offers/service';
import { closeExpiredJobs } from '../modules/hiring/availability';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const dayFrom = (d: number) => new Date(today().getTime() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Hired ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let transportId = ''; let heavyId = ''; let adamaId = '';
beforeAll(async () => {
  transportId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  heavyId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG Hired' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG Hired' } } });
  await prisma.$disconnect();
});

/** An employer, a worker, and the worker's application at the given status. */
async function setup(finalStatus: 'PENDING' | 'ACCEPTED' = 'ACCEPTED') {
  const e = await signUp('EMPLOYER');
  const w = await signUp('WORKER');
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: transportId, headline: 'Driver', yearsExperience: 6, availability: 'IMMEDIATELY', locationId: adamaId });
  await request(app).put(`/api/v1/workers/me/skills/${heavyId}`).set(auth(w.token)).send({ proficiency: 4 });
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Driver ${tag()}`, description: `We need a heavy truck driver for regional deliveries. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId: transportId, employmentType: 'FULL_TIME', deadline: future(30), locationId: adamaId, skills: [{ skillId: heavyId, importance: 'REQUIRED' }],
  });
  expect(create.status).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  const applied = await request(app).post(`/api/v1/jobs/${create.body.job.id}/apply`).set(auth(w.token)).send({});
  expect(applied.status).toBe(201);
  const appId = applied.body.applicationId as string;
  if (finalStatus === 'ACCEPTED') {
    for (const status of ['SHORTLISTED', 'ACCEPTED']) expect((await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status })).status).toBe(200);
  }
  return { e, w, appId, jobId: create.body.job.id as string };
}

const availabilityOf = async (userId: string) => (await prisma.workerProfile.findUniqueOrThrow({ where: { userId } })).availability;
const offer = (e: User, appId: string, body: object) => request(app).post(`/api/v1/applications/${appId}/offer`).set(auth(e.token)).send(body);

describe('a hired worker', () => {
  it('becomes unavailable when hired and is restored when the offer is withdrawn', async () => {
    const { e, w, appId } = await setup();
    expect(await availabilityOf(w.id)).toBe('NOT_AVAILABLE');
    const made = await offer(e, appId, { startDate: dayFrom(10) });
    expect(made.status).toBe(201);
    expect((await request(app).post(`/api/v1/offers/${made.body.offer.id}/withdraw`).set(auth(e.token)).send({})).status).toBe(200);
    expect(await availabilityOf(w.id)).toBe('IMMEDIATELY');
  });

  it('is restored when the worker declines the offer', async () => {
    const { e, w, appId } = await setup();
    const made = await offer(e, appId, { startDate: dayFrom(10) });
    expect((await request(app).post(`/api/v1/offers/${made.body.offer.id}/respond`).set(auth(w.token)).send({ accept: false })).status).toBe(200);
    expect(await availabilityOf(w.id)).toBe('IMMEDIATELY');
  });

  it('stays unavailable when the offer is accepted, and a manual choice replaces the saved value', async () => {
    const { e, w, appId } = await setup();
    const made = await offer(e, appId, { startDate: dayFrom(10) });
    expect((await request(app).post(`/api/v1/offers/${made.body.offer.id}/respond`).set(auth(w.token)).send({ accept: true })).status).toBe(200);
    expect(await availabilityOf(w.id)).toBe('NOT_AVAILABLE');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ availability: 'FLEXIBLE' });
    expect((await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } })).availabilityBeforeHire).toBeNull();
  });
});

describe('closing a job after its deadline', () => {
  it('moves only expired active jobs to CLOSED', async () => {
    const { jobId } = await setup('PENDING');
    expect((await closeExpiredJobs()) >= 0).toBe(true);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('ACTIVE'); // deadline is 30 days away
    await prisma.job.update({ where: { id: jobId }, data: { deadline: new Date(Date.now() - 60_000) } });
    await closeExpiredJobs();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('CLOSED');
  });
});
