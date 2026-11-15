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
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Saved ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let transportId = '';
let hospitalityId = '';

beforeAll(async () => {
  transportId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  hospitalityId = (await prisma.category.findFirstOrThrow({ where: { slug: { not: 'transport' } } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

async function publish(e: User, title: string, categoryId: string) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title, description: `A role for the saved search test. ${randomUUID()} ${randomUUID()} Please apply with references.`,
    categoryId, employmentType: 'PART_TIME', deadline: future(30), workMode: 'REMOTE',
    skills: [{ skillId: (await prisma.skill.findFirstOrThrow({ where: { categoryId } })).id, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const pub = await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({});
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return create.body.job.id as string;
}

describe('saved searches', () => {
  it('saves, lists, renames, switches alerts off and deletes, for the owner only', async () => {
    const w = await signUp('WORKER');
    const other = await signUp('WORKER');
    const made = await request(app).post('/api/v1/saved-searches').set(auth(w.token)).send({ name: 'Part-time driving', filters: { categoryId: transportId, type: 'PART_TIME' } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.item.alertsEnabled).toBe(true);
    expect(made.body.item.filters).toEqual({ categoryId: transportId, type: 'PART_TIME' });

    const list = await request(app).get('/api/v1/saved-searches').set(auth(w.token));
    expect(list.body.items).toHaveLength(1);
    expect((await request(app).get('/api/v1/saved-searches').set(auth(other.token))).body.items).toHaveLength(0);

    const id = made.body.item.id;
    expect((await request(app).patch(`/api/v1/saved-searches/${id}`).set(auth(other.token)).send({ name: 'x' })).status).toBe(404);
    const patched = await request(app).patch(`/api/v1/saved-searches/${id}`).set(auth(w.token)).send({ name: 'Driving', alertsEnabled: false });
    expect(patched.body.item).toMatchObject({ name: 'Driving', alertsEnabled: false });
    expect((await request(app).delete(`/api/v1/saved-searches/${id}`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/saved-searches/${id}`).set(auth(w.token))).status).toBe(204);
  });

  it('rejects an empty search, invalid filters, employers and the 11th search', async () => {
    const w = await signUp('WORKER');
    const post = (body: object, t = w.token) => request(app).post('/api/v1/saved-searches').set(auth(t)).send(body);
    expect((await post({ name: 'Nothing', filters: {} })).status).toBe(400);
    expect((await post({ name: 'Bad', filters: { type: 'NOT_A_TYPE' } })).status).toBe(400);
    expect((await post({ name: 'Ok', filters: { q: 'x' } }, (await signUp('EMPLOYER')).token)).status).toBe(403);
    for (let i = 0; i < 10; i++) expect((await post({ name: `S${i}`, filters: { q: `word${i}` } })).status).toBe(201);
    expect((await post({ name: 'Eleventh', filters: { q: 'more' } })).status).toBe(409);
  });

  it('alerts a worker once when a new job matches a saved search, and not when it does not or alerts are off', async () => {
    const e = await signUp('EMPLOYER');
    const hit = await signUp('WORKER');
    const miss = await signUp('WORKER');
    const off = await signUp('WORKER');
    const optedOut = await signUp('WORKER');
    const save = (u: User, name: string, filters: object) => request(app).post('/api/v1/saved-searches').set(auth(u.token)).send({ name, filters }).then((r) => r.body.item);
    const word = tag();
    // "hit" has two searches that both match: still only one alert
    await save(hit, 'By category', { categoryId: transportId });
    await save(hit, 'By word', { q: word });
    await save(miss, 'Other category', { categoryId: hospitalityId });
    const offSearch = await save(off, 'Muted', { categoryId: transportId });
    await request(app).patch(`/api/v1/saved-searches/${offSearch.id}`).set(auth(off.token)).send({ alertsEnabled: false });
    await save(optedOut, 'Opted out', { categoryId: transportId });
    await prisma.user.update({ where: { id: optedOut.id }, data: { notifyJobMatches: false } });

    const jobId = await publish(e, `Delivery driver ${word}`, transportId);

    const alertsOf = (u: User) => prisma.notification.findMany({ where: { userId: u.id, type: 'search.match' } });
    const got = await alertsOf(hit);
    expect(got).toHaveLength(1);
    expect(got[0].payload).toMatchObject({ jobId });
    expect(await alertsOf(miss)).toHaveLength(0);
    expect(await alertsOf(off)).toHaveLength(0);
    expect(await alertsOf(optedOut)).toHaveLength(0);
    expect((await prisma.savedSearch.findFirstOrThrow({ where: { userId: hit.id, name: 'By category' } })).lastAlertedAt).not.toBeNull();
  });
});
