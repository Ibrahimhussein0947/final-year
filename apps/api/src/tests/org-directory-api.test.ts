import { randomInt, randomUUID } from 'node:crypto';
import { OrganizationType } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ORG_TYPE_INFO, orgTypeInfo } from '../modules/hiring/catalog';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', orgType = 'SME', orgName = `TEST_ORG Dir ${tag()}`): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: orgName, organizationType: orgType } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let categoryId = '';
let skillId = '';
let zoneId = '';
let adminId = '';
const adminToken = () => jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: adminId, expiresIn: '10m' });

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'business' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'office-admin' } })).id;
  zoneId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  adminId = (await prisma.user.create({ data: { phone: `+251${p.slice(1)}`, passwordHash: 'x', fullName: 'Dir Admin', role: 'ADMIN' } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

async function liveJob(e: User, title: string) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title, description: `We need an office administrator for our team. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', locationId: zoneId, skills: [{ skillId, importance: 'REQUIRED' }], deadline: day(30),
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}

describe('catalog of employer types', () => {
  it('describes every type the database knows, in clear groups, with documents to prepare', async () => {
    const r = await request(app).get('/api/v1/organization-types');
    expect(r.status).toBe(200);
    const values = r.body.types.map((t: { value: string }) => t.value).sort();
    expect(values).toEqual(Object.values(OrganizationType).sort()); // adding a type to the schema without describing it fails here
    expect(new Set(values).size).toBe(values.length);
    for (const t of r.body.types) {
      expect(t.label.length, t.value).toBeGreaterThan(3);
      expect(t.description.length, t.value).toBeGreaterThan(10);
      expect(t.documents.length, t.value).toBeGreaterThan(0);
      expect(r.body.groups.map((g: { group: string }) => g.group), t.value).toContain(t.group);
    }
  });

  it('puts individuals and households together, and public bodies together', () => {
    expect(orgTypeInfo('INDIVIDUAL').group).toBe('individual');
    expect(orgTypeInfo('HOUSEHOLD').group).toBe('individual');
    expect(orgTypeInfo('GOVERNMENT').group).toBe('public');
    expect(orgTypeInfo('PUBLIC_ENTERPRISE').group).toBe('public');
    expect(orgTypeInfo('PRIVATE_COMPANY').group).toBe('business');
    expect(ORG_TYPE_INFO.filter((t) => t.legacy).map((t) => t.value).sort()).toEqual(['AGRICULTURAL', 'CONSTRUCTION', 'FACTORY', 'HOTEL_RESTAURANT']);
  });

  it('carries the hiring rules of each type, in plain words', async () => {
    const r = await request(app).get('/api/v1/organization-types');
    const by = (v: string) => r.body.types.find((t: { value: string }) => t.value === v);
    expect(by('GOVERNMENT').policyLabel).toBe('Government vacancy');
    expect(by('GOVERNMENT').rules.join(' ')).toMatch(/verified/);
    expect(by('GOVERNMENT').rules.join(' ')).toMatch(/reference number/);
    expect(by('PRIVATE_COMPANY').rules).toEqual([]);
    expect(by('HOUSEHOLD').rules).toEqual([]);
  });

  it('is public', async () => {
    expect((await request(app).get('/api/v1/organization-types')).headers['cache-control']).toContain('max-age');
  });
});

describe('searching jobs by the kind of employer', () => {
  it('keeps business, individual and public employers apart', async () => {
    const word = tag();
    const company = await signUp('EMPLOYER', 'SME');
    const family = await signUp('EMPLOYER', 'HOUSEHOLD');
    await liveJob(company, `Office clerk ${word} company`);
    await liveJob(family, `Home assistant ${word} family`);
    const titles = async (qs: string) => (await request(app).get(`/api/v1/jobs?q=${word}&${qs}`)).body.items.map((i: { title: string }) => i.title);
    expect(await titles('employerGroup=individual')).toEqual([`Home assistant ${word} family`]);
    expect(await titles('employerGroup=business')).toEqual([`Office clerk ${word} company`]);
    expect(await titles('employerGroup=public')).toEqual([]);
    expect((await titles('')).length).toBe(2);
    expect((await request(app).get('/api/v1/jobs?employerGroup=aliens')).status).toBe(400);
    const item = (await request(app).get(`/api/v1/jobs?q=${word}&employerGroup=individual`)).body.items[0];
    expect(item.organization.type).toBe('HOUSEHOLD');
  });
});

describe('administrator: organizations by type', () => {
  it('lists, filters, searches and summarises by group', async () => {
    const word = tag();
    await signUp('EMPLOYER', 'SME', `TEST_ORG ${word} Shop`);
    await signUp('EMPLOYER', 'HOUSEHOLD', `TEST_ORG ${word} Family`);
    await signUp('EMPLOYER', 'INDIVIDUAL', `TEST_ORG ${word} Person`);
    const get = (qs: string) => request(app).get(`/api/v1/admin/organizations?${qs}`).set(auth(adminToken()));

    const all = await get(`q=${word}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((i: { typeLabel: string }) => i.typeLabel).sort()).toEqual(['Household (family)', 'Individual hiring for themselves', 'Small or medium business']);
    expect((await get(`q=${word}&group=individual`)).body.total).toBe(2);
    expect((await get(`q=${word}&type=SME`)).body.items[0].name).toContain('Shop');
    expect((await get(`q=${word}&status=VERIFIED`)).body.total).toBe(0);
    expect((await get(`q=${word}&pageSize=2&page=2`)).body.items).toHaveLength(1);
    expect(all.body.summary.find((s: { group: string }) => s.group === 'individual').organizations).toBeGreaterThanOrEqual(2);
    expect(all.body.items[0]).toMatchObject({ accounts: 1, liveJobs: 0 });
    expect((await get('type=SPACESHIP')).status).toBe(400);
    expect((await get('bogus=1')).status).toBe(400);
  });

  it('is for administrators only', async () => {
    const e = await signUp('EMPLOYER');
    expect((await request(app).get('/api/v1/admin/organizations').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/organizations')).status).toBe(401);
  });
});
