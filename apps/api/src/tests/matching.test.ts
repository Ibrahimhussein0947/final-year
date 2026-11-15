import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { clearMatchingCaches } from '../modules/matching/weights';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}
type User = { token: string; id: string; phone: string; workerId?: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', extra: Record<string, unknown> = {}): Promise<User> {
  const phone = newPhone();
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Match ${tag()}`, organizationType: 'SME' } : {}), ...extra,
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}

let autoId = '';
let cookId = '';
let skill: Record<string, string> = {};
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function worker(skills: string[], over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const w = await signUp('WORKER', extra);
  const patch = await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: autoId, yearsExperience: 4, headline: 'Mechanic', ...over });
  expect(patch.status, JSON.stringify(patch.body)).toBe(200);
  for (const s of skills) await request(app).put(`/api/v1/workers/me/skills/${skill[s]}`).set(auth(w.token)).send({ proficiency: 4 });
  w.workerId = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } })).id;
  return w;
}

async function liveJob(e: User, skills: string[], over: Record<string, unknown> = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Match job ${tag()}`, description: `Repair vehicles in our garage. ${randomUUID()} ${randomUUID()} Reliable people only, please apply.`,
    categoryId: autoId, employmentType: 'FULL_TIME', deadline: future(30), minExperienceYears: 2,
    locationId: (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id,
    skills: skills.map((s) => ({ skillId: skill[s], importance: 'REQUIRED' })), ...over,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const id = create.body.job.id as string;
  expect((await request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return id;
}

let admin: User;
let adminPhone = '';
beforeAll(async () => {
  autoId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  cookId = (await prisma.category.findFirstOrThrow({ where: { slug: 'hospitality' } })).id;
  const rows = await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems', 'welding', 'cooking', 'panel-beating'] } } });
  skill = Object.fromEntries(rows.map((s) => [s.slug, s.id]));
  adminPhone = newPhone();
  const a = await prisma.user.create({ data: { fullName: 'Test Admin', phone: `+251${adminPhone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone: adminPhone, password: 'Passw0rdTest' });
  admin = { token: login.body.accessToken, id: a.id, phone: adminPhone };
});

afterEach(async () => {
  // Weight changes must never leak into other tests.
  await prisma.matchWeights.deleteMany({ where: { createdBy: admin.id } });
  await prisma.matchWeights.updateMany({ where: { categoryId: null, version: 1 }, data: { active: true } });
  clearMatchingCaches();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } }); // cascades applications and recommendations
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  for (const level of ['KEBELE', 'WOREDA'] as const) await prisma.location.deleteMany({ where: { level, nameEn: { startsWith: 'Test' } } });
  await prisma.$disconnect();
});

describe('recommended workers for a job', () => {
  it('ranks suitable workers, explains the score, and excludes people who should not appear', async () => {
    const e = await signUp('EMPLOYER');
    const job = await liveJob(e, ['engine-repair', 'brake-systems']);

    const full = await worker(['engine-repair', 'brake-systems']);
    const partial = await worker(['engine-repair']);
    const hidden = await worker(['engine-repair', 'brake-systems'], { isVisible: false });
    const away = await worker(['engine-repair', 'brake-systems'], { availability: 'NOT_AVAILABLE' });
    const suspended = await worker(['engine-repair', 'brake-systems']);
    await prisma.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    const applied = await worker(['engine-repair', 'brake-systems']);
    await request(app).post(`/api/v1/jobs/${job}/apply`).set(auth(applied.token)).send({});
    const unrelated = await worker(['cooking'], { categoryId: cookId });

    const res = await request(app).get(`/api/v1/jobs/${job}/recommended-workers`).set(auth(e.token));
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: { workerId: string }) => i.workerId);
    expect(ids).toContain(full.workerId);
    expect(ids).toContain(partial.workerId);
    for (const w of [hidden, away, suspended, applied, unrelated]) expect(ids, 'excluded worker appeared').not.toContain(w.workerId);
    expect(ids.indexOf(full.workerId)).toBeLessThan(ids.indexOf(partial.workerId));

    const top = res.body.items.find((i: { workerId: string }) => i.workerId === full.workerId);
    expect(top.match.score).toBeGreaterThan(res.body.items.find((i: { workerId: string }) => i.workerId === partial.workerId).match.score);
    expect(top.match.explanation).toMatch(/^(Strong|Good) match: 2 of 2 required skills/);
    expect(top.match.components.skills.score).toBe(1);
    expect(top.match.engineVersion).toBe('rules-1.0');
    // scores are sorted
    const scores = res.body.items.map((i: { match: { score: number } }) => i.match.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('shares no private data about workers', async () => {
    const e = await signUp('EMPLOYER');
    const job = await liveJob(e, ['engine-repair'], { lat: 8.54, lng: 39.27 });
    const w = await worker(['engine-repair'], { lat: 8.612345, lng: 39.301234, maxTravelKm: 30 }, { email: 'private.person@example.com' });
    const res = await request(app).get(`/api/v1/jobs/${job}/recommended-workers`).set(auth(e.token));
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(w.phone);
    expect(text).not.toContain('private.person@example.com');
    expect(text).not.toContain('8.612345');
    expect(text).not.toContain('39.301234');
    const item = res.body.items.find((i: { workerId: string }) => i.workerId === w.workerId);
    expect(Number.isInteger(item.match.distanceKm)).toBe(true);
    expect(item.match.distanceKm).toBeGreaterThan(5);
    expect(item.match.distanceKm).toBeLessThan(15);
  });

  it('is limited to the job owner and to employers', async () => {
    const e = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const job = await liveJob(e, ['engine-repair']);
    expect((await request(app).get(`/api/v1/jobs/${job}/recommended-workers`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).get(`/api/v1/jobs/${job}/recommended-workers`).set(auth(w.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/jobs/${job}/recommended-workers`)).status).toBe(401);
  });

  it('logs recommendations for evaluation, replacing old rows but keeping ones with feedback', async () => {
    const e = await signUp('EMPLOYER');
    const job = await liveJob(e, ['engine-repair']);
    const a = await worker(['engine-repair']);
    const b = await worker(['engine-repair']);
    await request(app).get(`/api/v1/jobs/${job}/recommended-workers`).set(auth(e.token));
    const first = await prisma.recommendation.findMany({ where: { jobId: job, direction: 'JOB_TO_WORKER' } });
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first[0]).toMatchObject({ engineVersion: 'rules-1.0' });
    expect(first[0].score).toBeGreaterThan(0);
    expect(typeof first[0].explanation).toBe('string');

    // someone reacts to worker a's recommendation
    const kept = first.find((r) => r.workerId === a.workerId)!;
    await prisma.recommendationFeedback.create({ data: { recommendationId: kept.id, action: 'VIEWED' } });
    await request(app).get(`/api/v1/jobs/${job}/recommended-workers`).set(auth(e.token));
    const second = await prisma.recommendation.findMany({ where: { jobId: job, direction: 'JOB_TO_WORKER' } });
    expect(second.some((r) => r.id === kept.id)).toBe(true); // feedback preserved
    const bRows = second.filter((r) => r.workerId === b.workerId);
    expect(bRows).toHaveLength(1); // old row replaced, not duplicated
    expect(first.find((r) => r.workerId === b.workerId)!.id).not.toBe(bRows[0].id);
  });
});

describe('recommended jobs for a worker', () => {
  it('ranks open jobs and leaves out closed, expired, applied and unrelated ones', async () => {
    const e = await signUp('EMPLOYER');
    const good = await liveJob(e, ['engine-repair', 'brake-systems']);
    const okay = await liveJob(e, ['engine-repair', 'welding']);
    const unrelated = await liveJob(e, ['cooking'], { categoryId: cookId });
    const closed = await liveJob(e, ['engine-repair']);
    await request(app).post(`/api/v1/jobs/${closed}/close`).set(auth(e.token)).send({});
    const expired = await liveJob(e, ['engine-repair']);
    await prisma.job.update({ where: { id: expired }, data: { deadline: new Date(Date.now() - 3600_000) } });
    const appliedTo = await liveJob(e, ['engine-repair', 'brake-systems']);

    const w = await worker(['engine-repair', 'brake-systems']);
    await request(app).post(`/api/v1/jobs/${appliedTo}/apply`).set(auth(w.token)).send({});

    const res = await request(app).get('/api/v1/recommendations/jobs?limit=50').set(auth(w.token));
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('ok');
    const ids = res.body.items.map((i: { job: { id: string } }) => i.job.id);
    expect(ids).toContain(good);
    expect(ids).toContain(okay);
    for (const j of [unrelated, closed, expired, appliedTo]) expect(ids, 'job should be excluded').not.toContain(j);
    expect(ids.indexOf(good)).toBeLessThan(ids.indexOf(okay));
    const top = res.body.items.find((i: { job: { id: string } }) => i.job.id === good);
    expect(top.job.title).toBeTruthy();
    expect(top.match.explanation).toContain('2 of 2 required skills');
    expect(await prisma.recommendation.count({ where: { workerId: w.workerId, direction: 'WORKER_TO_JOB' } })).toBeGreaterThan(0);
  });

  it('asks workers without any skills or category to complete their profile instead of guessing', async () => {
    const w = await signUp('WORKER');
    const res = await request(app).get('/api/v1/recommendations/jobs').set(auth(w.token));
    expect(res.body).toEqual({ reason: 'no_profile_data', items: [] });
  });

  it('is for workers only', async () => {
    const e = await signUp('EMPLOYER');
    expect((await request(app).get('/api/v1/recommendations/jobs').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/recommendations/jobs')).status).toBe(401);
  });
});

describe('explaining a match to the worker', () => {
  it('returns the full breakdown for an open job only', async () => {
    const e = await signUp('EMPLOYER');
    const job = await liveJob(e, ['engine-repair', 'brake-systems']);
    const w = await worker(['engine-repair']);
    const res = await request(app).get(`/api/v1/jobs/${job}/match`).set(auth(w.token));
    expect(res.status).toBe(200);
    // Brake Systems is covered through a related skill, so it is "related", not "missing".
    expect(res.body.match.missingSkills).toEqual([]);
    expect(res.body.match.matchedSkills).toEqual(['Engine Repair']);
    expect(res.body.match.relatedSkills).toEqual([{ required: 'Brake Systems', has: 'Engine Repair', credit: 0.5 }]); // related via taxonomy
    expect(res.body.match.components.skills.score).toBe(0.75);
    expect(Object.keys(res.body.match.components).sort()).toEqual(['availability', 'criteria', 'experience', 'location', 'preferences', 'qualification', 'skills']);

    const draft = (await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
      title: `Draft ${tag()}`, description: 'A draft job that is not public and therefore should not be explainable to anyone yet.', categoryId: autoId, employmentType: 'FULL_TIME',
    })).body.job.id;
    expect((await request(app).get(`/api/v1/jobs/${draft}/match`).set(auth(w.token))).status).toBe(404);
    expect((await request(app).get(`/api/v1/jobs/${job}/match`).set(auth(e.token))).status).toBe(403);
  });
});

describe('scores in the recruitment workflow', () => {
  it('stores a snapshot when applying and shows scores to the employer', async () => {
    const e = await signUp('EMPLOYER');
    const job = await liveJob(e, ['engine-repair', 'brake-systems']);
    const strong = await worker(['engine-repair', 'brake-systems']);
    const weak = await worker(['welding']);
    const weakApp = (await request(app).post(`/api/v1/jobs/${job}/apply`).set(auth(weak.token)).send({})).body.applicationId;
    const strongApp = (await request(app).post(`/api/v1/jobs/${job}/apply`).set(auth(strong.token)).send({})).body.applicationId;

    const snap = (await prisma.application.findUniqueOrThrow({ where: { id: strongApp } })).matchSnapshot as { score: number; engineVersion: string; explanation: string } | null;
    expect(snap?.engineVersion).toBe('rules-1.0');
    expect(snap?.explanation).toContain('2 of 2 required skills');

    const list = await request(app).get(`/api/v1/jobs/${job}/applications?sort=match`).set(auth(e.token));
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([strongApp, weakApp]);
    expect(list.body.items[0].match.score).toBe(snap!.score); // profile unchanged, so current score equals the snapshot
    expect(list.body.items[0].match.score).toBeGreaterThan(list.body.items[1].match.score);
    expect(list.body.items[0].match.explanation).toBeUndefined(); // brief form only in the list

    const detail = await request(app).get(`/api/v1/applications/${strongApp}`).set(auth(e.token));
    expect(detail.body.match.explanation).toContain('2 of 2 required skills');
    expect(detail.body.match.components.skills.weight).toBe(0.308);
    expect(JSON.stringify(detail.body.match)).not.toContain(strong.phone);

    const cmp = await request(app).get(`/api/v1/applications/compare?ids=${strongApp},${weakApp}`).set(auth(e.token));
    expect(cmp.body.columns[0].match.score).toBeGreaterThan(cmp.body.columns[1].match.score);
  });
});

describe('administrator weights', () => {
  const skillsOnly = { skills: 1, experience: 0, location: 0, qualification: 0, availability: 0, preferences: 0, criteria: 0 };
  const put = (token: string, body: unknown) => request(app).put('/api/v1/admin/match-weights').set(auth(token)).send(body as object);

  it('is for administrators only', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    for (const u of [e, w]) {
      expect((await put(u.token, { categoryId: null, weights: skillsOnly })).status).toBe(403);
      expect((await request(app).get('/api/v1/admin/match-weights').set(auth(u.token))).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/match-weights')).status).toBe(401);
  });

  it('validates weights', async () => {
    const bad: Record<string, unknown>[] = [
      { categoryId: null, weights: { ...skillsOnly, skills: 0.5 } }, // sums to 0.5
      { categoryId: null, weights: { ...skillsOnly, skills: -1, experience: 2 } },
      { categoryId: null, weights: { skills: 1 } }, // missing keys
      { categoryId: null, weights: { ...skillsOnly, bonus: 0 } }, // unknown key
      { categoryId: 'not-a-uuid', weights: skillsOnly },
      { categoryId: '00000000-0000-4000-8000-000000000000', weights: skillsOnly },
    ];
    for (const body of bad) expect((await put(admin.token, body)).status, JSON.stringify(body)).toBe(400);
    expect(await prisma.matchWeights.count({ where: { createdBy: admin.id } })).toBe(0); // nothing invalid was stored
  });

  it('changes scores immediately, versions the change and writes an audit log', async () => {
    const e = await signUp('EMPLOYER');
    const job = await liveJob(e, ['engine-repair', 'brake-systems']);
    const w = await worker(['engine-repair']);
    const before = (await request(app).get(`/api/v1/jobs/${job}/match`).set(auth(w.token))).body.match;
    expect(before.score).toBeLessThan(100);

    const r = await put(admin.token, { categoryId: null, weights: skillsOnly });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
    const after = (await request(app).get(`/api/v1/jobs/${job}/match`).set(auth(w.token))).body.match;
    expect(after.score).toBe(75); // only skills count: 1 exact + 1 related at 0.5 of 2
    expect(after.score).not.toBe(before.score);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { actorId: admin.id, action: 'matching.weights_updated' }, orderBy: { createdAt: 'desc' } });
    expect((log.meta as { version: number }).version).toBe(2);

    const listed = await request(app).get('/api/v1/admin/match-weights').set(auth(admin.token));
    expect(listed.body.global.version).toBe(2);
    expect(listed.body.defaults.skills).toBe(0.308);
    expect(await prisma.matchWeights.count({ where: { categoryId: null, active: true } })).toBe(1);
  });

  it('normalizes weights that nearly sum to one', async () => {
    const r = await put(admin.token, { categoryId: null, weights: { skills: 0.4, experience: 0.2, location: 0.15, qualification: 0.1, availability: 0.1, preferences: 0.05, criteria: 0 } });
    expect(r.status).toBe(200);
    expect(Object.values(r.body.weights as Record<string, number>).reduce((s, n) => s + n, 0)).toBeCloseTo(1, 3);
  });

  it('supports per-category overrides that fall back when removed', async () => {
    const e = await signUp('EMPLOYER');
    const autoJob = await liveJob(e, ['engine-repair', 'brake-systems']);
    const w = await worker(['engine-repair']);
    const global = (await request(app).get(`/api/v1/jobs/${autoJob}/match`).set(auth(w.token))).body.match.score;

    expect((await put(admin.token, { categoryId: autoId, weights: skillsOnly })).status).toBe(200);
    expect((await request(app).get(`/api/v1/jobs/${autoJob}/match`).set(auth(w.token))).body.match.score).toBe(75);
    const overrides = (await request(app).get('/api/v1/admin/match-weights').set(auth(admin.token))).body.overrides;
    expect(overrides).toHaveLength(1);

    // other categories keep the global weights
    const otherCat = await prisma.category.findFirstOrThrow({ where: { slug: 'ict' } });
    const { weights } = await import('../modules/matching/weights').then((m) => m.getWeights(otherCat.id));
    expect(weights.skills).toBe(0.308);

    expect((await request(app).delete(`/api/v1/admin/match-weights/${autoId}`).set(auth(admin.token))).status).toBe(204);
    expect((await request(app).get(`/api/v1/jobs/${autoJob}/match`).set(auth(w.token))).body.match.score).toBe(global);
  });
});
