import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', org?: string): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: org ?? `TEST_ORG Views ${randomUUID().slice(0, 6)}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('who viewed my profile', () => {
  it('shows organisations (not people), counts a reload within 30 minutes once, and ignores admins and the owner', async () => {
    const worker = await signUp('WORKER');
    const other = await signUp('WORKER');
    const a = await signUp('EMPLOYER', 'TEST_ORG Alpha');
    const b = await signUp('EMPLOYER', 'TEST_ORG Beta');
    const workerId = (await prisma.workerProfile.findFirstOrThrow({ where: { userId: worker.id } })).id;

    expect((await request(app).get(`/api/v1/workers/${workerId}`).set(auth(a.token))).status).toBe(200);
    expect((await request(app).get(`/api/v1/workers/${workerId}`).set(auth(a.token))).status).toBe(200); // reload
    expect((await request(app).get(`/api/v1/workers/${workerId}`).set(auth(b.token))).status).toBe(200);

    const mine = await request(app).get('/api/v1/workers/me/views').set(auth(worker.token));
    expect(mine.status).toBe(200);
    expect(mine.body.organizations).toBe(2);
    expect(mine.body.totalViews).toBe(2);
    const names = mine.body.items.map((i: { organization: { name: string } }) => i.organization.name).sort();
    expect(names).toEqual(['TEST_ORG Alpha', 'TEST_ORG Beta']);
    // nothing that identifies the individual employer
    expect(JSON.stringify(mine.body)).not.toMatch(new RegExp(`${a.id}|${b.id}|Test EMPLOYER`));

    // 31 minutes later the same organisation counts again
    await prisma.profileView.updateMany({ where: { workerId }, data: { lastViewedAt: new Date(Date.now() - 31 * 60_000) } });
    await request(app).get(`/api/v1/workers/${workerId}`).set(auth(a.token));
    const again = await request(app).get('/api/v1/workers/me/views').set(auth(worker.token));
    expect(again.body.totalViews).toBe(3);

    // another worker sees nothing; employers cannot read the list
    expect((await request(app).get('/api/v1/workers/me/views').set(auth(other.token))).body.items).toHaveLength(0);
    expect((await request(app).get('/api/v1/workers/me/views').set(auth(a.token))).status).toBe(403);
  });
});
