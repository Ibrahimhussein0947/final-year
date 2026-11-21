import { randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { stepInputSchema, stepStatuses } from '../modules/hiring/steps';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', orgType = 'SME'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag()}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Methods ${tag()}`, organizationType: orgType } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}
let categoryId = ''; let skillId = ''; let zoneId = ''; let adminId = '';
const adminToken = () => jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: adminId, expiresIn: '10m' });
const SAVED = ['COOPERATIVE', 'HOUSEHOLD'] as const;
const saved: Record<string, unknown> = {};

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'business' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'office-admin' } })).id;
  zoneId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  adminId = (await prisma.user.create({ data: { phone: `+251${p.slice(1)}`, passwordHash: 'x', fullName: 'Methods Admin', role: 'ADMIN' } })).id;
  // Remember the two policies this file edits, so a failed run leaves nothing changed.
  for (const t of SAVED) saved[t] = await prisma.hiringPolicy.findUnique({ where: { organizationType: t } });
});
afterAll(async () => {
  for (const t of SAVED) {
    const { updatedAt: _u, ...row } = (saved[t] ?? { organizationType: t }) as Record<string, unknown>;
    await prisma.hiringPolicy.upsert({ where: { organizationType: t }, update: row as never, create: row as never });
  }
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG Methods' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG Methods' } } });
  await prisma.$disconnect();
});

const verify = async (e: User) => {
  const ep = await prisma.employerProfile.findFirstOrThrow({ where: { userId: e.id } });
  await prisma.organization.update({ where: { id: ep.organizationId }, data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() } });
};
let ref = 0;
async function setup(orgType: string) {
  const e = await signUp('EMPLOYER', orgType);
  await verify(e);
  const j = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Office officer ${tag()}`, description: `We need an office administrator for our team. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', locationId: zoneId, skills: [{ skillId, importance: 'REQUIRED' }], deadline: day(30), salaryMin: 8000, referenceNumber: `M-${Date.now().toString(36)}-${ref++}`,
  });
  expect(j.status, JSON.stringify(j.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${j.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  const w = await signUp('WORKER');
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId, headline: 'Office administrator', yearsExperience: 4, availability: 'IMMEDIATELY', locationId: zoneId });
  await request(app).put(`/api/v1/workers/me/skills/${skillId}`).set(auth(w.token)).send({ proficiency: 4 });
  const applied = await request(app).post(`/api/v1/jobs/${j.body.job.id}/apply`).set(auth(w.token)).send({});
  expect(applied.status).toBe(201);
  const workerProfile = await prisma.workerProfile.findFirstOrThrow({ where: { userId: w.id } });
  return { e, w, jobId: j.body.job.id as string, appId: applied.body.applicationId as string, workerProfileId: workerProfile.id };
}
const status = (e: User, id: string, to: string, note?: string) => request(app).patch(`/api/v1/applications/${id}/status`).set(auth(e.token)).send({ status: to, ...(note ? { note } : {}) });
const step = (e: User, id: string, body: object) => request(app).post(`/api/v1/applications/${id}/steps`).set(auth(e.token)).send(body);
const sheet = (panelist: string, n = 4) => ({ kind: 'SCORE_SHEET', panelist, scores: { skills: n, experience: n, communication: n, suitability: n } });
const approveId = (userId: string, workerId: string) => prisma.verificationRequest.create({ data: { userId, kind: 'IDENTITY', targetType: 'NATIONAL_ID', targetId: workerId, status: 'APPROVED' } });

describe('what each step records (pure)', () => {
  it('accepts well-formed steps and refuses the rest', () => {
    expect(stepInputSchema.safeParse({ kind: 'WRITTEN_EXAM', score: 72.5, examDate: day(-2) }).success).toBe(true);
    expect(stepInputSchema.safeParse({ kind: 'WRITTEN_EXAM', score: 101, examDate: day(-2) }).success).toBe(false);
    expect(stepInputSchema.safeParse({ kind: 'WRITTEN_EXAM', score: 50, examDate: day(5) }).success).toBe(false); // future
    expect(stepInputSchema.safeParse({ kind: 'PRACTICAL_TEST', score: 80, testDate: day(-1), task: 'Lay a 2 m wall' }).success).toBe(true);
    expect(stepInputSchema.safeParse({ kind: 'PRACTICAL_TEST', score: 80, testDate: day(-1) }).success).toBe(false); // the task is required
    expect(stepInputSchema.safeParse({ kind: 'PRACTICAL_TEST', score: 80, testDate: day(3), task: 'Lay a wall' }).success).toBe(false); // future
    expect(stepInputSchema.safeParse(sheet('Abebe Kebede')).success).toBe(true);
    expect(stepInputSchema.safeParse({ ...sheet('Abebe Kebede'), scores: { skills: 6, experience: 1, communication: 1, suitability: 1 } }).success).toBe(false);
    expect(stepInputSchema.safeParse(sheet('A1<script>')).success).toBe(false);
    expect(stepInputSchema.safeParse({ kind: 'GUARANTOR_RECORDED', guarantor: 'Kebede Alemu', relationship: 'Neighbour', idSeen: false }).success).toBe(false);
    expect(stepInputSchema.safeParse({ kind: 'GUARANTOR_RECORDED', guarantor: 'Kebede Alemu', relationship: 'Neighbour', idSeen: true, phone: '0911' }).success).toBe(false); // no phone numbers of third people
    expect(stepInputSchema.safeParse({ kind: 'REFERENCE_CHECKED', referee: 'Almaz Tesfaye', outcome: 'GREAT' }).success).toBe(false);
  });
  it('counts distinct panel members, ignoring case, against the panel size', () => {
    const rec = [{ kind: 'SCORE_SHEET', data: { panelist: 'Abebe Kebede' } }, { kind: 'SCORE_SHEET', data: { panelist: 'abebe kebede' } }, { kind: 'SCORE_SHEET', data: { panelist: 'Almaz T' } }];
    const s = stepStatuses({ requiredSteps: ['SCORE_SHEET'], suggestedSteps: [], panelSize: 3 }, rec, false);
    expect(s).toEqual([expect.objectContaining({ key: 'SCORE_SHEET', required: true, done: false, detail: '2 of 3 panel members' })]);
    expect(stepStatuses({ requiredSteps: ['SCORE_SHEET'], suggestedSteps: [], panelSize: 2 }, rec, false)[0].done).toBe(true);
  });
});

describe('recruitment steps for each kind of organization', () => {
  it('an NGO needs ID, a two-member panel and a reference before accepting, and the employer is told exactly what is missing', async () => {
    const { e, w, appId, workerProfileId } = await setup('NGO');
    await status(e, appId, 'SHORTLISTED');
    await request(app).post(`/api/v1/applications/${appId}/interviews`).set(auth(e.token)).send({ scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), mode: 'IN_PERSON', locationOrLink: 'Office' });
    await prisma.job.updateMany({ where: { applications: { some: { id: appId } } }, data: { deadline: new Date(Date.now() - 3_600_000) } });
    const note = 'Selected by the panel after interviews.';

    const first = await status(e, appId, 'ACCEPTED', note);
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('STEPS_REQUIRED');
    expect(first.body.error.details.missing).toEqual(['Identity checked', 'Selection panel score sheet', 'Reference checked']);

    // what the employer screen shows
    const view = await request(app).get(`/api/v1/applications/${appId}/hiring`).set(auth(e.token));
    expect(view.body.steps.map((s: { key: string; required: boolean; done: boolean }) => [s.key, s.required, s.done])).toEqual([
      ['ID_VERIFIED', true, false], ['WRITTEN_EXAM', false, false], ['SCORE_SHEET', true, false], ['REFERENCE_CHECKED', true, false],
    ]);

    expect((await step(e, appId, sheet('Abebe Kebede'))).status).toBe(201);
    expect((await step(e, appId, sheet('abebe kebede', 2))).status).toBe(409); // the same member twice
    expect((await step(e, appId, sheet('Almaz Tesfaye', 5))).status).toBe(201);
    expect((await step(e, appId, { kind: 'REFERENCE_CHECKED', referee: 'Dawit Hailu', outcome: 'POSITIVE', note: 'Reliable for three years.' })).status).toBe(201);
    expect((await status(e, appId, 'ACCEPTED', note)).body.error.details.missing).toEqual(['Identity checked']); // still the ID

    await approveId(w.id, workerProfileId);
    const done = await status(e, appId, 'ACCEPTED', note);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    // once decided the record cannot be changed
    expect((await step(e, appId, sheet('Dawit Hailu'))).status).toBe(409);
  });

  it('a household is only shown good practice: nothing is enforced', async () => {
    const { e, appId } = await setup('HOUSEHOLD');
    await status(e, appId, 'SHORTLISTED');
    const view = await request(app).get(`/api/v1/applications/${appId}/hiring`).set(auth(e.token));
    expect(view.body.steps.map((s: { key: string; required: boolean; suggested: boolean }) => [s.key, s.required, s.suggested])).toEqual([
      ['ID_VERIFIED', false, true], ['REFERENCE_CHECKED', false, true], ['GUARANTOR_RECORDED', false, true],
    ]);
    expect((await step(e, appId, { kind: 'GUARANTOR_RECORDED', guarantor: 'Kebede Alemu', relationship: 'Neighbour', idSeen: true })).status).toBe(201);
    expect((await status(e, appId, 'ACCEPTED')).status).toBe(200);
  });

  it('an administrator can change what a type requires, and it applies at once', async () => {
    const { e, appId } = await setup('COOPERATIVE');
    await status(e, appId, 'SHORTLISTED');
    const set = (b: object) => request(app).patch('/api/v1/admin/hiring-policies/COOPERATIVE').set(auth(adminToken())).send(b);
    expect((await set({ requiredSteps: ['WRITTEN_EXAM', 'GUARANTOR_RECORDED'], suggestedSteps: ['WRITTEN_EXAM', 'REFERENCE_CHECKED'] })).status).toBe(204);
    const row = await prisma.hiringPolicy.findUniqueOrThrow({ where: { organizationType: 'COOPERATIVE' } });
    expect(row.suggestedSteps).toEqual(['REFERENCE_CHECKED']); // required wins over suggested
    expect((await set({ requiredSteps: ['TELEPATHY'] })).status).toBe(400);
    expect((await set({ panelSize: 0 })).status).toBe(400);
    const blocked = await status(e, appId, 'ACCEPTED');
    expect(blocked.body.error.code).toBe('STEPS_REQUIRED');
    expect(blocked.body.error.details.missing).toEqual(['Written exam', 'Guarantor recorded']);
    await set({ requiredSteps: [] });
    expect((await status(e, appId, 'ACCEPTED')).status).toBe(200);
  });

  it("only the owning employer can read or record an application's steps, and the worker sees only which steps were done", async () => {
    const { e, w, appId } = await setup('SME');
    const other = await signUp('EMPLOYER', 'SME');
    expect((await step(other, appId, sheet('Abebe Kebede'))).status).toBe(404);
    expect((await request(app).get(`/api/v1/applications/${appId}/hiring`).set(auth(other.token))).status).toBe(404);
    expect((await step(w, appId, sheet('Abebe Kebede'))).status).toBe(403);
    const made = await step(e, appId, { kind: 'WRITTEN_EXAM', score: 64, examDate: day(-1), note: 'private note' });
    expect(made.status).toBe(201);
    const mine = await request(app).get('/api/v1/applications/mine').set(auth(w.token));
    expect(mine.body.items[0].selectionSteps).toEqual(['WRITTEN_EXAM']);
    // The score must not leak. Checked as a field name: the digits "64" can appear by chance inside a random id or timestamp.
    expect(JSON.stringify(mine.body)).not.toMatch(/"score"|"examDate"/);
    expect(JSON.stringify(mine.body)).not.toContain('private note');
    expect((await request(app).delete(`/api/v1/applications/${appId}/steps/${made.body.step.id}`).set(auth(e.token))).status).toBe(200);
    expect((await request(app).get('/api/v1/applications/mine').set(auth(w.token))).body.items[0].selectionSteps).toEqual([]);
  });
});

describe('probation in an offer', () => {
  it('may not be longer than the organization type allows', async () => {
    const { e, appId } = await setup('PRIVATE_COMPANY'); // 45 days
    await status(e, appId, 'SHORTLISTED');
    await status(e, appId, 'ACCEPTED');
    const offer = (b: object) => request(app).post(`/api/v1/applications/${appId}/offer`).set(auth(e.token)).send({ startDate: day(10), ...b });
    const long = await offer({ probationDays: 90 });
    expect(long.status).toBe(400);
    expect(long.body.error.details.probationDays[0]).toContain('45');
    const ok = await offer({ probationDays: 45 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.offer.probationDays).toBe(45);

    const home = await setup('HOUSEHOLD'); // no limit set
    await status(home.e, home.appId, 'SHORTLISTED');
    await status(home.e, home.appId, 'ACCEPTED');
    expect((await request(app).post(`/api/v1/applications/${home.appId}/offer`).set(auth(home.e.token)).send({ startDate: day(10), probationDays: 120 })).status).toBe(201);
  });
});

describe('asking for a review of a rejection', () => {
  const appeal = (u: User, id: string, reason = 'I have the required certificate and can send it.') => request(app).post(`/api/v1/applications/${id}/appeal`).set(auth(u.token)).send({ reason });
  async function rejected(orgType: string) {
    const s = await setup(orgType);
    const note = 'Does not meet the minimum qualification in the announcement.';
    expect((await status(s.e, s.appId, 'REJECTED', note)).status).toBe(200);
    return s;
  }

  it('is possible where the type allows it: once, in time, answered in writing, and can reopen the application', async () => {
    const { e, w, appId } = await rejected('PUBLIC_ENTERPRISE'); // 7 days
    const card = (await request(app).get('/api/v1/applications/mine').set(auth(w.token))).body.items[0];
    expect(card.appeal).toMatchObject({ canAppeal: true, days: 7, appeal: null });

    expect((await appeal(w, appId, 'too short')).status).toBe(400);
    expect((await appeal(await signUp('WORKER'), appId)).status).toBe(404); // someone else's application
    expect((await appeal(e, appId)).status).toBe(403); // an employer cannot
    expect((await appeal(w, appId)).status).toBe(201);
    expect((await appeal(w, appId)).status).toBe(409); // once
    expect((await prisma.notification.count({ where: { userId: e.id, type: 'appeal.received' } }))).toBe(1);

    const seen = await request(app).get(`/api/v1/applications/${appId}/appeal`).set(auth(e.token));
    expect(seen.body.appeal).toMatchObject({ answered: false });
    const answer = (b: object) => request(app).post(`/api/v1/applications/${appId}/appeal/answer`).set(auth(e.token)).send(b);
    expect((await answer({ outcome: 'REOPENED', reply: 'ok' })).status).toBe(400); // a reply is needed
    expect((await answer({ outcome: 'REOPENED', reply: 'We looked again and the certificate was attached.' })).status).toBe(200);
    expect((await answer({ outcome: 'UPHELD', reply: 'Changed our minds again later on.' })).status).toBe(409);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: appId } })).status).toBe('UNDER_REVIEW');
    const told = await prisma.notification.findMany({ where: { userId: w.id, type: 'appeal.answered' } });
    expect((told[0].payload as { outcome: string }).outcome).toBe('REOPENED');
    expect((await request(app).get('/api/v1/applications/mine').set(auth(w.token))).body.items[0].appeal.appeal).toMatchObject({ answered: true, outcome: 'REOPENED' });
  });

  it('is not offered where the type does not take reviews, or after the time has passed', async () => {
    const ngo = await rejected('NGO'); // appealDays 0
    expect((await appeal(ngo.w, ngo.appId)).status).toBe(403);
    expect((await request(app).get('/api/v1/applications/mine').set(auth(ngo.w.token))).body.items[0].appeal).toMatchObject({ canAppeal: false });

    const late = await rejected('GOVERNMENT'); // 7 days
    await prisma.applicationStatusHistory.updateMany({ where: { applicationId: late.appId, toStatus: 'REJECTED' }, data: { createdAt: new Date(Date.now() - 9 * 86_400_000) } });
    expect((await appeal(late.w, late.appId)).status).toBe(409);

    const open = await setup('PUBLIC_ENTERPRISE'); // not rejected
    expect((await appeal(open.w, open.appId)).status).toBe(409);
  });

  it('can be answered "the decision stands", which leaves the application rejected', async () => {
    const { e, w, appId } = await rejected('PUBLIC_ENTERPRISE');
    await appeal(w, appId);
    const r = await request(app).post(`/api/v1/applications/${appId}/appeal/answer`).set(auth(e.token)).send({ outcome: 'UPHELD', reply: 'The required certificate was not in the application.' });
    expect(r.status).toBe(200);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: appId } })).status).toBe('REJECTED');
  });
});
