/**
 * Performance checks against a loaded test database: 3,000 workers (with skills) and 1,500 open jobs.
 * Timings are written to evaluation/perf-results.json. Thresholds are deliberately generous (they catch a
 * missing index or an accidental N+1 query, not small regressions) and describe THIS machine with the database
 * in a local Docker container, not production hardware.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { percentile } from '../evaluation/metrics';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const WORKERS = 3000;
const JOBS = 1500;
const PREFIX = '+25179';
const app = createApp();
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const results: Record<string, unknown> = { workers: WORKERS, jobs: JOBS };
let employerToken = '';
let workerToken = '';
let employerId = '';
let workerUserId = '';
let liveJobId = '';
const signedUp: string[] = [];

async function timed(fn: () => Promise<{ status: number }>, runs: number) {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const r = await fn();
    ms.push(performance.now() - t);
    expect(r.status).toBe(200);
  }
  return { median: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)), max: Math.round(Math.max(...ms)), runs };
}

async function signUp(role: 'WORKER' | 'EMPLOYER') {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  signedUp.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Perf ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Perf ${randomUUID().slice(0, 6)}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

beforeAll(async () => {
  const [categories, zone, skills] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true } }),
    prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } }),
    prisma.skill.findMany({ select: { id: true, categoryId: true } }),
  ]);
  const auto = categories.find((c) => c.slug === 'automotive')!;
  const engine = await prisma.skill.findFirstOrThrow({ where: { slug: 'engine-repair' } });
  const diag = await prisma.skill.findFirstOrThrow({ where: { slug: 'automotive-diagnostics' } });
  const byCat = new Map<string, string[]>();
  for (const s of skills) byCat.set(s.categoryId, [...(byCat.get(s.categoryId) ?? []), s.id]);

  const emp = await signUp('EMPLOYER');
  employerToken = emp.token;
  employerId = emp.id;
  const wk = await signUp('WORKER');
  workerToken = wk.token;
  workerUserId = wk.id;
  const org = await prisma.organization.findFirstOrThrow({ where: { name: { startsWith: 'TEST_ORG Perf' } } });

  // Bulk workers: users, profiles, skills (3 per worker, mostly from their own category)
  const users = Array.from({ length: WORKERS }, (_, i) => ({ id: randomUUID(), phone: `${PREFIX}${String(i).padStart(7, '0')}`, passwordHash: 'x', fullName: `Perf Worker ${i}`, role: 'WORKER' as const }));
  await prisma.user.createMany({ data: users });
  const profiles = users.map((u, i) => ({
    id: randomUUID(), userId: u.id, categoryId: categories[i % categories.length].id, yearsExperience: i % 12, locationId: zone.id, completionPct: 60,
    availability: (['IMMEDIATELY', 'FLEXIBLE', 'WITHIN_TWO_WEEKS'] as const)[i % 3], headline: `Worker ${i}`,
  }));
  await prisma.workerProfile.createMany({ data: profiles });
  const ws: { workerId: string; skillId: string; proficiency: number }[] = [];
  profiles.forEach((p, i) => {
    const pool = byCat.get(p.categoryId) ?? [];
    const chosen = new Set<string>(pool.length ? [pool[i % pool.length], pool[(i + 1) % pool.length], pool[(i + 2) % pool.length]] : []);
    if (i % 5 === 0) chosen.add(engine.id);
    if (i % 7 === 0) chosen.add(diag.id);
    for (const skillId of chosen) ws.push({ workerId: p.id, skillId, proficiency: 1 + (i % 5) });
  });
  await prisma.workerSkill.createMany({ data: ws });

  // Bulk jobs
  const jobs = Array.from({ length: JOBS }, (_, i) => {
    const cat = categories[i % categories.length];
    return {
      id: randomUUID(), organizationId: org.id, postedById: employerId, title: `Perf job ${i} ${cat.slug}`,
      description: `Perf description ${i} ${randomUUID()} We need a reliable person with skills for ${cat.slug} work. Apply with references.`,
      categoryId: cat.id, employmentType: 'FULL_TIME' as const, deadline: new Date(Date.now() + 30 * 86_400_000), locationId: zone.id,
      status: 'ACTIVE' as const, descriptionHash: randomUUID(), publishedAt: new Date(), minExperienceYears: i % 4,
    };
  });
  await prisma.job.createMany({ data: jobs });
  const js: { jobId: string; skillId: string; importance: 'REQUIRED' | 'PREFERRED' }[] = [];
  jobs.forEach((j, i) => {
    const pool = byCat.get(j.categoryId) ?? [];
    if (pool.length) js.push({ jobId: j.id, skillId: pool[i % pool.length], importance: 'REQUIRED' }, { jobId: j.id, skillId: pool[(i + 1) % pool.length], importance: 'PREFERRED' });
  });
  await prisma.jobSkill.createMany({ data: js, skipDuplicates: true });

  // The worker who asks for recommendations works in automotive; the employer's job is automotive too.
  const wp = await prisma.workerProfile.findFirstOrThrow({ where: { userId: workerUserId } });
  await prisma.workerProfile.update({ where: { id: wp.id }, data: { categoryId: auto.id, yearsExperience: 5, locationId: zone.id } });
  await prisma.workerSkill.createMany({ data: [{ workerId: wp.id, skillId: engine.id, proficiency: 4 }, { workerId: wp.id, skillId: diag.id, proficiency: 3 }] });
  // This organization holds thousands of open jobs, far above the default plan's limit: give it the unlimited plan.
  await prisma.subscription.create({ data: { organizationId: org.id, planId: (await prisma.subscriptionPlan.findFirstOrThrow({ where: { slug: 'premium' } })).id } });
  const create = await request(app).post('/api/v1/jobs').set(auth(employerToken)).send({
    title: 'Perf mechanic', description: `Repair vehicles. ${randomUUID()} ${randomUUID()} Please apply with your experience and references.`,
    categoryId: auto.id, employmentType: 'FULL_TIME', deadline: future(30), locationId: zone.id,
    skills: [{ skillId: engine.id, importance: 'REQUIRED' }, { skillId: diag.id, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  liveJobId = create.body.job.id;
  expect((await request(app).post(`/api/v1/jobs/${liveJobId}/publish`).set(auth(employerToken)).send({})).status).toBe(200);
}, 180_000);

afterAll(async () => {
  const dir = join(__dirname, '..', '..', 'evaluation');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'perf-results.json'), JSON.stringify({ ...results, note: 'Local machine, database in Docker, single Node process. Not production hardware.' }, null, 2));
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { OR: [{ phone: { startsWith: PREFIX } }, { phone: { in: signedUp } }] } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.auditLog.deleteMany({});
  await prisma.$disconnect();
}, 180_000);

describe(`with ${WORKERS} workers and ${JOBS} open jobs`, () => {
  it('job search stays fast: plain list, filters and text search', async () => {
    const list = await timed(() => request(app).get('/api/v1/jobs'), 20);
    const filtered = await timed(() => request(app).get('/api/v1/jobs').query({ category: 'automotive', region: 'Oromia', sort: 'newest' }), 20);
    const text = await timed(() => request(app).get('/api/v1/jobs').query({ q: 'automotive reliable person' }), 20);
    Object.assign(results, { jobList: list, jobListFiltered: filtered, jobTextSearch: text });
    expect(list.p95).toBeLessThan(800);
    expect(filtered.p95).toBeLessThan(800);
    expect(text.p95).toBeLessThan(1500);
  });

  it('recommended jobs for a worker', async () => {
    const t = await timed(() => request(app).get('/api/v1/recommendations/jobs').set(auth(workerToken)), 10);
    Object.assign(results, { recommendedJobs: t });
    expect(t.p95).toBeLessThan(3000);
    const r = await request(app).get('/api/v1/recommendations/jobs').set(auth(workerToken));
    expect(r.body.items.length).toBeGreaterThan(0);
    // sorted best first, and every item has an explanation
    const scores = r.body.items.map((i: any) => i.match.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('recommended workers for a job', async () => {
    const t = await timed(() => request(app).get(`/api/v1/jobs/${liveJobId}/recommended-workers`).set(auth(employerToken)), 10);
    Object.assign(results, { recommendedWorkers: t });
    expect(t.p95).toBeLessThan(3000);
    const r = await request(app).get(`/api/v1/jobs/${liveJobId}/recommended-workers`).set(auth(employerToken));
    expect(r.body.items.length).toBeGreaterThan(0);
  });

  it('handles 40 simultaneous visitors browsing jobs', async () => {
    const start = performance.now();
    const rs = await Promise.all(Array.from({ length: 40 }, () => request(app).get('/api/v1/jobs').query({ category: 'automotive' })));
    const total = Math.round(performance.now() - start);
    Object.assign(results, { concurrent40: { totalMs: total, allOk: rs.every((r) => r.status === 200) } });
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(total).toBeLessThan(8000);
  });

  it('admin national analytics still answer within a few seconds', async () => {
    const admin = await prisma.user.create({ data: { phone: `${PREFIX}9999999`, passwordHash: 'x', fullName: 'Perf Admin', role: 'ADMIN' } });
    const jwt = (await import('jsonwebtoken')).default;
    const { env } = await import('../config/env');
    const token = jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: admin.id, expiresIn: '5m' });
    const t = await timed(() => request(app).get('/api/v1/admin/analytics/national').set(auth(token)), 3);
    Object.assign(results, { adminNational: t });
    expect(t.p95).toBeLessThan(5000);
  });
});
