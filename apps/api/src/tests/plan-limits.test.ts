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
const planIds: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string; orgId?: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Plan ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  const ep = role === 'EMPLOYER' ? await prisma.employerProfile.findFirstOrThrow({ where: { userId: res.body.user.id } }) : null;
  return { token: res.body.accessToken, id: res.body.user.id, orgId: ep?.organizationId };
}
/** Put an employer on a plan with the given limits. */
async function onPlan(e: User, limits: { maxFeaturedJobs?: number | null; maxApplicationsReviewedPerMonth?: number | null }) {
  const plan = await prisma.subscriptionPlan.create({ data: { slug: `t-${tag()}`, name: 'TEST plan', priceEtbMonthly: 0, ...limits } });
  planIds.push(plan.id);
  await prisma.subscription.create({ data: { organizationId: e.orgId!, planId: plan.id } });
}

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
  await prisma.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.$disconnect();
});

async function liveJob(e: User, title = `Mechanic ${tag()}`) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title, description: `Workshop role for the plan limits test. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE', skills: [{ skillId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}
const feature = (e: User, jobId: string, featured = true) => request(app).post(`/api/v1/jobs/${jobId}/feature`).set(auth(e.token)).send({ featured });

describe('featured jobs', () => {
  it('is capped by the plan, frees a slot when un-featured, and is not in the default Free plan', async () => {
    const free = await signUp('EMPLOYER'); // default plan: no featured jobs
    const refused = await feature(free, await liveJob(free));
    expect(refused.status).toBe(402);
    expect(refused.body.error.code).toBe('PLAN_LIMIT');
    expect(refused.body.error.message).toMatch(/not included in your Free plan/);

    const e = await signUp('EMPLOYER');
    await onPlan(e, { maxFeaturedJobs: 1 });
    const [a, b] = [await liveJob(e), await liveJob(e)];
    const ok = await feature(e, a);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.job.featured).toBe(true);
    expect((await feature(e, a)).status).toBe(200); // repeating is harmless
    const over = await feature(e, b);
    expect(over.status).toBe(402);
    expect(over.body.error.message).toMatch(/allows 1 featured job at a time/);

    const plan = await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token));
    expect(plan.body.usage.featuredJobs).toBe(1);
    expect((await feature(e, a, false)).status).toBe(200);
    expect((await feature(e, b)).status).toBe(200);
  });

  it('puts featured jobs first in the public search with a label, and a closed job loses its feature', async () => {
    const e = await signUp('EMPLOYER');
    await onPlan(e, { maxFeaturedJobs: null });
    const word = tag();
    const older = await liveJob(e, `Older ${word}`);
    await liveJob(e, `Newer ${word}`);
    expect((await feature(e, older)).status).toBe(200);

    const res = await request(app).get(`/api/v1/jobs?q=${word}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((j: { id: string }) => j.id)[0]).toBe(older); // featured beats newer
    expect(res.body.items[0].featured).toBe(true);
    expect(res.body.items[1].featured).toBe(false);

    expect((await request(app).post(`/api/v1/jobs/${older}/close`).set(auth(e.token)).send({})).status).toBe(200);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: older } })).featuredAt).toBeNull();
  });

  it('is only for your own open jobs', async () => {
    const e = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    await onPlan(e, { maxFeaturedJobs: null });
    const live = await liveJob(e);
    const draft = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
      title: `Draft ${tag()}`, description: `A draft job for the test. ${randomUUID()} ${randomUUID()} Apply with references.`,
      categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE', skills: [{ skillId, importance: 'REQUIRED' }],
    });
    expect((await feature(e, draft.body.job.id)).status).toBe(409);
    expect((await feature(other, live)).status).toBeGreaterThanOrEqual(400);
    expect((await feature(other, live)).status).not.toBe(200);
    expect((await feature(w, live)).status).toBe(403);
    expect((await request(app).post(`/api/v1/jobs/${live}/feature`).set(auth(e.token)).send({ featured: 'yes' })).status).toBe(400);
  });
});

describe('applications reviewed per month', () => {
  async function pending(e: User, jobId: string) {
    const w = await signUp('WORKER');
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
    return (await prisma.application.findFirstOrThrow({ where: { jobId, worker: { userId: w.id } } })).id;
  }
  const move = (e: User, appId: string, status: string) => request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status });

  it('counts only the first decision on each application and never blocks ones already in progress', async () => {
    const e = await signUp('EMPLOYER');
    await onPlan(e, { maxApplicationsReviewedPerMonth: 2 });
    const jobId = await liveJob(e);
    const [a, b, c] = [await pending(e, jobId), await pending(e, jobId), await pending(e, jobId)];

    expect((await move(e, a, 'UNDER_REVIEW')).status).toBe(200);
    expect((await move(e, a, 'SHORTLISTED')).status).toBe(200); // a second step on the same application is free
    expect((await move(e, b, 'REJECTED')).status).toBe(200); // rejecting also counts as a first decision
    const blocked = await move(e, c, 'UNDER_REVIEW');
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('PLAN_LIMIT');
    expect(blocked.body.error.message).toMatch(/allows reviewing 2 new applications a month/);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: c } })).status).toBe('PENDING'); // untouched

    // applications already under review keep moving
    expect((await move(e, a, 'ACCEPTED')).status).toBe(200);

    const plan = await request(app).get('/api/v1/employers/me/subscription').set(auth(e.token));
    expect(plan.body.usage.reviewedThisMonth).toBe(2);
    expect(plan.body.plan.maxApplicationsReviewedPerMonth).toBe(2);
  });

  it('is unlimited when the plan says so, and counts per organisation', async () => {
    const e = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    await onPlan(e, { maxApplicationsReviewedPerMonth: null });
    await onPlan(other, { maxApplicationsReviewedPerMonth: 1 });
    const j1 = await liveJob(e);
    for (let i = 0; i < 3; i++) expect((await move(e, await pending(e, j1), 'UNDER_REVIEW')).status).toBe(200);
    const j2 = await liveJob(other);
    expect((await move(other, await pending(other, j2), 'UNDER_REVIEW')).status).toBe(200);
    expect((await move(other, await pending(other, j2), 'UNDER_REVIEW')).status).toBe(402); // e's reviews did not use up other's allowance
  });
});

describe('administration', () => {
  it('lets an administrator set both limits on a plan', async () => {
    const phone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
    phones.push(`+251${phone.slice(1)}`);
    const bcrypt = await import('bcryptjs');
    await prisma.user.create({ data: { phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('AdminPass123', 4), fullName: 'T Admin', role: 'ADMIN' } });
    const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'AdminPass123' });
    const made = await request(app).post('/api/v1/admin/plans').set(auth(login.body.accessToken)).send({ name: `Limits ${tag()}`, maxActiveJobs: null, maxInvitationsPerMonth: null, maxFeaturedJobs: 2, maxApplicationsReviewedPerMonth: 50 });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    planIds.push(made.body.plan.id);
    expect(made.body.plan).toMatchObject({ maxFeaturedJobs: 2, maxApplicationsReviewedPerMonth: 50 });
    const patched = await request(app).patch(`/api/v1/admin/plans/${made.body.plan.id}`).set(auth(login.body.accessToken)).send({ maxFeaturedJobs: null });
    expect(patched.body.plan.maxFeaturedJobs).toBeNull();
    expect((await request(app).post('/api/v1/admin/plans').set(auth(login.body.accessToken)).send({ name: `Bad ${tag()}`, maxActiveJobs: null, maxInvitationsPerMonth: null, maxFeaturedJobs: -1 })).status).toBe(400);
  });
});
