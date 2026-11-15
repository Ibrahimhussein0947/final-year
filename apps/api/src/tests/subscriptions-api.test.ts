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
const phones: string[] = [];
const planIds: string[] = [];
const PASSWORD = 'Passw0rdTest';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

const newPhone = () => {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
};
async function employer(): Promise<User & { orgId: string }> {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Plan Employer', phone: newPhone(), password: PASSWORD, role: 'EMPLOYER', region: 'Oromia', zone: 'Adama', language: 'en',
    organizationName: `TEST_ORG Plans ${tag()}`, organizationType: 'SME',
  });
  expect(res.status).toBe(201);
  const ep = await prisma.employerProfile.findFirstOrThrow({ where: { userId: res.body.user.id } });
  return { token: res.body.accessToken, id: res.body.user.id, orgId: ep.organizationId };
}
async function worker(): Promise<User & { profileId: string }> {
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: 'Plan Worker', phone: newPhone(), password: PASSWORD, role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  expect(res.status).toBe(201);
  const token = res.body.accessToken as string;
  await request(app).patch('/api/v1/workers/me').set(auth(token)).send({ categoryId, headline: 'Driver', yearsExperience: 5, availability: 'IMMEDIATELY', locationId: adamaId });
  await request(app).put(`/api/v1/workers/me/skills/${skillId}`).set(auth(token)).send({ proficiency: 4 });
  return { token, id: res.body.user.id, profileId: (await prisma.workerProfile.findFirstOrThrow({ where: { userId: res.body.user.id } })).id };
}
async function makeAdmin(): Promise<User> {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: 'Plan Admin', phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: PASSWORD });
  return { token: login.body.accessToken, id: u.id };
}

let categoryId = '';
let skillId = '';
let adamaId = '';
let admin: User;

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
  admin = await makeAdmin();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.$disconnect();
});

async function createPlan(over: Record<string, unknown> = {}) {
  const r = await request(app).post('/api/v1/admin/plans').set(auth(admin.token)).send({ name: `Test plan ${tag()}`, maxActiveJobs: 1, maxInvitationsPerMonth: 1, ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  planIds.push(r.body.plan.id);
  return r.body.plan as { id: string; slug: string; name: string };
}
const assign = (orgId: string, body: object) => request(app).post(`/api/v1/admin/organizations/${orgId}/subscription`).set(auth(admin.token)).send(body);
const draft = async (e: User, title: string) => {
  const r = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `${title} ${tag()}`, description: `Heavy truck driver for deliveries. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), locationId: adamaId, skills: [{ skillId, importance: 'REQUIRED' }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.job.id as string;
};
const publish = (e: User, id: string) => request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({});

describe('plans: administration', () => {
  it('is for administrators only', async () => {
    const e = await employer();
    expect((await request(app).get('/api/v1/admin/plans')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/plans').set(auth(e.token))).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/plans').set(auth(e.token)).send({ name: 'Free for me', maxActiveJobs: null })).status).toBe(403);
    expect((await assign(e.orgId, { planId: randomUUID() }).then((r) => r.status))).toBeGreaterThanOrEqual(400);
  });

  it('ships with a default plan and two paid starting plans', async () => {
    const r = await request(app).get('/api/v1/admin/plans').set(auth(admin.token));
    const names = (r.body.items as { slug: string; isDefault: boolean }[]);
    expect(names.filter((p) => p.isDefault)).toHaveLength(1);
    expect(names.map((p) => p.slug)).toEqual(expect.arrayContaining(['free', 'standard', 'premium']));
  });

  it('validates plan input and keeps exactly one default', async () => {
    for (const bad of [{ name: 'x' }, { name: 'Valid name', maxActiveJobs: -1 }, { name: 'Valid name', priceEtbMonthly: -5 }, { name: 'Valid name', bogus: true }]) {
      expect((await request(app).post('/api/v1/admin/plans').set(auth(admin.token)).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const before = (await prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } })).id;
    const p = await createPlan({ isDefault: true });
    expect(await prisma.subscriptionPlan.count({ where: { isDefault: true } })).toBe(1);
    expect((await prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } })).id).toBe(p.id);
    // the default can be neither switched off nor unset directly; restore the old default afterwards
    expect((await request(app).patch(`/api/v1/admin/plans/${p.id}`).set(auth(admin.token)).send({ isActive: false })).status).toBe(409);
    expect((await request(app).patch(`/api/v1/admin/plans/${before}`).set(auth(admin.token)).send({ isDefault: true })).status).toBe(200);
    expect((await prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } })).id).toBe(before);
    expect((await request(app).patch(`/api/v1/admin/plans/${p.id}`).set(auth(admin.token)).send({ isActive: false })).status).toBe(200);
  });
});

describe('plans: assigning and limits', () => {
  it('shows an employer their plan and usage', async () => {
    const e = await employer();
    const base = await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token));
    expect(base.status).toBe(200);
    expect(base.body).toMatchObject({ isDefault: true, plan: { slug: 'free' }, usage: { activeJobs: 0, invitationsThisMonth: 0 } });
    const w = await worker();
    expect((await request(app).get('/api/v1/employers/me/subscription').set(auth(w.token))).status).toBe(403);
  });

  it('limits open jobs by plan, and lifts the limit when the administrator changes the plan', async () => {
    const e = await employer();
    const plan = await createPlan({ maxActiveJobs: 1 });
    expect((await assign(e.orgId, { planId: plan.id, paymentNote: 'Bank transfer ref 1234' })).status).toBe(201);
    expect((await publish(e, await draft(e, 'First'))).status).toBe(200);
    const second = await publish(e, await draft(e, 'Second'));
    expect(second.status).toBe(402);
    expect(second.body.error.code).toBe('PLAN_LIMIT');
    expect(second.body.error.message).toMatch(/allows 1 open job/);
    const mine = await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token));
    expect(mine.body).toMatchObject({ isDefault: false, plan: { id: plan.id }, subscription: { paymentNote: 'Bank transfer ref 1234' }, usage: { activeJobs: 1 } });
    const unlimited = await createPlan({ maxActiveJobs: null });
    expect((await assign(e.orgId, { planId: unlimited.id })).status).toBe(201);
    expect((await publish(e, await draft(e, 'Third'))).status).toBe(200);
    expect(await prisma.subscription.count({ where: { organizationId: e.orgId, status: 'ACTIVE' } })).toBe(1); // only one in force
  });

  it('can switch off worker search and cap invitations', async () => {
    const e = await employer();
    const noSearch = await createPlan({ canSearchWorkers: false, maxInvitationsPerMonth: 1 });
    await assign(e.orgId, { planId: noSearch.id });
    const s = await request(app).get('/api/v1/talent/search').set(auth(e.token));
    expect(s.status).toBe(402);
    expect(s.body.error.details.limit).toEqual(['canSearchWorkers']);

    const inv = await createPlan({ canSearchWorkers: true, maxInvitationsPerMonth: 1, maxActiveJobs: null });
    await assign(e.orgId, { planId: inv.id });
    expect((await request(app).get('/api/v1/talent/search').set(auth(e.token))).status).toBe(200);
    const jobId = await draft(e, 'Invite');
    expect((await publish(e, jobId)).status).toBe(200);
    const [w1, w2] = [await worker(), await worker()];
    const invite = (w: { profileId: string }) => request(app).post(`/api/v1/jobs/${jobId}/invitations`).set(auth(e.token)).send({ workerId: w.profileId });
    const first = await invite(w1);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await invite(w2);
    expect(second.status).toBe(402);
    expect(second.body.error.message).toMatch(/1 invitations a month/);
  });

  it('ends on its end date and falls back to the default plan; cancelling does the same at once', async () => {
    const e = await employer();
    const plan = await createPlan({ maxActiveJobs: 5 });
    expect((await assign(e.orgId, { planId: plan.id, endsAt: '2020-01-01' })).status).toBe(400); // must be in the future
    await assign(e.orgId, { planId: plan.id, endsAt: future(30) });
    expect((await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token))).body.plan.id).toBe(plan.id);
    await prisma.subscription.updateMany({ where: { organizationId: e.orgId, status: 'ACTIVE' }, data: { startsAt: new Date(Date.now() - 10 * 86_400_000), endsAt: new Date(Date.now() - 86_400_000) } });
    expect((await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token))).body).toMatchObject({ isDefault: true, plan: { slug: expect.any(String) } });
    await assign(e.orgId, { planId: plan.id });
    const del = await request(app).delete(`/api/v1/admin/organizations/${e.orgId}/subscription`).set(auth(admin.token));
    expect(del.body.cancelled).toBe(1);
    expect((await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token))).body.isDefault).toBe(true);
  });

  it('will not assign a switched-off plan, and records every change in the activity log', async () => {
    const e = await employer();
    const off = await createPlan();
    expect((await request(app).patch(`/api/v1/admin/plans/${off.id}`).set(auth(admin.token)).send({ isActive: false })).status).toBe(200);
    expect((await assign(e.orgId, { planId: off.id })).status).toBe(409);
    const ok = await createPlan();
    await assign(e.orgId, { planId: ok.id });
    expect(await prisma.auditLog.count({ where: { actorId: admin.id, action: { in: ['admin.plan_created', 'admin.plan_updated', 'admin.subscription_assigned'] } } })).toBeGreaterThanOrEqual(3);
  });

  it('lists organizations with their plan and usage for the administrator', async () => {
    const e = await employer();
    const r = await request(app).get('/api/v1/admin/subscriptions').query({ q: 'TEST_ORG Plans' }).set(auth(admin.token));
    expect(r.status).toBe(200);
    const row = (r.body.items as { id: string; plan: { name: string }; usage: { activeJobs: number } }[]).find((i) => i.id === e.orgId);
    expect(row).toBeTruthy();
    expect(row!.usage.activeJobs).toBe(0);
  });
});
