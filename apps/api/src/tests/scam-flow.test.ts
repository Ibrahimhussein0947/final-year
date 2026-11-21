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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}
async function employer(): Promise<User> {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Test EMPLOYER', phone: newPhone(), password: 'Passw0rdTest', role: 'EMPLOYER', region: 'Oromia', zone: 'Adama', language: 'en',
    organizationName: `TEST_ORG Scam ${tag()}`, organizationType: 'SME',
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}
async function makeAdmin(): Promise<User> {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: 'Test Admin', phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' });
  return { token: login.body.accessToken, id: u.id };
}

let autoId = '';
let skills: string[] = [];
let admin: User;

async function draft(e: User, description: string) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Scam test ${tag()}`, description: `${description} ${randomUUID()} ${randomUUID()}`,
    categoryId: autoId, employmentType: 'FULL_TIME', deadline: future(30), minExperienceYears: 2,
    locationId: (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id,
    skills: skills.map((skillId) => ({ skillId, importance: 'REQUIRED' })),
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  return create.body.job.id as string;
}
const publish = (e: User, id: string) => request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({});

beforeAll(async () => {
  autoId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  skills = (await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems'] } } })).map((s) => s.id);
  admin = await makeAdmin();
});
afterAll(async () => {
  const ids = (await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } })).map((u) => u.id);
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.employerProfile.deleteMany({ where: { OR: [{ userId: { in: ids } }, { organization: { name: { startsWith: 'TEST_ORG' } } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('scam screening on publish', () => {
  it('publishes a normal job straight away', async () => {
    const e = await employer();
    const res = await publish(e, await draft(e, 'Repair vehicles. Please apply with your experience and references.'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ flaggedAsRisky: false, job: { status: 'ACTIVE' } });
  });

  it('holds a job that asks for a fee, hides it from the public, and shows the admin why', async () => {
    const e = await employer();
    const id = await draft(e, 'Mechanic for Dubai. Pay a registration fee of 3000 birr to confirm your visa.');
    const res = await publish(e, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ flaggedAsRisky: true, flaggedAsCopy: false, job: { status: 'PENDING_REVIEW' } });
    expect((await request(app).get(`/api/v1/jobs/${id}`)).status).toBe(404); // not public while held

    const item = (await request(app).get('/api/v1/admin/moderation/jobs').set(auth(admin.token))).body.items.find((j: { id: string }) => j.id === id);
    expect(item).toMatchObject({ reason: 'Possible scam wording', scamScore: expect.any(Number) });
    expect(item.scamSignals.map((s: { code: string }) => s.code)).toEqual(expect.arrayContaining(['UPFRONT_FEE', 'ABROAD_OFFER']));
    expect(await prisma.auditLog.count({ where: { action: 'job.published_flagged_risky', entityId: id } })).toBe(1);

    // The administrator can still approve a false alarm.
    expect((await request(app).post(`/api/v1/admin/moderation/jobs/${id}/review`).set(auth(admin.token)).send({ decision: 'APPROVE' })).status).toBe(200);
    expect((await request(app).get(`/api/v1/jobs/${id}`)).status).toBe(200);
  });

  it('sends a live job back for review when it is edited into a scam', async () => {
    const e = await employer();
    const id = await draft(e, 'Repair vehicles. Please apply with your experience and references.');
    expect((await publish(e, id)).body.job.status).toBe('ACTIVE');
    const edit = await request(app).patch(`/api/v1/jobs/${id}`).set(auth(e.token)).send({ description: `Send us your passport and bank details to start. ${randomUUID()} ${randomUUID()}` });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING_REVIEW');
  });
});
