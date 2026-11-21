import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const phones: string[] = [];
const newPhone = () => {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
};
type User = { token: string; id: string };

async function employer(): Promise<User> {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test Employer ${tag().slice(2, 6)}`, phone: newPhone(), password: 'Passw0rdTest', role: 'EMPLOYER', region: 'Oromia', zone: 'Adama', language: 'en',
    organizationName: `TEST_ORG Plans ${tag()}`, organizationType: 'SME',
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}
async function worker(): Promise<User> {
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test Worker Plans', phone: newPhone(), password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  return { token: res.body.accessToken, id: res.body.user.id };
}
async function admin(): Promise<User> {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: 'Test Admin Plans', phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' });
  return { token: login.body.accessToken, id: u.id };
}

let adm: User;
let planA = '';
let planB = '';
let offPlan = '';
const createdPlans: string[] = [];

beforeAll(async () => {
  adm = await admin();
  const mk = async (name: string, active: boolean) => {
    const p = await prisma.subscriptionPlan.create({ data: { slug: `${tag()}-${name}`, name: `TEST ${name} ${tag()}`, isActive: active, isDefault: false, sortOrder: 900 } });
    createdPlans.push(p.id);
    return p.id;
  };
  planA = await mk('A', true);
  planB = await mk('B', true);
  offPlan = await mk('Off', false);
});

afterAll(async () => {
  await prisma.planUpgradeRequest.deleteMany({ where: { planId: { in: createdPlans } } });
  await prisma.subscription.deleteMany({ where: { planId: { in: createdPlans } } });
  await prisma.subscriptionPlan.deleteMany({ where: { id: { in: createdPlans } } });
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'admin.plan_request' } } });
  await prisma.user.deleteMany({ where: { OR: [{ phone: { in: phones } }, { fullName: 'Test Admin Plans' }] } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG Plans' } } });
  await prisma.$disconnect();
});

const ask = (u: User, planId: string, note?: string) => request(app).post('/api/v1/employers/me/plan-requests').set(auth(u.token)).send({ planId, ...(note ? { note } : {}) });

describe('employer plan requests', () => {
  it('lists the plans to choose from and shows nothing pending at first', async () => {
    const e = await employer();
    const res = await request(app).get('/api/v1/employers/me/plans').set(auth(e.token));
    expect(res.status).toBe(200);
    const ids = res.body.plans.map((p: { id: string }) => p.id);
    expect(ids).toContain(planA);
    expect(ids).not.toContain(offPlan); // plans that are switched off cannot be asked for
    expect(res.body.pending).toBeNull();
  });

  it('refuses an unknown or switched-off plan, the plan they are already on, and a second open request', async () => {
    const e = await employer();
    expect((await ask(e, randomUUID())).status).toBe(404);
    expect((await ask(e, offPlan)).status).toBe(404);
    const current = (await request(app).get('/api/v1/employers/me/plans').set(auth(e.token))).body.currentPlanId;
    expect((await ask(e, current)).status).toBe(409);
    expect((await ask(e, planA, 'I will pay by bank transfer')).status).toBe(201);
    expect((await ask(e, planB)).status).toBe(409);
    const view = await request(app).get('/api/v1/employers/me/plans').set(auth(e.token));
    expect(view.body.pending).toMatchObject({ status: 'PENDING', note: 'I will pay by bank transfer' });
  });

  it('can be cancelled by its owner only, and then a new one can be made', async () => {
    const e = await employer();
    const other = await employer();
    const id = (await ask(e, planA)).body.request.id;
    expect((await request(app).delete(`/api/v1/employers/me/plan-requests/${id}`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/employers/me/plan-requests/${id}`).set(auth(e.token))).status).toBe(204);
    expect((await ask(e, planB)).status).toBe(201);
  });

  it('is approved by an administrator: the plan is assigned and the employer is told', async () => {
    const e = await employer();
    const id = (await ask(e, planA, 'paid')).body.request.id;
    const pending = await request(app).get('/api/v1/admin/plan-requests').set(auth(adm.token));
    expect(pending.body.items.find((r: { id: string }) => r.id === id)).toMatchObject({ plan: { id: planA }, note: 'paid' });

    const ok = await request(app).post(`/api/v1/admin/plan-requests/${id}/approve`).set(auth(adm.token)).send({ paymentNote: 'bank ref 1234', decisionNote: 'Welcome' });
    expect(ok.status).toBe(200);
    const sub = await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token));
    expect(sub.body.plan.id).toBe(planA);
    expect(sub.body.isDefault).toBe(false);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: e.id, type: 'plan.request_decided' } });
    expect(n.payload).toMatchObject({ approved: true, note: 'Welcome' });
    // a request can be decided once
    expect((await request(app).post(`/api/v1/admin/plan-requests/${id}/approve`).set(auth(adm.token)).send({})).status).toBe(409);
    expect((await request(app).post(`/api/v1/admin/plan-requests/${id}/decline`).set(auth(adm.token)).send({})).status).toBe(409);
    const after = await request(app).get('/api/v1/employers/me/plans').set(auth(e.token));
    expect(after.body.pending).toBeNull();
    expect(after.body.lastDecided).toMatchObject({ status: 'APPROVED' });
  });

  it('can be declined with a reason, leaving the plan unchanged', async () => {
    const e = await employer();
    const before = (await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token))).body.plan.id;
    const id = (await ask(e, planB)).body.request.id;
    expect((await request(app).post(`/api/v1/admin/plan-requests/${id}/decline`).set(auth(adm.token)).send({ decisionNote: 'Please verify your organization first' })).status).toBe(200);
    expect((await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token))).body.plan.id).toBe(before);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: e.id, type: 'plan.request_decided' } });
    expect(n.payload).toMatchObject({ approved: false, note: 'Please verify your organization first' });
    expect((await ask(e, planB)).status).toBe(201); // free to ask again
  });

  it('keeps the admin side to administrators and the employer side to employers', async () => {
    const e = await employer();
    const w = await worker();
    const id = (await ask(e, planA)).body.request.id;
    expect((await request(app).get('/api/v1/admin/plan-requests').set(auth(e.token))).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/plan-requests/${id}/approve`).set(auth(e.token)).send({})).status).toBe(403);
    expect((await request(app).get('/api/v1/employers/me/plans').set(auth(w.token))).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/plan-requests/${randomUUID()}/approve`).set(auth(adm.token)).send({})).status).toBe(404);
  });
});
