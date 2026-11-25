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
  const u = await prisma.user.create({ data: { fullName: `Ops Admin ${randomUUID().slice(0, 4)}`, phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN', adminLevel } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: PASSWORD });
  return { token: login.body.accessToken as string, id: u.id };
}
async function worker(name = 'Ops Worker') {
  const phone = newPhone();
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: name, phone, password: PASSWORD, role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  expect(res.status).toBe(201);
  return { id: res.body.user.id as string };
}

afterAll(async () => {
  await prisma.supportMessage.deleteMany({ where: { email: 'ops-test@example.com' } });
  await prisma.deliveryLog.deleteMany({ where: { subject: 'ops-test-subject' } });
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.$disconnect();
});


describe('admin operations', () => {
  it('stores contact form messages and lets an administrator resolve them', async () => {
    const admin = await makeAdmin();
    const bad = await request(app).post('/api/v1/contact').send({ name: 'A', email: 'nope', message: 'short' });
    expect(bad.status).toBe(400);
    const sent = await request(app).post('/api/v1/contact').send({ name: 'Ops Tester', email: 'ops-test@example.com', message: 'Hello, I need help with my account.' });
    expect(sent.status).toBe(201);
    const list = await request(app).get('/api/v1/admin/support?status=OPEN').set(auth(admin.token));
    const item = list.body.items.find((i: { email: string }) => i.email === 'ops-test@example.com');
    expect(item).toBeTruthy();
    const done = await request(app).patch(`/api/v1/admin/support/${item.id}`).set(auth(admin.token)).send({ status: 'RESOLVED', adminNote: 'Called back' });
    expect(done.body.item.status).toBe('RESOLVED');
    expect(done.body.item.resolvedById).toBe(admin.id);
    expect((await request(app).get('/api/v1/contact')).status).toBe(404);
  });

  it('lets moderators work the inbox but not read backups', async () => {
    const mod = await makeAdmin('MODERATOR');
    expect((await request(app).get('/api/v1/admin/support').set(auth(mod.token))).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/backups').set(auth(mod.token))).status).toBe(403);
    const auditor = await makeAdmin('AUDITOR');
    expect((await request(app).get('/api/v1/admin/deliveries').set(auth(auditor.token))).status).toBe(200);
  });

  it('records deliveries masked, without the message text', async () => {
    const admin = await makeAdmin();
    const { recordDelivery } = await import('../lib/deliveryLog');
    await recordDelivery('EMAIL', 'person@example.com', 'FAILED', { subject: 'ops-test-subject', error: 'provider down' });
    const res = await request(app).get('/api/v1/admin/deliveries?status=FAILED').set(auth(admin.token));
    const row = res.body.items.find((i: { subject: string }) => i.subject === 'ops-test-subject');
    expect(row.recipient).toBe('p***@example.com');
    expect(row).not.toHaveProperty('text');
    expect(res.body.last7Days.FAILED).toBeGreaterThan(0);
  });

  it('reports the backup folder state', async () => {
    const admin = await makeAdmin();
    const res = await request(app).get('/api/v1/admin/backups').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.backups)).toBe(true);
  });

  it('exports a person data and deletes an account on request, with the admin password', async () => {
    const admin = await makeAdmin();
    const w = await worker('Erase Me');
    const data = await request(app).get(`/api/v1/admin/export/user/${w.id}`).set(auth(admin.token));
    expect(data.status).toBe(200);
    expect(data.text).not.toContain('passwordHash');
    const noPass = await request(app).post(`/api/v1/admin/users/${w.id}/delete`).set(auth(admin.token)).send({ reason: 'Requested by the user', actorPassword: 'wrong-password' });
    expect(noPass.status).toBe(403);
    const ok = await request(app).post(`/api/v1/admin/users/${w.id}/delete`).set(auth(admin.token)).send({ reason: 'Requested by the user', actorPassword: PASSWORD });
    expect(ok.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: w.id } });
    expect(after?.status).toBe('DELETED');
    expect(after?.fullName).toBe('Deleted user');
    expect((await request(app).post(`/api/v1/admin/users/${admin.id}/delete`).set(auth(admin.token)).send({ reason: 'self delete', actorPassword: PASSWORD })).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/export/user/${w.id}`).set(auth(admin.token))).status).toBe(409);
  });
});
