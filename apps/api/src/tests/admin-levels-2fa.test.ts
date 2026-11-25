import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { codeForStep, stepAt } from '../lib/totp';

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


const get = (a: User, path: string) => request(app).get(`/api/v1/admin${path}`).set(auth(a.token));
async function withLevel(level: 'FULL' | 'MODERATOR' | 'AUDITOR'): Promise<User> {
  const a = await makeAdmin();
  await prisma.user.update({ where: { id: a.id }, data: { adminLevel: level } });
  return a;
}

describe('administrator levels', () => {
  it('lets an auditor read but not change anything', async () => {
    const a = await withLevel('AUDITOR');
    expect((await get(a, '/stats')).status).toBe(200);
    expect((await get(a, '/admins')).status).toBe(200);
    const w = await worker();
    const r = await request(app).patch(`/api/v1/admin/users/${w.id}/status`).set(auth(a.token)).send({ status: 'SUSPENDED' });
    expect(r.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.id } })).status).toBe('ACTIVE');
  });

  it('lets a moderator work on reports and jobs, but not users, settings, exports or the admin list', async () => {
    const m = await withLevel('MODERATOR');
    expect((await get(m, '/moderation/reports')).status).toBe(200);
    expect((await get(m, '/export/users')).status).toBe(403);
    expect((await get(m, '/admins')).status).toBe(403);
    const w = await worker();
    expect((await request(app).patch(`/api/v1/admin/users/${w.id}/status`).set(auth(m.token)).send({ status: 'SUSPENDED' })).status).toBe(403);
    expect((await request(app).patch('/api/v1/admin/settings').set(auth(m.token)).send({})).status).toBe(403);
  });

  it('keeps full administrators unrestricted and lets them set levels, but never their own', async () => {
    const f = await withLevel('FULL');
    const other = await makeAdmin();
    const own = await request(app).patch(`/api/v1/admin/admins/${f.id}/level`).set(auth(f.token)).send({ level: 'AUDITOR', actorPassword: PASSWORD });
    expect(own.status).toBe(403);
    const bad = await request(app).patch(`/api/v1/admin/admins/${other.id}/level`).set(auth(f.token)).send({ level: 'AUDITOR', actorPassword: 'wrong-pass-1' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const ok = await request(app).patch(`/api/v1/admin/admins/${other.id}/level`).set(auth(f.token)).send({ level: 'AUDITOR', actorPassword: PASSWORD });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).adminLevel).toBe('AUDITOR');
    expect((await get(f, '/admins')).body.items.some((i: { adminLevel: string }) => i.adminLevel === 'AUDITOR')).toBe(true);
  });

  it('refuses level changes from a moderator or auditor', async () => {
    const m = await withLevel('MODERATOR');
    const target = await makeAdmin();
    expect((await request(app).patch(`/api/v1/admin/admins/${target.id}/level`).set(auth(m.token)).send({ level: 'FULL', actorPassword: PASSWORD })).status).toBe(403);
  });
});

describe('two-factor secret and backup codes', () => {
  it('stores the secret encrypted, gives backup codes once, and each works once', async () => {
    const a = await makeAdmin();
    const setup = await request(app).post('/api/v1/auth/2fa/setup').set(auth(a.token));
    expect(setup.status).toBe(200);
    const stored = (await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).totpSecret!;
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain(setup.body.secret);

    const step = stepAt(Date.now());
    const enable = await request(app).post('/api/v1/auth/2fa/enable').set(auth(a.token)).send({ code: codeForStep(setup.body.secret, step) });
    expect(enable.status, JSON.stringify(enable.body)).toBe(200);
    expect(enable.body.backupCodes).toHaveLength(8);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.totpBackupCodes).toHaveLength(8);
    expect(JSON.stringify(row.totpBackupCodes)).not.toContain(enable.body.backupCodes[0]);

    const code = enable.body.backupCodes[0] as string;
    expect((await request(app).post('/api/v1/auth/login').send({ phone: a.phone.replace('+251', '0'), password: PASSWORD })).status).toBe(401); // code required
    const ok = await request(app).post('/api/v1/auth/login').send({ phone: a.phone.replace('+251', '0'), password: PASSWORD, totpCode: code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const again = await request(app).post('/api/v1/auth/login').send({ phone: a.phone.replace('+251', '0'), password: PASSWORD, totpCode: code });
    expect(again.status).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).totpBackupCodes).toHaveLength(7);
    // the authenticator still works with the encrypted secret
    const viaApp = await request(app).post('/api/v1/auth/login').send({ phone: a.phone.replace('+251', '0'), password: PASSWORD, totpCode: codeForStep(setup.body.secret, step + 1) });
    expect(viaApp.status).toBe(200);
  });

  it('still reads an older plaintext secret', async () => {
    const a = await makeAdmin();
    const secret = 'JBSWY3DPEHPK3PXP';
    const step = stepAt(Date.now());
    await prisma.user.update({ where: { id: a.id }, data: { totpSecret: secret, totpEnabledAt: new Date() } });
    const r = await request(app).post('/api/v1/auth/login').send({ phone: a.phone.replace('+251', '0'), password: PASSWORD, totpCode: codeForStep(secret, step) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
