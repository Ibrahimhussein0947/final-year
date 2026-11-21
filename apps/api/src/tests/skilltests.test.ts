import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { skillTests } from '../../prisma/seed/skillTests';
import { ATTEMPTS_PER_DAY, grade, pick, questionSchema, shuffled, type Picked, type Question } from '../modules/skilltests/service';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
type User = { token: string; id: string };
const newPhone = () => { const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10); phones.push(`+251${p.slice(1)}`); return p; };

async function worker(): Promise<User> {
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: `Test Tester ${randomUUID().slice(0, 6)}`, phone: newPhone(), password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}
let admin: User; let skillId = ''; let testId = '';
const POOL: Question[] = Array.from({ length: 6 }, (_, i) => ({ id: `q${i + 1}`, text: `Question number ${i + 1}?`, options: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: i % 4 }));

beforeAll(async () => {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: 'Test Admin Skill', phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' });
  admin = { token: login.body.accessToken, id: u.id };
  skillId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'guard-duty' } })).id;
  await prisma.skillTest.deleteMany({ where: { skillId } });
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.skillTest.deleteMany({ where: { skillId } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.$disconnect();
});

describe('picking and grading (pure)', () => {
  it('shuffles without losing or repeating anything', () => {
    const out = shuffled([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffled([1, 2, 3], () => 0)).toEqual([2, 3, 1]); // deterministic with a fixed source
  });
  it('asks the requested number of different questions and shuffles each one\'s options', () => {
    const p = pick(POOL, 4);
    expect(p).toHaveLength(4);
    expect(new Set(p.map((x) => x.id)).size).toBe(4);
    for (const x of p) expect([...x.order].sort()).toEqual([0, 1, 2, 3]);
  });
  it('grades by what was shown, whatever order the options were shown in', () => {
    const picked: Picked[] = [{ id: 'q1', order: [2, 0, 1, 3] }, { id: 'q2', order: [3, 2, 1, 0] }, { id: 'q3', order: [0, 1, 2, 3] }];
    // q1 answer is option 0, shown at position 1; q2 answer is option 1, shown at position 2; q3 answer is option 2 at position 2
    expect(grade(POOL, picked, [1, 2, 2])).toEqual({ correct: 3, total: 3, percent: 100 });
    expect(grade(POOL, picked, [0, 2, null])).toMatchObject({ correct: 1, percent: 33 }); // a skipped question is wrong
    expect(grade(POOL, picked, [3, 3, 3])).toMatchObject({ correct: 0, percent: 0 });
  });
  it('refuses a question whose answer is not one of its options, or whose options repeat', () => {
    expect(questionSchema.safeParse({ id: 'a', text: 'Valid question?', options: ['x', 'y'], answer: 2 }).success).toBe(false);
    expect(questionSchema.safeParse({ id: 'a', text: 'Valid question?', options: ['x', 'X'], answer: 0 }).success).toBe(false);
    expect(questionSchema.safeParse({ id: 'a', text: 'Valid question?', options: ['x', 'y'], answer: 1 }).success).toBe(true);
  });
});

describe('the starter tests', () => {
  it('are well formed: valid questions, unique ids, enough to choose from, and skills that exist', async () => {
    for (const t of skillTests) {
      for (const q of t.questions) expect(questionSchema.safeParse(q).success, `${t.skillSlug} ${q.id}`).toBe(true);
      expect(new Set(t.questions.map((q) => q.id)).size).toBe(t.questions.length);
      expect(t.questions.length).toBeGreaterThanOrEqual(t.questionsAsked);
      expect(await prisma.skill.findUnique({ where: { slug: t.skillSlug } })).not.toBeNull();
    }
  });
  it('do not always put the right answer in the same place', () => {
    for (const t of skillTests) expect(new Set(t.questions.map((q) => q.answer)).size, t.title).toBeGreaterThan(1);
  });
});

describe('administrator', () => {
  it('writes tests, with checks, and only administrators may', async () => {
    const w = await worker();
    const body = { skillId, title: 'Guard duty basics', questionsAsked: 4, passPercent: 75, questions: POOL };
    expect((await request(app).post('/api/v1/admin/skill-tests').set(auth(w.token)).send(body)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/skill-tests').set(auth(admin.token)).send({ ...body, questions: POOL.slice(0, 3) })).status).toBe(400); // too few
    expect((await request(app).post('/api/v1/admin/skill-tests').set(auth(admin.token)).send({ ...body, questions: [...POOL.slice(0, 5), { ...POOL[0] }] })).status).toBe(400); // repeated id
    expect((await request(app).post('/api/v1/admin/skill-tests').set(auth(admin.token)).send({ ...body, questions: [{ ...POOL[0], answer: 9 }, ...POOL.slice(1)] })).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/skill-tests').set(auth(admin.token)).send({ ...body, skillId: randomUUID() })).status).toBe(400);
    const ok = await request(app).post('/api/v1/admin/skill-tests').set(auth(admin.token)).send(body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    testId = ok.body.item.id;
    expect((await request(app).post('/api/v1/admin/skill-tests').set(auth(admin.token)).send(body)).status).toBe(409); // one test for a skill
    expect((await request(app).patch(`/api/v1/admin/skill-tests/${testId}`).set(auth(admin.token)).send({ questionsAsked: 9 })).status).toBe(400); // more than the pool
    expect((await request(app).get('/api/v1/admin/skill-tests').set(auth(admin.token))).body.items.some((t: { id: string }) => t.id === testId)).toBe(true);
  });
});

describe('taking a test', () => {
  const start = (u: User) => request(app).post(`/api/v1/skill-tests/${testId}/start`).set(auth(u.token));
  const submit = (u: User, id: string, answers: (number | null)[]) => request(app).post(`/api/v1/skill-test-attempts/${id}/submit`).set(auth(u.token)).send({ answers });
  const addSkill = (u: User) => request(app).put(`/api/v1/workers/me/skills/${skillId}`).set(auth(u.token)).send({ proficiency: 3 });
  /** The shown positions that are right, worked out from what the server stored (the test side of the API never reveals them). */
  async function rightAnswers(attemptId: string) {
    const a = await prisma.skillTestAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { test: true } });
    const pool = a.test.questions as unknown as Question[];
    return (a.picked as unknown as Picked[]).map((p) => p.order.indexOf(pool.find((q) => q.id === p.id)!.answer));
  }

  it('needs the skill on the profile, and never sends the answers to the browser', async () => {
    const w = await worker();
    expect((await start(w)).status).toBe(409);
    const list = await request(app).get('/api/v1/skill-tests').set(auth(w.token));
    expect(list.body.items.find((t: { id: string }) => t.id === testId)).toMatchObject({ canTake: false, hasSkill: false });
    await addSkill(w);
    const s = await start(w);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.questions).toHaveLength(4);
    expect(JSON.stringify(s.body)).not.toMatch(/"answer"|"order"|"picked"/);
    for (const q of s.body.questions) expect(q.options.slice().sort()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    expect((await start(w)).body.attemptId).toBe(s.body.attemptId); // starting again continues, it does not cost an attempt
    expect(await prisma.skillTestAttempt.count({ where: { workerId: (await prisma.workerProfile.findFirstOrThrow({ where: { userId: w.id } })).id } })).toBe(1);
  });

  it('marks the skill tested only after a pass, once, and not again for 90 days', async () => {
    const w = await worker();
    await addSkill(w);
    const first = (await start(w)).body.attemptId as string;
    expect((await submit(w, first, [0, 0, 0])).status).toBe(400); // wrong number of answers
    const bad = await submit(w, first, [null, null, null, null]);
    expect(bad.body.result).toMatchObject({ correct: 0, passed: false, attemptsLeftToday: ATTEMPTS_PER_DAY - 1 });
    expect((await submit(w, first, [0, 0, 0, 0])).status).toBe(409); // handed in once
    let skills = (await request(app).get('/api/v1/workers/me').set(auth(w.token))).body.profile.skills;
    expect(skills.find((s: { skillId: string }) => s.skillId === skillId).tested).toBeNull();

    const second = (await start(w)).body.attemptId as string;
    const good = await submit(w, second, await rightAnswers(second));
    expect(good.body.result).toMatchObject({ correct: 4, total: 4, percent: 100, passed: true });
    skills = (await request(app).get('/api/v1/workers/me').set(auth(w.token))).body.profile.skills;
    expect(skills.find((s: { skillId: string }) => s.skillId === skillId).tested).toMatchObject({ score: 100 });
    expect(skills.find((s: { skillId: string }) => s.skillId === skillId).source).toBe('SELF_REPORTED'); // tested is not verified
    expect((await start(w)).status).toBe(409);
  });

  it('limits attempts per day, and a late hand-in does not count', async () => {
    const w = await worker();
    await addSkill(w);
    const a = (await start(w)).body.attemptId as string;
    await prisma.skillTestAttempt.update({ where: { id: a }, data: { startedAt: new Date(Date.now() - 40 * 60_000) } });
    expect((await submit(w, a, await rightAnswers(a))).status).toBe(409); // even right answers, too late
    const row = await prisma.skillTestAttempt.findUniqueOrThrow({ where: { id: a } });
    expect(row).toMatchObject({ passed: false, correct: 0 });

    for (let i = 0; i < ATTEMPTS_PER_DAY - 1; i++) {
      const id = (await start(w)).body.attemptId as string;
      await submit(w, id, [null, null, null, null]);
    }
    expect((await start(w)).status).toBe(429);
    const list = await request(app).get('/api/v1/skill-tests').set(auth(w.token));
    expect(list.body.items.find((t: { id: string }) => t.id === testId)).toMatchObject({ canTake: false, attemptsLeftToday: 0 });
  });

  it('cannot be handed in by someone else', async () => {
    const a = await worker(); const b = await worker();
    await addSkill(a);
    const id = (await start(a)).body.attemptId as string;
    expect((await submit(b, id, [null, null, null, null])).status).toBe(404);
  });
});
