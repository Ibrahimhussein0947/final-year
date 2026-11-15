import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

const newPhone = () => {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
};
async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: newPhone(), password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Training ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}
async function admin(): Promise<User> {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('AdminPass123', 4), fullName: 'T Admin', role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'AdminPass123' });
  return { token: login.body.accessToken, id: u.id };
}

let categoryId = '';
let skillA = '';
let skillB = '';
let skillC = '';

beforeAll(async () => {
  const cat = await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } });
  categoryId = cat.id;
  const skills = await prisma.skill.findMany({ where: { categoryId }, take: 3, orderBy: { slug: 'asc' } });
  [skillA, skillB, skillC] = skills.map((s) => s.id);
});

afterAll(async () => {
  await prisma.trainingCourse.deleteMany({ where: { provider: { startsWith: 'TEST_PROVIDER' } } });
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

const course = (over: Record<string, unknown> = {}) => ({
  title: `Course ${tag()}`, provider: `TEST_PROVIDER ${tag()}`, online: true, costEtb: 0, durationText: '4 weeks', languages: ['English'], skillIds: [skillA], ...over,
});

describe('training courses (admin)', () => {
  it('lets an administrator add, change and remove a course, and nobody else', async () => {
    const a = await admin();
    const w = await signUp('WORKER');
    expect((await request(app).post('/api/v1/admin/training').set(auth(w.token)).send(course())).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/training')).status).toBe(401);

    const made = await request(app).post('/api/v1/admin/training').set(auth(a.token)).send(course({ url: 'https://example.org/course' }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.item).toMatchObject({ free: true, online: true, url: 'https://example.org/course' });
    const id = made.body.item.id;

    const patched = await request(app).patch(`/api/v1/admin/training/${id}`).set(auth(a.token)).send({ costEtb: 1500, skillIds: [skillB, skillC] });
    expect(patched.body.item.costEtb).toBe(1500);
    expect(patched.body.item.free).toBe(false);
    expect(patched.body.item.skills.map((s: { id: string }) => s.id).sort()).toEqual([skillB, skillC].sort());

    expect((await request(app).delete(`/api/v1/admin/training/${id}`).set(auth(a.token))).status).toBe(204);
    expect((await request(app).delete(`/api/v1/admin/training/${id}`).set(auth(a.token))).status).toBe(404);
  });

  it('rejects unsafe links, unknown skills and a course that teaches nothing', async () => {
    const a = await admin();
    const post = (body: object) => request(app).post('/api/v1/admin/training').set(auth(a.token)).send(body);
    expect((await post(course({ url: 'javascript:alert(1)' }))).status).toBe(400);
    expect((await post(course({ skillIds: [randomUUID()] }))).status).toBe(400);
    expect((await post(course({ skillIds: [] }))).status).toBe(400);
  });
});

describe('training suggestions (worker)', () => {
  async function liveJob(e: User, skillIds: string[]) {
    const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
      title: `Mechanic ${tag()}`, description: `Workshop role for the training test. ${randomUUID()} ${randomUUID()} Apply with references.`,
      categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE',
      skills: skillIds.map((skillId, i) => ({ skillId, importance: i === 0 ? 'REQUIRED' : 'PREFERRED' })),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
    return create.body.job.id as string;
  }

  it('finds the skills a job needs that the worker lacks and the courses that teach them, best first', async () => {
    const a = await admin();
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId });
    expect((await request(app).put(`/api/v1/workers/me/skills/${skillC}`).set(auth(w.token)).send({ proficiency: 3 })).status).toBe(200);

    const jobId = await liveJob(e, [skillA, skillB, skillC]); // worker already has C
    const both = await request(app).post('/api/v1/admin/training').set(auth(a.token)).send(course({ title: 'Covers both', skillIds: [skillA, skillB], costEtb: 800 }));
    const one = await request(app).post('/api/v1/admin/training').set(auth(a.token)).send(course({ title: 'Covers one', skillIds: [skillA] }));
    const unrelated = await request(app).post('/api/v1/admin/training').set(auth(a.token)).send(course({ title: 'Only the skill I have', skillIds: [skillC] }));
    const hidden = await request(app).post('/api/v1/admin/training').set(auth(a.token)).send(course({ title: 'Hidden', skillIds: [skillA, skillB], isActive: false }));
    expect([both, one, unrelated, hidden].every((r) => r.status === 201)).toBe(true);

    const res = await request(app).get(`/api/v1/training/suggestions?jobId=${jobId}`).set(auth(w.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.basis).toBe('job');
    expect(res.body.gaps.map((g: { skillId: string }) => g.skillId).sort()).toEqual([skillA, skillB].sort());
    expect(res.body.gaps.find((g: { skillId: string }) => g.skillId === skillA).reason).toBe('Required for this job');
    const titles = res.body.items.map((c: { title: string }) => c.title);
    expect(titles[0]).toBe('Covers both'); // covers two gaps, so it comes first even though it costs money
    expect(titles).toContain('Covers one');
    expect(titles).not.toContain('Only the skill I have');
    expect(titles).not.toContain('Hidden');
    expect(res.body.gaps.every((g: { hasCourse: boolean }) => g.hasCourse)).toBe(true);
  });

  it('says when no course is listed for a gap, instead of inventing one', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const lonely = (await prisma.skill.findMany({ where: { categoryId }, skip: 3, take: 1, orderBy: { slug: 'asc' } }))[0];
    const jobId = await liveJob(e, [lonely.id]);
    const res = await request(app).get(`/api/v1/training/suggestions?jobId=${jobId}`).set(auth(w.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.gaps).toEqual([expect.objectContaining({ skillId: lonely.id, hasCourse: false })]);
  });

  it('without a job, suggests from what open jobs in the worker\'s field require', async () => {
    const a = await admin();
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId });
    await liveJob(e, [skillB]);
    await request(app).post('/api/v1/admin/training').set(auth(a.token)).send(course({ title: 'For the market', skillIds: [skillB] }));
    const res = await request(app).get('/api/v1/training/suggestions').set(auth(w.token));
    expect(res.status).toBe(200);
    expect(res.body.basis).toBe('market');
    expect(res.body.items.map((c: { title: string }) => c.title)).toContain('For the market');
  });

  it('is for workers only and rejects an unknown job', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    expect((await request(app).get('/api/v1/training/suggestions').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/training/suggestions?jobId=${randomUUID()}`).set(auth(w.token))).status).toBe(404);
    expect((await request(app).get('/api/v1/training/suggestions?jobId=nope').set(auth(w.token))).status).toBe(400);
  });
});
