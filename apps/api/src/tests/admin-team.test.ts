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
type User = { token: string; id: string; phone: string };

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}
async function makeAdmin(): Promise<User> {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: `Test Admin ${randomUUID().slice(0, 4)}`, phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: PASSWORD });
  return { token: login.body.accessToken, id: u.id, phone: u.phone };
}
async function worker(): Promise<User> {
  const phone = newPhone();
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test Worker', phone, password: PASSWORD, role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.$disconnect();
});

const create = (a: User, body: object) => request(app).post('/api/v1/admin/admins').set(auth(a.token)).send(body);

describe('administrator team', () => {
  it('is for administrators only', async () => {
    const w = await worker();
    expect((await request(app).get('/api/v1/admin/admins')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/admins').set(auth(w.token))).status).toBe(403);
    expect((await create(w, { fullName: 'Evil Admin', phone: newPhone(), password: 'LongPassw0rd', actorPassword: PASSWORD })).status).toBe(403);
  });

  it('lists administrators without password hashes', async () => {
    const a = await makeAdmin();
    const r = await request(app).get('/api/v1/admin/admins').set(auth(a.token));
    expect(r.status).toBe(200);
    expect((r.body.items as { id: string }[]).some((x) => x.id === a.id)).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('creates a new administrator who can log in and use the admin console', async () => {
    const a = await makeAdmin();
    const phone = newPhone();
    const res = await create(a, { fullName: 'New Admin', phone, password: 'AnotherLong1', actorPassword: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.admin.role).toBeUndefined();
    const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'AnotherLong1' });
    expect(login.status).toBe(200);
    // the password was chosen by someone else, so the console stays locked until the new admin replaces it
    expect((await request(app).get('/api/v1/admin/stats').set(auth(login.body.accessToken))).status).toBe(403);
    const changed = await request(app).post('/api/v1/auth/password/change').set(auth(login.body.accessToken)).send({ currentPassword: 'AnotherLong1', newPassword: 'MyOwnPassword9' });
    expect(changed.status).toBe(200);
    expect((await request(app).get('/api/v1/admin/stats').set(auth(changed.body.accessToken))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorId: a.id, action: 'admin.admin_created' } })).toBe(1);
  });

  it('needs the acting admin\'s own password, a strong new password and a new phone number', async () => {
    const a = await makeAdmin();
    const phone = newPhone();
    expect((await create(a, { fullName: 'X Admin', phone, password: 'AnotherLong1', actorPassword: 'wrong-password' })).status).toBe(403);
    expect((await create(a, { fullName: 'X Admin', phone, password: 'short1', actorPassword: PASSWORD })).status).toBe(400);
    expect((await create(a, { fullName: 'X Admin', phone, password: 'onlyletterslong', actorPassword: PASSWORD })).status).toBe(400);
    expect((await create(a, { fullName: 'X Admin', phone: 'abc', password: 'AnotherLong1', actorPassword: PASSWORD })).status).toBe(400);
    expect((await create(a, { fullName: 'X Admin', phone, password: 'AnotherLong1', actorPassword: PASSWORD, role: 'ADMIN' })).status).toBe(400); // unknown field
    expect(await prisma.user.count({ where: { phone: `+251${phone.slice(1)}` } })).toBe(0);
    const w = await worker();
    expect((await create(a, { fullName: 'Taken', phone: w.phone.replace('+251', '0'), password: 'AnotherLong1', actorPassword: PASSWORD })).status).toBe(409); // an existing account is never silently promoted
  });

  it('suspends and reactivates another administrator, ending their sessions, but never yourself', async () => {
    const a = await makeAdmin();
    const b = await makeAdmin();
    const patch = (who: User, id: string, body: object) => request(app).patch(`/api/v1/admin/admins/${id}/status`).set(auth(who.token)).send(body);
    expect((await patch(a, a.id, { status: 'SUSPENDED', actorPassword: PASSWORD })).status).toBe(403);
    expect((await patch(a, b.id, { status: 'SUSPENDED', actorPassword: 'nope-nope' })).status).toBe(403);
    expect((await patch(a, b.id, { status: 'SUSPENDED', actorPassword: PASSWORD })).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/stats').set(auth(b.token))).status).toBe(401); // sessions ended at once
    expect((await request(app).post('/api/v1/auth/login').send({ phone: b.phone.replace('+251', '0'), password: PASSWORD })).status).toBeGreaterThanOrEqual(400);
    expect((await patch(a, b.id, { status: 'ACTIVE', actorPassword: PASSWORD })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ phone: b.phone.replace('+251', '0'), password: PASSWORD })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorId: a.id, action: { in: ['admin.admin_suspended', 'admin.admin_reactivated'] } } })).toBe(2);
    const w = await worker();
    expect((await patch(a, w.id, { status: 'SUSPENDED', actorPassword: PASSWORD })).status).toBe(404); // only administrators here
  });
});

describe('phone numbers typed with spaces or punctuation', () => {
  it('are accepted at registration and login, and name the same account', async () => {
    const plain = newPhone(); // e.g. 0912234567
    const spaced = `${plain.slice(0, 4)} ${plain.slice(4, 7)} ${plain.slice(7)}`;
    const odd = `${plain.slice(0, 4)}-${plain.slice(4, 7)}${plain.slice(7)}`;
    const reg = await request(app).post('/api/v1/auth/register').send({ fullName: 'Spaced Phone', phone: spaced, password: PASSWORD, role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect(reg.body.user.phone).toBe(`+251${plain.slice(1)}`);
    for (const form of [plain, spaced, odd, `+251 ${plain.slice(1, 4)} ${plain.slice(4)}`]) {
      expect((await request(app).post('/api/v1/auth/login').send({ phone: form, password: PASSWORD })).status, form).toBe(200);
    }
    expect((await request(app).post('/api/v1/auth/login').send({ phone: '0912 234', password: PASSWORD })).status).toBe(400);
  });
});
