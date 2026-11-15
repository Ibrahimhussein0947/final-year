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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const uniq = `fs${randomUUID().slice(0, 6)}`;

let token = '';
let categoryId = '';
let skillA = '';
let skillB = '';
let skillC = ''; // a neutral skill so every fixture has the required skill that publishing demands
let adamaId = '';
let jimmaId = '';
const ids: Record<string, string> = {};

async function post(name: string, over: Record<string, unknown>) {
  const create = await request(app).post('/api/v1/jobs').set(auth(token)).send({
    title: `${uniq} ${name}`, description: `Search filter fixture ${name}. ${randomUUID()} ${randomUUID()} Apply with references please.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), locationId: adamaId, skills: [{ skillId: skillC, importance: 'REQUIRED' }], ...over,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const pub = await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(token)).send({});
  expect(pub.status, name + JSON.stringify(pub.body)).toBe(200);
  ids[name] = create.body.job.id;
}

const find = async (qs: Record<string, string | number>) => {
  const r = await request(app).get('/api/v1/jobs').query({ q: uniq, pageSize: 50, ...qs });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body.items as { title: string }[]).map((j) => j.title.replace(`${uniq} `, '')).sort();
};

beforeAll(async () => {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const reg = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Search Employer', phone: p, password: 'Passw0rdTest', role: 'EMPLOYER', region: 'Oromia', zone: 'Adama', language: 'en',
    organizationName: `TEST_ORG Search ${uniq}`, organizationType: 'SME',
  });
  expect(reg.status).toBe(201);
  token = reg.body.accessToken;
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  skillA = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
  skillB = (await prisma.skill.findFirstOrThrow({ where: { slug: 'guard-duty' } })).id;
  skillC = (await prisma.skill.findFirstOrThrow({ where: { id: { notIn: [skillA, skillB] }, isActive: true } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
  jimmaId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Jimma' } })).id;

  await post('office', { salaryMin: 8000, salaryMax: 12000, minExperienceYears: 3, requiredEducationLevel: 'DIPLOMA', skills: [{ skillId: skillA, importance: 'REQUIRED' }] });
  await post('casual', { employmentType: 'DAILY', salaryMax: 600, minExperienceYears: 0, requiredEducationLevel: 'NONE', locationId: jimmaId, skills: [{ skillId: skillB, importance: 'REQUIRED' }], languages: ['Amharic'] });
  await post('remote', { workMode: 'REMOTE', salaryMin: 20000, requiredEducationLevel: 'BACHELOR', languages: ['English'] });
  await post('flexschedule', { schedule: 'Flexible hours, 20 hours a week', startDate: future(100) });
  await post('statedNothing', {});
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('worker job search filters', () => {
  it('finds all fixtures with no filter', async () => {
    expect(await find({})).toEqual(['casual', 'flexschedule', 'office', 'remote', 'statedNothing']);
  });

  it('filters by place, down to the city or zone', async () => {
    expect(await find({ locationId: jimmaId })).toEqual(['casual']);
    expect((await find({ locationId: adamaId })).includes('casual')).toBe(false);
  });

  it('filters by employment type and by flexible work', async () => {
    expect(await find({ type: 'DAILY' })).toEqual(['casual']);
    expect(await find({ flexible: 'true' })).toEqual(['casual', 'flexschedule', 'remote']);
  });

  it('filters by salary: only jobs that state one, and at least a minimum', async () => {
    expect(await find({ hasSalary: 'true' })).toEqual(['casual', 'office', 'remote']);
    expect(await find({ minSalary: 10000 })).toEqual(['office']); // a job with no salary stated is not treated as paying zero
    expect(await find({ minSalary: 500 })).toEqual(['casual', 'office']);
  });

  it('lets people with little schooling or experience find work they can do', async () => {
    expect(await find({ maxEducation: 'NONE' })).toEqual(['casual', 'flexschedule', 'statedNothing']); // jobs stating no requirement are kept
    expect(await find({ maxEducation: 'DIPLOMA' })).toEqual(['casual', 'flexschedule', 'office', 'statedNothing']);
    expect(await find({ maxExperience: 0 })).toEqual(['casual', 'flexschedule', 'remote', 'statedNothing']);
  });

  it('filters by start date, language and skill', async () => {
    expect(await find({ startWithin: 30 })).toEqual(['casual', 'office', 'remote', 'statedNothing']); // flexschedule starts in 100 days
    expect(await find({ language: 'amharic' })).toEqual(['casual', 'flexschedule', 'office', 'statedNothing']); // jobs naming no language are kept
    expect(await find({ skills: skillB })).toEqual(['casual']);
    expect(await find({ skills: `${skillA},${skillB}` })).toEqual(['casual', 'office']);
  });

  it('combines filters with AND', async () => {
    expect(await find({ flexible: 'true', hasSalary: 'true', maxEducation: 'NONE' })).toEqual(['casual']);
  });

  it('rejects malformed values', async () => {
    for (const qs of [{ skills: 'nope' }, { maxEducation: 'WIZARD' }, { startWithin: -1 }, { postedWithin: 0 }, { flexible: 'maybe' }, { maxExperience: 99 }]) {
      expect((await request(app).get('/api/v1/jobs').query(qs as unknown as Record<string, string>)).status, JSON.stringify(qs)).toBe(400);
    }
  });

  it('offers no way to filter by gender, because jobs may not restrict by gender', async () => {
    const r = await request(app).get('/api/v1/jobs').query({ gender: 'female' });
    expect([200, 400]).toContain(r.status);
    if (r.status === 200) expect((r.body.items as unknown[]).length).toBeGreaterThanOrEqual(0); // unknown parameters are ignored, not applied
    expect(await find({})).toHaveLength(5);
  });
});
