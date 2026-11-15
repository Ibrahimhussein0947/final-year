import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`; // unique word so searches only match this test's jobs

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}

async function signUp(role: 'WORKER' | 'EMPLOYER', region = 'Oromia') {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: newPhone(), password: 'Passw0rdTest', role, region, language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Jobs ${tag()}`, organizationType: 'CONSTRUCTION' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

let categoryId = '';
let otherCategoryId = '';
let oromiaId = '';
let adamaId = '';
let amharaId = '';
let skillIds: string[] = [];

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const jobBody = (over: Record<string, unknown> = {}) => ({
  title: `Experienced mechanic ${tag()}`,
  description: 'We need a reliable mechanic to repair minibuses and trucks at our garage. Experience with engines, brakes and electrical faults is important.',
  categoryId, employmentType: 'FULL_TIME', workMode: 'ON_SITE', locationId: adamaId, vacancies: 2,
  salaryMin: 6000, salaryMax: 9000, deadline: future(30),
  skills: [{ skillId: skillIds[0], importance: 'REQUIRED' }, { skillId: skillIds[1], importance: 'PREFERRED' }],
  ...over,
});

async function createJob(token: string, over: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/v1/jobs').set(auth(token)).send(jobBody(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.job.id as string;
}
async function publish(token: string, id: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(token)).send(body);
}
async function liveJob(token: string, over: Record<string, unknown> = {}) {
  const id = await createJob(token, over);
  const r = await publish(token, id);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return id;
}
const search = (qs: string) => request(app).get(`/api/v1/jobs?${qs}`);

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  otherCategoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'hospitality' } })).id;
  oromiaId = (await prisma.location.findFirstOrThrow({ where: { level: 'REGION', nameEn: 'Oromia' } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { level: 'ZONE', nameEn: 'Adama', parentId: oromiaId } })).id;
  amharaId = (await prisma.location.findFirstOrThrow({ where: { level: 'REGION', nameEn: 'Amhara' } })).id;
  skillIds = (await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems', 'welding'] } }, orderBy: { slug: 'asc' } })).map((s) => s.id);
});

afterEach(() => {
  env.reviewUnverifiedJobs = false;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('creating and editing jobs', () => {
  it('lets an employer create a draft that is not public', async () => {
    const e = await signUp('EMPLOYER');
    const id = await createJob(e.token);
    const mine = await request(app).get('/api/v1/jobs/mine').set(auth(e.token));
    expect(mine.body.items.find((j: { id: string }) => j.id === id).status).toBe('DRAFT');
    expect((await request(app).get(`/api/v1/jobs/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/jobs/${id}`).set(auth(e.token))).status).toBe(200);
    const stranger = await signUp('EMPLOYER');
    expect((await request(app).get(`/api/v1/jobs/${id}`).set(auth(stranger.token))).status).toBe(404);
  });

  it('only allows employers to manage jobs', async () => {
    const w = await signUp('WORKER');
    expect((await request(app).post('/api/v1/jobs').set(auth(w.token)).send(jobBody())).status).toBe(403);
    expect((await request(app).post('/api/v1/jobs').send(jobBody())).status).toBe(401);
    expect((await request(app).get('/api/v1/jobs/mine').set(auth(w.token))).status).toBe(403);
  });

  it('validates input and refuses client-set status or ownership', async () => {
    const e = await signUp('EMPLOYER');
    const cases: [string, Record<string, unknown>][] = [
      ['short title', { title: 'Hi' }],
      ['short description', { description: 'too short' }],
      ['salary reversed', { salaryMin: 9000, salaryMax: 100 }],
      ['zero vacancies', { vacancies: 0 }],
      ['bad deadline format', { deadline: '31/12/2030' }],
      ['duplicate skill', { skills: [{ skillId: skillIds[0] }, { skillId: skillIds[0] }] }],
      ['unknown category', { categoryId: '00000000-0000-4000-8000-000000000000' }],
      ['unknown skill', { skills: [{ skillId: '00000000-0000-4000-8000-000000000000' }] }],
      ['bad employment type', { employmentType: 'SLAVERY' }],
      ['lat without lng', { lat: 9 }],
      ['client-set status', { status: 'ACTIVE' }],
      ['client-set organization', { organizationId: '00000000-0000-4000-8000-000000000000' }],
    ];
    for (const [name, over] of cases) {
      const r = await request(app).post('/api/v1/jobs').set(auth(e.token)).send(jobBody(over));
      expect(r.status, name).toBe(400);
    }
  });

  it("stops other employers from changing someone else's job", async () => {
    const a = await signUp('EMPLOYER');
    const b = await signUp('EMPLOYER');
    const id = await liveJob(a.token);
    expect((await request(app).patch(`/api/v1/jobs/${id}`).set(auth(b.token)).send({ title: 'Hijacked title' })).status).toBe(404);
    expect((await publish(b.token, id)).status).toBe(404);
    expect((await request(app).post(`/api/v1/jobs/${id}/close`).set(auth(b.token)).send({})).status).toBe(404);
    expect((await request(app).delete(`/api/v1/jobs/${id}`).set(auth(b.token))).status).toBe(404);
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
  });

  it('edits fields and replaces the skill list', async () => {
    const e = await signUp('EMPLOYER');
    const id = await liveJob(e.token);
    const r = await request(app).patch(`/api/v1/jobs/${id}`).set(auth(e.token)).send({
      vacancies: 5, skills: [{ skillId: skillIds[2], importance: 'REQUIRED', minProficiency: 3 }],
    });
    expect(r.status).toBe(200);
    expect(r.body.job.vacancies).toBe(5);
    expect(r.body.job.allSkills).toHaveLength(1);
    expect(r.body.job.allSkills[0]).toMatchObject({ skillId: skillIds[2], minProficiency: 3 });
  });
});

describe('publishing and lifecycle', () => {
  it('requires a required skill, a location (unless remote) and a future deadline', async () => {
    const e = await signUp('EMPLOYER');
    const noSkill = await createJob(e.token, { skills: [{ skillId: skillIds[0], importance: 'PREFERRED' }] });
    expect((await publish(e.token, noSkill)).body.error.details.skills).toBeTruthy();
    const noLoc = await createJob(e.token, { locationId: null });
    expect((await publish(e.token, noLoc)).body.error.details.locationId).toBeTruthy();
    const remote = await createJob(e.token, { locationId: null, workMode: 'REMOTE' });
    expect((await publish(e.token, remote)).status).toBe(200);
    const past = await createJob(e.token, { deadline: '2020-01-01' });
    expect((await publish(e.token, past)).body.error.details.deadline).toBeTruthy();
  });

  it('goes live, closes, and can be reopened but not edited while closed', async () => {
    const e = await signUp('EMPLOYER');
    const t = tag();
    const id = await liveJob(e.token, { title: `Lifecycle welder ${t}` });
    expect((await search(`q=${t}`)).body.total).toBe(1);

    const closed = await request(app).post(`/api/v1/jobs/${id}/close`).set(auth(e.token)).send({});
    expect(closed.body.job.status).toBe('CLOSED');
    expect((await search(`q=${t}`)).body.total).toBe(0);
    expect((await request(app).get(`/api/v1/jobs/${id}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/jobs/${id}`).set(auth(e.token)).send({ vacancies: 3 })).status).toBe(409);
    expect((await request(app).post(`/api/v1/jobs/${id}/close`).set(auth(e.token)).send({})).status).toBe(409);

    expect((await publish(e.token, id)).status).toBe(200);
    expect((await search(`q=${t}`)).body.total).toBe(1);

    const filled = await request(app).post(`/api/v1/jobs/${id}/close`).set(auth(e.token)).send({ filled: true });
    expect(filled.body.job.status).toBe('FILLED');
  });

  it('deletes drafts only', async () => {
    const e = await signUp('EMPLOYER');
    const draft = await createJob(e.token);
    expect((await request(app).delete(`/api/v1/jobs/${draft}`).set(auth(e.token))).status).toBe(204);
    const live = await liveJob(e.token);
    expect((await request(app).delete(`/api/v1/jobs/${live}`).set(auth(e.token))).status).toBe(409);
  });

  it('hides jobs after their deadline passes', async () => {
    const e = await signUp('EMPLOYER');
    const t = tag();
    const id = await liveJob(e.token, { title: `Expiring cook ${t}` });
    expect((await search(`q=${t}`)).body.total).toBe(1);
    await prisma.job.update({ where: { id }, data: { deadline: new Date(Date.now() - 3600_000) } });
    expect((await search(`q=${t}`)).body.total).toBe(0);
    expect((await request(app).get(`/api/v1/jobs/${id}`)).status).toBe(404);
    const owner = await request(app).get(`/api/v1/jobs/${id}`).set(auth(e.token));
    expect(owner.body.job.expired).toBe(true);
  });

  it('can hold jobs from unverified organizations for review (configurable)', async () => {
    env.reviewUnverifiedJobs = true;
    const unverified = await signUp('EMPLOYER');
    const t1 = tag();
    const id1 = await createJob(unverified.token, { title: `Review me ${t1}` });
    expect((await publish(unverified.token, id1)).body.job.status).toBe('PENDING_REVIEW');
    expect((await search(`q=${t1}`)).body.total).toBe(0);

    const verified = await signUp('EMPLOYER');
    const ep = await prisma.employerProfile.findUniqueOrThrow({ where: { userId: verified.id } });
    await prisma.organization.update({ where: { id: ep.organizationId }, data: { verificationStatus: 'VERIFIED' } });
    const t2 = tag();
    const id2 = await createJob(verified.token, { title: `Trusted ${t2}` });
    expect((await publish(verified.token, id2)).body.job.status).toBe('ACTIVE');

    // Rewording a live job from an unverified org sends it back to review.
    env.reviewUnverifiedJobs = false;
    const id3 = await liveJob(unverified.token, { title: `Edit trap ${tag()}` });
    env.reviewUnverifiedJobs = true;
    await request(app).patch(`/api/v1/jobs/${id3}`).set(auth(unverified.token)).send({ description: 'Completely different text that was swapped in after approval to mislead people.' });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: id3 } })).status).toBe('PENDING_REVIEW');
  });
});

describe('duplicate detection', () => {
  it('blocks identical reposts and warns about near-identical ones', async () => {
    const e = await signUp('EMPLOYER');
    const t = tag();
    const base = { title: `Duplicate driver ${t}`, description: 'We are hiring a careful and experienced driver for daily deliveries across Addis Ababa, with a clean licence and good knowledge of the city roads.' };
    await liveJob(e.token, base);

    const exact = await createJob(e.token, { ...base, title: `Duplicate driver ${t}!` }); // punctuation only
    const r1 = await publish(e.token, exact);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('DUPLICATE_JOB');

    const near = await createJob(e.token, { title: `Duplicate driver ${t}`, description: `${base.description} Apply soon.` });
    const r2 = await publish(e.token, near);
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('NEAR_DUPLICATE_JOB');
    const forced = await publish(e.token, near, { confirmNotDuplicate: true });
    expect(forced.status).toBe(200);
  });

  it('does not flag genuinely different jobs from the same organization', async () => {
    const e = await signUp('EMPLOYER');
    await liveJob(e.token, { title: `Welder ${tag()}`, description: 'Weld steel frames and gates in our workshop. You need MIG welding experience and the ability to read simple drawings.' });
    const other = await createJob(e.token, { title: `Cashier ${tag()}`, description: 'Handle cash payments, greet customers and keep the till balanced at our busy supermarket branch in Bole during the afternoon shift.' });
    expect((await publish(e.token, other)).status).toBe(200);
  });

  it('holds text copied from another organization for admin review', async () => {
    const a = await signUp('EMPLOYER');
    const b = await signUp('EMPLOYER');
    const copy = { title: `Copied job ${tag()}`, description: 'Earn big money from home with no experience, send a deposit to start working immediately and receive your first payment tomorrow.' };
    await liveJob(a.token, copy);
    const id = await createJob(b.token, copy);
    const r = await publish(b.token, id);
    expect(r.status).toBe(200);
    expect(r.body.flaggedAsCopy).toBe(true);
    expect(r.body.job.status).toBe('PENDING_REVIEW');
    expect(await prisma.auditLog.count({ where: { action: 'job.published_flagged_copy' } })).toBeGreaterThan(0);
  });
});

describe('public search', () => {
  it('filters by text, skill alias, category, place, type, mode, salary and verification', async () => {
    const e = await signUp('EMPLOYER');
    const t = tag();
    const welder = await liveJob(e.token, { title: `Welder ${t}`, employmentType: 'CONTRACT', salaryMin: 4000, salaryMax: 7000, skills: [{ skillId: skillIds[2], importance: 'REQUIRED' }] });
    const cook = await liveJob(e.token, {
      title: `Cook ${t}`, categoryId: otherCategoryId, employmentType: 'PART_TIME', workMode: 'REMOTE', locationId: amharaId,
      description: 'Prepare traditional meals and keep the kitchen clean, following food safety rules, for our small restaurant near the lake in Bahir Dar.',
      salaryMin: 2000, salaryMax: 3500, skills: [{ skillId: skillIds[0], importance: 'REQUIRED' }],
    });

    const ids = async (qs: string) => (await search(`q=${t}&${qs}`)).body.items.map((j: { id: string }) => j.id).sort();
    expect(await ids('')).toEqual([welder, cook].sort());
    expect(await ids('category=automotive')).toEqual([welder]);
    expect(await ids('category=hospitality')).toEqual([cook]);
    expect(await ids('region=Oromia')).toEqual([welder]);
    expect(await ids('region=amhara')).toEqual([cook]);
    expect(await ids(`locationId=${adamaId}`)).toEqual([welder]);
    expect(await ids('region=Atlantis')).toEqual([]);
    expect(await ids('type=CONTRACT')).toEqual([welder]);
    expect(await ids('mode=REMOTE')).toEqual([cook]);
    expect(await ids('minSalary=6000')).toEqual([welder]);
    expect(await ids('minSalary=99999')).toEqual([]);
    expect(await ids('verifiedOnly=true')).toEqual([]);

    const ep = await prisma.employerProfile.findUniqueOrThrow({ where: { userId: e.id } });
    await prisma.organization.update({ where: { id: ep.organizationId }, data: { verificationStatus: 'VERIFIED' } });
    expect(await ids('verifiedOnly=true')).toEqual([welder, cook].sort());

    // Skill text and aliases match jobs even when the title does not mention them.
    const bySkill = await search('q=arc welding');
    expect(bySkill.body.items.some((j: { id: string }) => j.id === welder)).toBe(true);
  });

  it('sorts and paginates', async () => {
    const e = await signUp('EMPLOYER');
    const t = tag();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await liveJob(e.token, {
        title: `Paged job ${t} number ${i}`, description: `Position ${i}: ${'unique wording about duties and tools '.repeat(3)} ${randomUUID()} ${randomUUID()}`,
        salaryMin: 1000, salaryMax: 1000 + i * 1000, deadline: future(10 + (4 - i)),
      }));
    }
    const p1 = await search(`q=${t}&pageSize=2&page=1&sort=salary`);
    const p3 = await search(`q=${t}&pageSize=2&page=3&sort=salary`);
    expect(p1.body.total).toBe(5);
    expect(p1.body.items.map((j: { id: string }) => j.id)).toEqual([ids[4], ids[3]]);
    expect(p3.body.items.map((j: { id: string }) => j.id)).toEqual([ids[0]]);
    const byDeadline = await search(`q=${t}&sort=deadline`);
    expect(byDeadline.body.items[0].id).toBe(ids[4]);
  });

  it('rejects malformed searches', async () => {
    for (const qs of ['type=NOPE', 'pageSize=500', 'page=0', 'minSalary=abc', 'sort=random']) {
      expect((await search(qs)).status, qs).toBe(400);
    }
  });

  it('shows approximate job-site coordinates publicly and exact ones to the owner', async () => {
    const e = await signUp('EMPLOYER');
    const id = await liveJob(e.token, { lat: 8.541234, lng: 39.268199 });
    const pub = await request(app).get(`/api/v1/jobs/${id}`);
    expect(pub.body.job.approxLocation).toEqual({ lat: 8.54, lng: 39.27 });
    expect(JSON.stringify(pub.body)).not.toContain('8.541234');
    const own = await request(app).get(`/api/v1/jobs/${id}`).set(auth(e.token));
    expect(own.body.job.exact).toEqual({ lat: 8.541234, lng: 39.268199 });
  });

  it('includes organization trust info and never leaks employer contact details', async () => {
    const e = await signUp('EMPLOYER');
    const id = await liveJob(e.token);
    const r = await request(app).get(`/api/v1/jobs/${id}`);
    expect(r.body.job.organization.verified).toBe(false);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('+251');
    expect(text).not.toContain('passwordHash');
    expect(r.body.job.allSkills.length).toBe(2);
  });
});
