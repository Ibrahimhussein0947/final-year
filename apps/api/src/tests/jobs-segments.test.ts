import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { monthlyEquivalent, typeAccepted } from '../modules/jobs/classification';
import { analyzeJob } from '../modules/analysis/jobAnalyzer';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

async function signUp(orgType: string): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Test EMPLOYER', phone: p, password: 'Passw0rdTest', role: 'EMPLOYER', region: 'Oromia', zone: 'Adama', language: 'en',
    organizationName: `TEST_ORG Seg ${tag()}`, organizationType: orgType,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let categoryId = '';
let skillId = '';
let zoneId = '';

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'business' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'office-admin' } })).id;
  zoneId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

async function liveJob(e: User, title: string, employmentType: string, extra: Record<string, unknown> = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title, description: `We need a person for this work. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType, locationId: zoneId, skills: [{ skillId, importance: 'REQUIRED' }], deadline: day(30), ...extra,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
}

describe('classifying a job beyond its category', () => {
  it('accepts the wider employment types, a seniority level and the groups a job welcomes, and filters by them', async () => {
    const w = tag();
    const company = await signUp('PRIVATE_COMPANY');
    await liveJob(company, `Lecturer ${w} permanent`, 'PERMANENT', { seniority: 'SENIOR', openTo: ['DISABILITY', 'DISABILITY', 'STUDENTS'] });
    await liveJob(company, `Helper ${w} volunteer`, 'VOLUNTEER', { seniority: 'ENTRY', openTo: ['REFUGEES'] });
    await liveJob(company, `Courier ${w} gig`, 'GIG');
    const get = async (qs: string) => (await request(app).get(`/api/v1/jobs?q=${w}&${qs}`)).body.items as { title: string; openTo: string[]; seniority: string | null }[];

    expect((await get('type=VOLUNTEER')).map((j) => j.title)).toEqual([`Helper ${w} volunteer`]);
    expect((await get('seniority=SENIOR')).map((j) => j.title)).toEqual([`Lecturer ${w} permanent`]);
    const welcoming = await get('openTo=DISABILITY');
    expect(welcoming.map((j) => j.title)).toEqual([`Lecturer ${w} permanent`]);
    expect(welcoming[0].openTo.sort()).toEqual(['DISABILITY', 'STUDENTS']); // duplicates are dropped
    expect((await get('segment=flexible')).map((j) => j.title)).toEqual([`Courier ${w} gig`].concat(`Helper ${w} volunteer`).filter((t) => t.includes('gig')));
    expect((await request(app).get('/api/v1/jobs?openTo=everyone')).status).toBe(400);
    const bad = await request(app).post('/api/v1/jobs').set(auth(company.token)).send({ title: 'Some job title', description: 'x'.repeat(40), categoryId, employmentType: 'SLAVERY' });
    expect(bad.status).toBe(400);
  });

  it('describes pay, workplace, recruitment method and benefits as separate dimensions and filters by them', async () => {
    const w = tag();
    const farm = await signUp('AGRICULTURAL');
    await liveJob(farm, `Picker ${w} daily`, 'DAILY', { payBasis: 'DAILY', salaryMin: 500, salaryMax: 700, workplace: 'FARM', recruitmentMethod: 'SEASONAL', benefitTags: ['FOOD', 'TRANSPORT', 'FOOD'] });
    await liveJob(farm, `Clerk ${w} monthly`, 'FULL_TIME', { payBasis: 'MONTHLY', salaryMin: 8000, salaryMax: 9000, workplace: 'OFFICE', benefitTags: ['PENSION'] });
    await liveJob(farm, `Mason ${w} project`, 'CONTRACT', { payBasis: 'PER_PROJECT', salaryMin: 50000, salaryMax: 50000, workplace: 'CONSTRUCTION_SITE' });
    const get = async (qs: string) => (await request(app).get(`/api/v1/jobs?q=${w}&${qs}`)).body.items as { title: string; benefitTags: string[]; payBasis: string | null; workplace: string | null }[];
    const titles = async (qs: string) => (await get(qs)).map((j) => j.title).sort();

    expect(await titles('workplace=FARM')).toEqual([`Picker ${w} daily`]);
    expect(await titles('payBasis=PER_PROJECT')).toEqual([`Mason ${w} project`]);
    expect(await titles('benefit=PENSION')).toEqual([`Clerk ${w} monthly`]);
    expect((await get('workplace=FARM'))[0].benefitTags.sort()).toEqual(['FOOD', 'TRANSPORT']);
    expect(await titles('recruitmentMethod=SEASONAL')).toEqual([`Picker ${w} daily`]);
    // "At least 10,000 a month": 700 a day is about 18,200 a month; 9,000 a month is not enough; a project fee is not compared.
    expect(await titles('minSalary=10000')).toEqual([`Picker ${w} daily`]);
    expect(await titles('minSalary=8500')).toEqual([`Clerk ${w} monthly`, `Picker ${w} daily`]);
    expect((await request(app).get('/api/v1/jobs?workplace=moon')).status).toBe(400);
  });

  it('brings daily, weekly and hourly pay to a month, and leaves other pay out of comparisons', () => {
    expect(monthlyEquivalent(9000, 'MONTHLY')).toBe(9000);
    expect(monthlyEquivalent(9000, null)).toBe(9000); // older jobs state no basis: monthly
    expect(monthlyEquivalent(500, 'DAILY')).toBe(13000);
    expect(monthlyEquivalent(2000, 'WEEKLY')).toBe(8000);
    expect(monthlyEquivalent(50, 'HOURLY')).toBe(10400);
    for (const b of ['PER_PROJECT', 'COMMISSION', 'PIECE_RATE', 'PERFORMANCE', 'NEGOTIABLE', 'UNPAID']) expect(monthlyEquivalent(5000, b), b).toBeNull();
    expect(monthlyEquivalent(null, 'DAILY')).toBeNull();
  });

  it('treats permanent like full-time, and casual like daily, for a worker who prefers one', () => {
    expect(typeAccepted(['FULL_TIME'], 'PERMANENT')).toBe(true);
    expect(typeAccepted(['PERMANENT'], 'FULL_TIME')).toBe(true);
    expect(typeAccepted(['DAILY'], 'CASUAL')).toBe(true);
    expect(typeAccepted(['FULL_TIME'], 'GIG')).toBe(false);
  });

  it('reads the new employment types from a job text', () => {
    const kind = (description: string) => analyzeJob({ description }, [], []).employmentType.value;
    expect(kind('Volunteer needed to help at the clinic, unpaid role')).toBe('VOLUNTEER');
    expect(kind('Apprenticeship for a young mechanic')).toBe('APPRENTICESHIP');
    expect(kind('Permanent position for an accountant')).toBe('PERMANENT');
    expect(kind('Full-time cashier, work extra hours when needed')).toBe('FULL_TIME');
  });
});

describe('browsing the market by segment', () => {
  it('sorts formal, informal, flexible and self-employment work, and lets them overlap', async () => {
    const w = tag();
    const company = await signUp('PRIVATE_COMPANY');
    const family = await signUp('HOUSEHOLD');
    await liveJob(company, `Accountant ${w} formal`, 'FULL_TIME');
    await liveJob(company, `Packer ${w} daily`, 'DAILY');
    await liveJob(family, `Cleaner ${w} household`, 'PART_TIME');
    await liveJob(family, `Plumber ${w} service`, 'CONTRACT');
    await liveJob(company, `Designer ${w} freelance`, 'FREELANCE');
    const titles = async (s: string) => ((await request(app).get(`/api/v1/jobs?q=${w}&segment=${s}`)).body.items.map((i: { title: string }) => i.title) as string[]).sort();

    expect(await titles('formal')).toEqual([`Accountant ${w} formal`, `Designer ${w} freelance`, `Packer ${w} daily`]);
    expect(await titles('informal')).toEqual([`Cleaner ${w} household`, `Packer ${w} daily`, `Plumber ${w} service`]);
    expect(await titles('flexible')).toEqual([`Cleaner ${w} household`, `Designer ${w} freelance`, `Packer ${w} daily`, `Plumber ${w} service`]);
    expect(await titles('self_employment')).toEqual([`Designer ${w} freelance`, `Plumber ${w} service`]);
    expect((await request(app).get('/api/v1/jobs?segment=nonsense')).status).toBe(400);
  });
});
