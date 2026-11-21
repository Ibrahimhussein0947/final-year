import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { fitOf } from '../modules/matching/fit';
import { rejectionTips } from '../modules/applications/tips';
import { MIN_SAMPLE, offered, percentile, summarize } from '../modules/jobs/salaryGuide';
import { MIN_PUBLIC, canReviewEmployer } from '../modules/reviews/service';
import type { MatchResult } from '../modules/matching/types';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', orgName?: string): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: orgName ?? `TEST_ORG Helpers ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let transportId = ''; let heavyId = ''; let guardId = ''; let adamaId = '';
beforeAll(async () => {
  transportId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  heavyId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
  guardId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'guard-duty' } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG Helpers' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG Helpers' } } });
  await prisma.$disconnect();
});

async function worker(skill = heavyId) {
  const w = await signUp('WORKER');
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: transportId, headline: 'Driver', yearsExperience: 6, availability: 'IMMEDIATELY', locationId: adamaId });
  expect((await request(app).put(`/api/v1/workers/me/skills/${skill}`).set(auth(w.token)).send({ proficiency: 4 })).status).toBe(200);
  return w;
}
async function liveJob(e: User, over: object = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Driver ${tag()}`, description: `We need a heavy truck driver for regional deliveries. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId: transportId, employmentType: 'FULL_TIME', deadline: future(30), locationId: adamaId, skills: [{ skillId: heavyId, importance: 'REQUIRED' }, { skillId: guardId, importance: 'REQUIRED' }], ...over,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}

describe('fit summary (pure)', () => {
  const base = { score: 70, strength: 'good', eligibility: 'eligible', criteria: { met: [], unmet: [], unknown: [], eligibility: 'n/a' }, requiredCoverage: { required: 0, covered: 0 }, missingSkills: [] } as unknown as MatchResult;
  it('counts covered skills and sector requirements, and lists what is missing', () => {
    const f = fitOf({ ...base, requiredCoverage: { required: 4, covered: 2 }, missingSkills: ['Welding', 'Forklift'], criteria: { met: [{ label: 'Licence', verified: true }], unmet: [{ label: 'Night shifts', mustHave: true }], unknown: [{ label: 'Own tools', mustHave: false }], eligibility: 'not_eligible' } } as MatchResult);
    expect(f).toMatchObject({ total: 7, met: 3, nothingListed: false });
    expect(f.missing).toEqual(['Skill: Welding', 'Skill: Forklift', 'Must have: Night shifts']); // at most 3
  });
  it('says nothing is listed instead of 0 of 0', () => {
    expect(fitOf(base)).toMatchObject({ total: 0, met: 0, nothingListed: true, missing: [] });
  });
});

describe('rejection tips (pure)', () => {
  const full = { hasCv: true, hasPhoto: true, identityVerified: true, hasCertificates: true, skillCount: 5 };
  it('turns the stored match into actions, most specific first, at most five', () => {
    const tips = rejectionTips({ missingSkills: ['Welding'], criteria: { unmet: [{ label: 'Own vehicle', mustHave: true }] }, components: { experience: { score: 0.2 }, location: { score: 0.9 } } }, { hasCv: false, hasPhoto: false, identityVerified: false, hasCertificates: false, skillCount: 1 });
    expect(tips.map((t) => t.key).slice(0, 3)).toEqual(['skills', 'criterion:Own vehicle', 'experience']);
    expect(tips.length).toBeLessThanOrEqual(5);
    expect(tips.find((t) => t.key === 'location')).toBeUndefined(); // a good component gives no tip
  });
  it('gives no profile tips to a complete profile and never blames the person', () => {
    expect(rejectionTips({ missingSkills: [], components: { skills: { score: 0.9 } } }, full)).toEqual([]);
    expect(rejectionTips(null, full)).toEqual([]);
    const text = rejectionTips({ missingSkills: ['X'] }, full).map((t) => t.text).join(' ').toLowerCase();
    expect(text).not.toMatch(/unfit|unqualified|reject/);
  });
});

describe('salary guide maths (pure)', () => {
  it('interpolates percentiles and rounds to 50', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40], 0.25)).toBe(17.5);
    expect(summarize([8000, 9000, 10000, 12000, 20000])).toEqual({ sample: 5, low: 9000, median: 10000, high: 12000 });
  });
  it('uses the middle of a range or the one figure stated', () => {
    expect(offered(8000, 10000)).toBe(9000);
    expect(offered(8000, null)).toBe(8000);
    expect(offered(null, 9000)).toBe(9000);
    expect(offered(null, null)).toBeNull();
  });
});

describe('the fit of the jobs on a page', () => {
  it('returns met of total for each job, only for workers', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await worker(); // has heavy driving, not guard duty
    const r = await request(app).post('/api/v1/jobs/fit').set(auth(w.token)).send({ jobIds: [jobId] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items[jobId]).toMatchObject({ total: 2, met: 1, nothingListed: false });
    expect(r.body.items[jobId].missing.join(' ')).toContain('Skill:');
    expect((await request(app).post('/api/v1/jobs/fit').set(auth(e.token)).send({ jobIds: [jobId] })).status).toBe(403);
    expect((await request(app).post('/api/v1/jobs/fit').set(auth(w.token)).send({ jobIds: [] })).status).toBe(400);
    expect((await request(app).post('/api/v1/jobs/fit').send({ jobIds: [jobId] })).status).toBe(401);
  });
});

describe('tips after "not selected"', () => {
  it('appear on a rejected application, and not on one still open', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await worker();
    const apply = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    expect(apply.status, JSON.stringify(apply.body)).toBe(201);
    const appId = apply.body.applicationId as string;
    let mine = await request(app).get('/api/v1/applications/mine').set(auth(w.token));
    expect(mine.body.items[0].notSelectedTips).toEqual([]);
    expect((await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status: 'REJECTED', note: 'Needs both skills' })).status).toBe(200);
    mine = await request(app).get('/api/v1/applications/mine').set(auth(w.token));
    const tips = mine.body.items[0].notSelectedTips as { key: string; text: string }[];
    expect(tips.length).toBeGreaterThan(0);
    expect(tips[0].key).toBe('skills');
    expect(tips.length).toBeLessThanOrEqual(5);
  });
});

describe('rating employers', () => {
  it('needs an interview or a hire, allows one rating, and hides totals until there are enough', async () => {
    const e = await signUp('EMPLOYER');
    const org = await prisma.employerProfile.findFirstOrThrow({ where: { userId: e.id } });
    const jobId = await liveJob(e);

    expect(canReviewEmployer('PENDING', 0)).toBe(false);
    expect(canReviewEmployer('WITHDRAWN', 2)).toBe(false);
    expect(canReviewEmployer('REJECTED', 1)).toBe(true); // was interviewed, then not hired

    const workers: { w: User; appId: string }[] = [];
    for (let i = 0; i < MIN_PUBLIC; i++) {
      const w = await worker();
      const a = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
      expect(a.status).toBe(201);
      workers.push({ w, appId: a.body.applicationId as string });
    }
    const rate = (x: { w: User; appId: string }, body: object) => request(app).post(`/api/v1/applications/${x.appId}/review`).set(auth(x.w.token)).send(body);

    // not yet interviewed: refused
    expect((await rate(workers[0], { rating: 5 })).status).toBe(403);
    // the employer accepts everyone, so they all may rate
    for (const x of workers) {
      for (const status of ['SHORTLISTED', 'ACCEPTED']) expect((await request(app).patch(`/api/v1/applications/${x.appId}/status`).set(auth(e.token)).send({ status })).status).toBe(200);
    }

    expect((await rate(workers[0], { rating: 6 })).status).toBe(400);
    expect((await rate(workers[0], { rating: 4, comment: 'free text is not allowed' })).status).toBe(400);
    expect((await rate(workers[0], { rating: 4, paidOnTime: true, respectful: true, asDescribed: false })).status).toBe(201);
    expect((await rate(workers[0], { rating: 5 })).status).toBe(409); // once per application

    // someone else's application
    expect((await request(app).post(`/api/v1/applications/${workers[1].appId}/review`).set(auth(workers[0].w.token)).send({ rating: 1 })).status).toBe(404);

    const hidden = await request(app).get(`/api/v1/organizations/${org.organizationId}/rating`);
    expect(hidden.body.rating).toMatchObject({ count: 1, average: null, hidden: true });
    expect(JSON.stringify(hidden.body)).not.toContain(workers[0].w.id);

    expect((await rate(workers[1], { rating: 2, paidOnTime: false })).status).toBe(201);
    expect((await rate(workers[2], { rating: 3, paidOnTime: true, respectful: true })).status).toBe(201);
    const shown = await request(app).get(`/api/v1/organizations/${org.organizationId}/rating`);
    expect(shown.body.rating).toMatchObject({ count: 3, average: 3, hidden: false, paidOnTime: 67, respectful: 100, asDescribed: 0 });

    // the employer sees the same totals and nothing about who rated
    const own = await request(app).get('/api/v1/employers/me/rating').set(auth(e.token));
    expect(own.body.rating.count).toBe(3);
    // each worker sees that they already rated
    const mine = await request(app).get('/api/v1/applications/mine').set(auth(workers[0].w.token));
    expect(mine.body.items[0]).toMatchObject({ canReview: false, review: { rating: 4 } });
  });
});

describe('salary guide endpoint', () => {
  it('shows nothing below the minimum number of jobs, then the middle half of posted pay', async () => {
    const cat = await prisma.category.findFirstOrThrow({ where: { slug: 'security' } }).catch(() => prisma.category.findFirstOrThrow({ where: { NOT: { id: transportId } } }));
    const none = await request(app).get(`/api/v1/jobs/salary-guide?categoryId=${cat.id}&locationId=${adamaId}`);
    expect(none.status).toBe(200);
    if (!none.body.available) expect(none.body.needed).toBe(MIN_SAMPLE);

    const e = await signUp('EMPLOYER');
    for (const [min, max] of [[8000, 10000], [9000, 11000], [10000, 12000], [11000, 13000], [12000, 14000]]) {
      await liveJob(e, { categoryId: cat.id, salaryMin: min, salaryMax: max });
    }
    const r = await request(app).get(`/api/v1/jobs/salary-guide?categoryId=${cat.id}&locationId=${adamaId}`);
    expect(r.body.available).toBe(true);
    expect(r.body.sample).toBeGreaterThanOrEqual(MIN_SAMPLE);
    expect(r.body.low).toBeLessThanOrEqual(r.body.median);
    expect(r.body.median).toBeLessThanOrEqual(r.body.high);
    expect(Object.keys(r.body)).not.toContain('max'); // never one employer's number
    expect((await request(app).get('/api/v1/jobs/salary-guide')).status).toBe(400);
  });
});
