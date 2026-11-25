import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const PASSWORD = 'Passw0rdTest';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}
async function makeAdmin(adminLevel: 'FULL' | 'MODERATOR' | 'AUDITOR' = 'FULL') {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: `Insight Admin ${randomUUID().slice(0, 4)}`, phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', adminLevel } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: PASSWORD });
  return { token: login.body.accessToken as string, id: u.id };
}
async function worker(name = 'Insight Worker') {
  const phone = newPhone();
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: name, phone, password: PASSWORD, role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  expect(res.status).toBe(201);
  return { id: res.body.user.id as string };
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.$disconnect();
});

describe('admin insights', () => {
  it('returns a zero-filled daily trend that includes a new sign-up', async () => {
    const admin = await makeAdmin();
    await worker();
    const res = await request(app).get('/api/v1/admin/insights/trends?days=7').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(7);
    expect(res.body.points.reduce((n: number, p: { signups: number }) => n + p.signups, 0)).toBeGreaterThan(0);
    expect((await request(app).get('/api/v1/admin/insights/trends?days=5').set(auth(admin.token))).status).toBe(400);
  });

  it('lists what needs attention and the newest activity', async () => {
    const admin = await makeAdmin();
    const a = await request(app).get('/api/v1/admin/insights/attention').set(auth(admin.token));
    expect(a.status).toBe(200);
    expect(a.body.items.length).toBeGreaterThan(0);
    expect(a.body.items[0]).toHaveProperty('to');
    const r = await request(app).get('/api/v1/admin/insights/recent').set(auth(admin.token));
    expect(r.status).toBe(200);
    expect(r.body.users[0]).not.toHaveProperty('phone');
  });

  it('searches users by name and ignores very short queries', async () => {
    const admin = await makeAdmin();
    const w = await worker('Zebulon Searchable');
    const hit = await request(app).get('/api/v1/admin/search?q=Zebulon').set(auth(admin.token));
    expect(hit.body.users.some((u: { id: string }) => u.id === w.id)).toBe(true);
    const short = await request(app).get('/api/v1/admin/search?q=z').set(auth(admin.token));
    expect(short.body.users).toEqual([]);
  });

  it('suspends several accounts at once and reports the ones it skipped', async () => {
    const admin = await makeAdmin();
    const [a, b] = [await worker(), await worker()];
    const bad = await request(app).post('/api/v1/admin/users/bulk-status').set(auth(admin.token)).send({ ids: [a.id], status: 'SUSPENDED' });
    expect(bad.status).toBe(400);
    const res = await request(app).post('/api/v1/admin/users/bulk-status').set(auth(admin.token)).send({ ids: [a.id, b.id, admin.id], status: 'SUSPENDED', reason: 'Testing bulk' });
    expect(res.status).toBe(200);
    expect(res.body.changed.sort()).toEqual([a.id, b.id].sort());
    expect(res.body.skipped.map((s: { id: string }) => s.id)).toEqual([admin.id]);
    expect((await prisma.user.findUnique({ where: { id: a.id } }))?.status).toBe('SUSPENDED');
  });

  it('exports lists as CSV for full administrators only', async () => {
    const full = await makeAdmin();
    const moderator = await makeAdmin('MODERATOR');
    const ok = await request(app).get('/api/v1/admin/export/users').set(auth(full.token));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('text/csv');
    expect(ok.text).toContain('name,phone,email,role');
    expect((await request(app).get('/api/v1/admin/export/users').set(auth(moderator.token))).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/users/bulk-status').set(auth(moderator.token)).send({ ids: [full.id], status: 'SUSPENDED', reason: 'x y z' })).status).toBe(403);
  });
});
