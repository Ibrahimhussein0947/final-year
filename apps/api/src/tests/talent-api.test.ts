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
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string; phone: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', name = `Test ${role}`): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: name, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Talent ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}

let transportId = '';
let securityId = '';
let heavyId = '';
let guardId = '';
let adamaId = '';
let oromiaId = '';
const def: Record<string, string> = {};

beforeAll(async () => {
  transportId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  securityId = (await prisma.category.findFirstOrThrow({ where: { slug: 'security' } })).id;
  heavyId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
  guardId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'guard-duty' } })).id;
  const adama = await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' }, include: { parent: true } });
  adamaId = adama.id;
  oromiaId = adama.parentId!;
  for (const row of await prisma.criterionDefinition.findMany({ include: { category: true } })) def[`${row.category?.slug ?? 'all'}.${row.key}`] = row.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

async function worker(name: string, o: { headline?: string; years?: number; cat?: string; skill?: string; availability?: string; answers?: { criterionId: string; value: unknown }[] } = {}) {
  const w = await signUp('WORKER', name);
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({
    categoryId: o.cat ?? transportId, headline: o.headline ?? `Driver ${name}`, yearsExperience: o.years ?? 5, availability: o.availability ?? 'IMMEDIATELY', locationId: adamaId,
  });
  expect((await request(app).put(`/api/v1/workers/me/skills/${o.skill ?? heavyId}`).set(auth(w.token)).send({ proficiency: 4 })).status).toBe(200);
  if (o.answers?.length) expect((await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({ items: o.answers })).status).toBe(200);
  const profile = await prisma.workerProfile.findFirstOrThrow({ where: { userId: w.id } });
  return { ...w, profileId: profile.id };
}

async function liveJob(e: User, over: Record<string, unknown> = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Driver ${tag()}`, description: `We need a heavy truck driver for regional deliveries. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId: transportId, employmentType: 'FULL_TIME', deadline: future(30), locationId: adamaId, skills: [{ skillId: heavyId, importance: 'REQUIRED' }], ...over,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}

const search = (e: User, qs: Record<string, string | number> = {}) => request(app).get('/api/v1/talent/search').query(qs).set(auth(e.token));
const names = (r: request.Response) => (r.body.items as { name: string }[]).map((i) => i.name);

describe('worker search: access and input', () => {
  it('is for employers only', async () => {
    const w = await signUp('WORKER');
    expect((await request(app).get('/api/v1/talent/search')).status).toBe(401);
    expect((await request(app).get('/api/v1/talent/search').set(auth(w.token))).status).toBe(403);
  });
  it('rejects malformed input, unknown parameters and oversized pages', async () => {
    const e = await signUp('EMPLOYER');
    for (const qs of [{ categoryId: 'nope' }, { pageSize: 100 }, { minYears: -1 }, { bogus: 'x' }, { skills: 'not-a-uuid' }, { availableWithin: 'yesterday' }, { criteria: 'not json' }, { criteria: JSON.stringify([{ criterionId: randomUUID(), value: true }]) }]) {
      expect((await search(e, qs as unknown as Record<string, string>)).status, JSON.stringify(qs)).toBe(400);
    }
  });
});

describe('worker search: filters', () => {
  it('filters by words, sector, skills, experience, availability, place and education', async () => {
    const e = await signUp('EMPLOYER');
    const tagWord = `uniq${randomUUID().slice(0, 6)}`;
    const a = await worker(`Alpha ${tagWord}`, { headline: `Truck driver ${tagWord}`, years: 9, availability: 'IMMEDIATELY' });
    const b = await worker(`Beta ${tagWord}`, { headline: `Night guard ${tagWord}`, years: 2, availability: 'WITHIN_ONE_MONTH', cat: securityId, skill: guardId });
    await prisma.education.create({ data: { workerId: a.profileId, level: 'DIPLOMA', field: 'Logistics' } });

    const byWord = await search(e, { q: tagWord });
    expect(names(byWord).sort()).toEqual([`Alpha ${tagWord}`, `Beta ${tagWord}`]);
    expect(names(await search(e, { q: tagWord, categoryId: securityId }))).toEqual([`Beta ${tagWord}`]);
    expect(names(await search(e, { q: tagWord, skills: heavyId }))).toEqual([`Alpha ${tagWord}`]);
    expect(names(await search(e, { q: tagWord, skills: `${heavyId},${guardId}`, skillsMode: 'any' })).sort()).toEqual([`Alpha ${tagWord}`, `Beta ${tagWord}`]);
    expect(names(await search(e, { q: tagWord, skills: `${heavyId},${guardId}`, skillsMode: 'all' }))).toEqual([]);
    expect(names(await search(e, { q: tagWord, minYears: 5 }))).toEqual([`Alpha ${tagWord}`]);
    expect(names(await search(e, { q: tagWord, availableWithin: 'two_weeks' }))).toEqual([`Alpha ${tagWord}`]);
    expect(names(await search(e, { q: tagWord, availableWithin: 'month' })).length).toBe(2);
    expect(names(await search(e, { q: tagWord, locationId: oromiaId })).length).toBe(2); // region contains the zone
    expect(names(await search(e, { q: tagWord, locationId: randomUUID() }))).toEqual([]);
    expect(names(await search(e, { q: tagWord, minEducation: 'DIPLOMA' }))).toEqual([`Alpha ${tagWord}`]);
    expect(names(await search(e, { q: tagWord, minEducation: 'MASTER' }))).toEqual([]);
    void b;
  });

  it('filters by verified evidence', async () => {
    const e = await signUp('EMPLOYER');
    const word = `ver${randomUUID().slice(0, 6)}`;
    const v = await worker(`Verified ${word}`, { headline: `Driver ${word}` });
    await worker(`Plain ${word}`, { headline: `Driver ${word}` });
    await prisma.workerSkill.updateMany({ where: { workerId: v.profileId }, data: { source: 'VERIFIED' } });
    const r = await search(e, { q: word, verified: 'true' });
    expect(names(r)).toEqual([`Verified ${word}`]);
    expect(r.body.items[0].verified.skills).toBe(1);
  });

  it('filters by sector answers, and an unanswered question does not count as a yes', async () => {
    const e = await signUp('EMPLOYER');
    const word = `sec${randomUUID().slice(0, 6)}`;
    await worker(`Licensed ${word}`, { headline: `Driver ${word}`, answers: [{ criterionId: def['transport.vehicle_types'], value: ['truck', 'trailer'] }, { criterionId: def['transport.licence_years'], value: 8 }] });
    await worker(`Light ${word}`, { headline: `Driver ${word}`, answers: [{ criterionId: def['transport.vehicle_types'], value: ['light'] }, { criterionId: def['transport.licence_years'], value: 2 }] });
    await worker(`Silent ${word}`, { headline: `Driver ${word}` });
    const f = (filters: unknown[]) => search(e, { q: word, criteria: JSON.stringify(filters) });
    expect(names(await f([{ criterionId: def['transport.vehicle_types'], value: ['truck'] }]))).toEqual([`Licensed ${word}`]);
    expect(names(await f([{ criterionId: def['transport.licence_years'], value: 3 }]))).toEqual([`Licensed ${word}`]);
    expect(names(await f([{ criterionId: def['transport.vehicle_types'], value: ['light'] }, { criterionId: def['transport.licence_years'], value: 1 }]))).toEqual([`Light ${word}`]);
    expect(names(await search(e, { q: word })).length).toBe(3);
  });

  it('never lists hidden profiles or suspended accounts', async () => {
    const e = await signUp('EMPLOYER');
    const word = `vis${randomUUID().slice(0, 6)}`;
    const shown = await worker(`Shown ${word}`, { headline: `Driver ${word}` });
    const hidden = await worker(`Hidden ${word}`, { headline: `Driver ${word}` });
    const suspended = await worker(`Suspended ${word}`, { headline: `Driver ${word}` });
    await prisma.workerProfile.update({ where: { id: hidden.profileId }, data: { isVisible: false } });
    await prisma.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });
    expect(names(await search(e, { q: word }))).toEqual([`Shown ${word}`]);
    void shown;
  });

  it('shows no contact details or exact position, whatever the filters', async () => {
    const e = await signUp('EMPLOYER');
    const word = `prv${randomUUID().slice(0, 6)}`;
    const w = await worker(`Private ${word}`, { headline: `Driver ${word}` });
    await prisma.workerProfile.update({ where: { id: w.profileId }, data: { lat: 8.5412345, lng: 39.2712345 } });
    await prisma.user.update({ where: { id: w.id }, data: { email: `private.${word}@example.com` } });
    const r = await search(e, { q: word });
    const text = JSON.stringify(r.body);
    expect(r.body.items).toHaveLength(1);
    expect(text).not.toContain(w.phone);
    expect(text).not.toContain(w.phone.replace('+251', '0'));
    expect(text).not.toMatch(/@example\.com|8\.5412|39\.2712|passwordHash|"phone"|"email"|"lat"|"lng"/);
  });

  it('pages through results without repeating anyone', async () => {
    const e = await signUp('EMPLOYER');
    const word = `pag${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 5; i++) await worker(`P${i} ${word}`, { headline: `Driver ${word}` });
    const p1 = await search(e, { q: word, pageSize: 2, page: 1 });
    const p2 = await search(e, { q: word, pageSize: 2, page: 2 });
    const p3 = await search(e, { q: word, pageSize: 2, page: 3 });
    expect(p1.body.total).toBe(5);
    const all = [...names(p1), ...names(p2), ...names(p3)];
    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
    expect(p1.body.capped).toBe(false);
  });
});

describe('worker search ranked by one of my jobs', () => {
  it('ranks by match, leaves out people who lack a must-have, and marks who is invited or applied', async () => {
    const e = await signUp('EMPLOYER');
    const word = `job${randomUUID().slice(0, 6)}`;
    const jobId = await liveJob(e, { criteria: [{ criterionId: def['transport.vehicle_types'], importance: 'MUST_HAVE', value: ['truck'] }, { criterionId: def['transport.licence_years'], importance: 'PREFERRED', value: 5 }] });
    const strong = await worker(`Strong ${word}`, { headline: `Driver ${word}`, answers: [{ criterionId: def['transport.vehicle_types'], value: ['truck'] }, { criterionId: def['transport.licence_years'], value: 9 }] });
    await worker(`Lacks ${word}`, { headline: `Driver ${word}`, answers: [{ criterionId: def['transport.vehicle_types'], value: ['light'] }] });
    const silent = await worker(`Silent ${word}`, { headline: `Driver ${word}` });
    const applicant = await worker(`Applied ${word}`, { headline: `Driver ${word}`, answers: [{ criterionId: def['transport.vehicle_types'], value: ['truck'] }] });
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(applicant.token)).send({})).status).toBe(201);
    expect((await request(app).post(`/api/v1/jobs/${jobId}/invitations`).set(auth(e.token)).send({ workerId: strong.profileId })).status).toBe(201);

    const r = await search(e, { q: word, jobId });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.job.id).toBe(jobId);
    expect(names(r)).not.toContain(`Lacks ${word}`);
    expect(names(r)).toContain(`Silent ${word}`);
    const scores = r.body.items.map((i: any) => i.match.score);
    expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
    const by = (n: string) => r.body.items.find((i: any) => i.name === n);
    expect(by(`Strong ${word}`).match.eligibility).toBe('eligible');
    expect(by(`Strong ${word}`).invitation).toBe('SENT');
    expect(by(`Applied ${word}`).applied).toBe(true);
    expect(by(`Silent ${word}`).match.eligibility).toBe('unknown');
    expect(by(`Silent ${word}`).invitation).toBeNull();
    void silent;
  });

  it('only works with my own jobs', async () => {
    const owner = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const jobId = await liveJob(owner);
    expect((await search(other, { jobId })).status).toBe(404);
    expect((await search(owner, { jobId })).status).toBe(200);
  });
});

describe('invitations to apply', () => {
  const invite = (e: User, jobId: string, body: unknown) => request(app).post(`/api/v1/jobs/${jobId}/invitations`).set(auth(e.token)).send(body as object);

  it('reaches the worker as a notification and an invitation, shows only the organization, and is marked applied when they apply', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await worker('Invited One');
    const sent = await invite(e, jobId, { workerId: w.profileId, message: 'Your experience looks right for this role. Please apply.' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);

    const inbox = await request(app).get('/api/v1/notifications').set(auth(w.token));
    expect(JSON.stringify(inbox.body)).toContain('job.invitation');
    const mine = await request(app).get('/api/v1/invitations/mine').set(auth(w.token));
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ status: 'SENT', message: 'Your experience looks right for this role. Please apply.' });
    expect(mine.body.items[0].job.id).toBe(jobId);
    expect(mine.body.items[0].job.organization).toMatch(/^TEST_ORG Talent/);
    expect(JSON.stringify(mine.body)).not.toContain(e.phone);

    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
    expect((await request(app).get('/api/v1/invitations/mine').set(auth(w.token))).body.items[0].status).toBe('APPLIED');
    const list = await request(app).get(`/api/v1/jobs/${jobId}/invitations`).set(auth(e.token));
    expect(list.body.items[0]).toMatchObject({ status: 'APPLIED', worker: { name: 'Invited One' } });
  });

  it('is refused for the wrong person, wrong job or wrong time', async () => {
    const e = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await worker('Refusals');
    // another employer's job, and an unknown worker
    expect((await invite(other, jobId, { workerId: w.profileId })).status).toBe(404);
    expect((await invite(e, jobId, { workerId: randomUUID() })).status).toBe(404);
    // hidden profile and suspended account look like "not found"
    const hidden = await worker('Hidden Invitee');
    await prisma.workerProfile.update({ where: { id: hidden.profileId }, data: { isVisible: false } });
    expect((await invite(e, jobId, { workerId: hidden.profileId })).status).toBe(404);
    // a draft / closed job
    const draft = (await request(app).post('/api/v1/jobs').set(auth(e.token)).send({ title: `Draft ${tag()}`, description: `Draft job. ${randomUUID()} ${randomUUID()} Apply with references.`, categoryId: transportId, employmentType: 'FULL_TIME', deadline: future(30), locationId: adamaId, skills: [{ skillId: heavyId, importance: 'REQUIRED' }] })).body.job.id;
    expect((await invite(e, draft, { workerId: w.profileId })).status).toBe(409);
    // twice
    expect((await invite(e, jobId, { workerId: w.profileId })).status).toBe(201);
    expect((await invite(e, jobId, { workerId: w.profileId })).status).toBe(409);
    // unknown fields are not silently ignored
    expect((await invite(e, jobId, { workerId: w.profileId, extra: 1 })).status).toBe(400);
  });

  it('is not sent to someone who already applied, or who lacks a must-have', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, { criteria: [{ criterionId: def['transport.vehicle_types'], importance: 'MUST_HAVE', value: ['truck'] }] });
    const applied = await worker('Applied Already', { answers: [{ criterionId: def['transport.vehicle_types'], value: ['truck'] }] });
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(applied.token)).send({})).status).toBe(201);
    expect((await invite(e, jobId, { workerId: applied.profileId })).status).toBe(409);
    const lacks = await worker('No Licence', { answers: [{ criterionId: def['transport.vehicle_types'], value: ['motorcycle'] }] });
    const r = await invite(e, jobId, { workerId: lacks.profileId });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('required condition');
  });

  it('keeps job posts job-related: a message that demands a gender or age is refused', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await worker('Message Guard');
    const r = await invite(e, jobId, { workerId: w.profileId, message: 'Only male candidates under 30 years old please.' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.message[0]).toContain('Please rewrite');
  });

  it('is limited per day', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const eRow = await prisma.user.findUniqueOrThrow({ where: { id: e.id } });
    const fillers = await Promise.all(Array.from({ length: 20 }, (_, i) => worker(`Filler ${i}`)));
    await prisma.jobInvitation.createMany({ data: fillers.map((f) => ({ jobId, workerId: f.profileId, invitedById: eRow.id })) });
    const extra = await worker('Over The Limit');
    expect((await invite(e, jobId, { workerId: extra.profileId })).status).toBe(429);
  });

  it('lets the worker decline; the employer then cannot invite again, and others cannot touch it', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await worker('Decliner');
    const stranger = await worker('Stranger');
    await invite(e, jobId, { workerId: w.profileId });
    const id = (await request(app).get('/api/v1/invitations/mine').set(auth(w.token))).body.items[0].id;
    expect((await request(app).post(`/api/v1/invitations/${id}/decline`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).post(`/api/v1/invitations/${id}/decline`).set(auth(e.token))).status).toBe(403);
    expect((await request(app).post(`/api/v1/invitations/${id}/decline`).set(auth(w.token))).status).toBe(204);
    expect((await request(app).post(`/api/v1/invitations/${id}/decline`).set(auth(w.token))).status).toBe(409);
    expect((await invite(e, jobId, { workerId: w.profileId })).status).toBe(409);
    expect((await request(app).get(`/api/v1/jobs/${jobId}/invitations`).set(auth(e.token))).body.items[0].status).toBe('DECLINED');
    expect((await request(app).get('/api/v1/invitations/mine').set(auth(stranger.token))).body.items).toEqual([]);
  });

  it('is employer-only to send and worker-only to receive', async () => {
    const e = await signUp('EMPLOYER');
    const w = await worker('Roles');
    const jobId = await liveJob(e);
    expect((await invite({ ...w } as User, jobId, { workerId: w.profileId })).status).toBe(403);
    expect((await request(app).get('/api/v1/invitations/mine').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/invitations/mine')).status).toBe(401);
    const other = await signUp('EMPLOYER');
    expect((await request(app).get(`/api/v1/jobs/${jobId}/invitations`).set(auth(other.token))).status).toBe(404);
  });
});
