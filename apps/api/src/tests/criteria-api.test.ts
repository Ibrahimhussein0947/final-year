import { randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { detectDiscrimination } from '../modules/criteria/discrimination';
import { makePdf } from './helpers/pdf';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string; phone: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', name = `Test ${role}`): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: name, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Crit ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}

let transportId = '';
let ictId = '';
let heavyId = '';
let engineId = '';
let zoneId = '';
const def: Record<string, string> = {};
const adminToken = () => jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: adminId, expiresIn: '10m' });
let adminId = '';

beforeAll(async () => {
  transportId = (await prisma.category.findFirstOrThrow({ where: { slug: 'transport' } })).id;
  ictId = (await prisma.category.findFirstOrThrow({ where: { slug: 'ict' } })).id;
  heavyId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
  engineId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'engine-repair' } })).id;
  zoneId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
  for (const row of await prisma.criterionDefinition.findMany({ include: { category: true } })) def[`${row.category?.slug ?? 'all'}.${row.key}`] = row.id;
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  adminId = (await prisma.user.create({ data: { phone: `+251${p.slice(1)}`, passwordHash: 'x', fullName: 'Crit Admin', role: 'ADMIN' } })).id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.criterionDefinition.deleteMany({ where: { key: { startsWith: 'test_' } } });
  await prisma.$disconnect();
});

const jobBody = (extra: Record<string, unknown> = {}, categoryId = transportId) => ({
  title: `Driver ${tag()}`, description: `We need a heavy truck driver for regional deliveries. ${randomUUID()} ${randomUUID()} Apply with your references.`,
  categoryId, employmentType: 'FULL_TIME', deadline: future(30), locationId: zoneId, skills: [{ skillId: heavyId, importance: 'REQUIRED' }], ...extra,
});
async function liveJob(e: User, criteria: unknown[] = [], extra: Record<string, unknown> = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send(jobBody({ criteria, ...extra }));
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}
async function driver(name: string, answers: { criterionId: string; value: unknown }[]) {
  const w = await signUp('WORKER', name);
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: transportId, headline: `Driver ${name}`, yearsExperience: 6, availability: 'IMMEDIATELY', locationId: zoneId });
  expect((await request(app).put('/api/v1/workers/me/skills/' + heavyId).set(auth(w.token)).send({ proficiency: 4 })).status).toBe(200);
  if (answers.length) expect((await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({ items: answers })).status).toBe(200);
  return w;
}

describe('definitions (public)', () => {
  it('lists the seeded sector questions, and filters to one sector plus the shared ones', async () => {
    const all = await request(app).get('/api/v1/criteria');
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThanOrEqual(35);
    const t = await request(app).get('/api/v1/criteria').query({ categoryId: transportId });
    const cats = new Set(t.body.items.map((i: any) => i.category?.slug ?? 'all'));
    expect([...cats].sort()).toEqual(['all', 'transport']);
    expect(t.body.items.find((i: any) => i.key === 'vehicle_types').options.length).toBeGreaterThan(3);
  });
  it('rejects a malformed category id', async () => {
    expect((await request(app).get('/api/v1/criteria').query({ categoryId: 'nope' })).status).toBe(400);
  });
});

describe('worker answers', () => {
  it('saves valid answers, lists them with readable text, and lets a person remove one', async () => {
    const w = await signUp('WORKER');
    const put = await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({
      items: [{ criterionId: def['transport.vehicle_types'], value: ['truck', 'light'] }, { criterionId: def['transport.licence_years'], value: 7 }, { criterionId: def['transport.clean_record'], value: true }],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const byId = Object.fromEntries(put.body.items.map((i: any) => [i.criterionId, i]));
    expect(byId[def['transport.vehicle_types']].text).toBe('Heavy truck, Light vehicle / taxi');
    expect(byId[def['transport.licence_years']].text).toBe('7 years');
    expect(put.body.items.every((i: any) => i.source === 'SELF_REPORTED' && i.verifiedAt === null)).toBe(true);
    const del = await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({ items: [{ criterionId: def['transport.clean_record'], value: null }] });
    expect(del.body.items).toHaveLength(2);
  });

  it('refuses answers that do not fit the question', async () => {
    const w = await signUp('WORKER');
    const bad: unknown[] = [
      { criterionId: def['transport.vehicle_types'], value: ['spaceship'] },
      { criterionId: def['transport.vehicle_types'], value: 'truck' },
      { criterionId: def['transport.licence_years'], value: 999 },
      { criterionId: def['transport.licence_years'], value: 'ten' },
      { criterionId: def['transport.clean_record'], value: 'yes' },
      { criterionId: def['ict.english_level'], value: 'native' },
      { criterionId: randomUUID(), value: true },
    ];
    for (const item of bad) {
      const r = await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({ items: [item] });
      expect(r.status, JSON.stringify(item)).toBe(400);
    }
    expect((await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({ items: [], extra: 1 })).status).toBe(400);
    expect((await request(app).get('/api/v1/workers/me/criteria').set(auth(w.token))).body.items).toEqual([]);
  });

  it('is limited to workers', async () => {
    const e = await signUp('EMPLOYER');
    expect((await request(app).get('/api/v1/workers/me/criteria').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/workers/me/criteria')).status).toBe(401);
  });
});

describe('job requirements', () => {
  it('stores requirements, returns them on the job page in readable form, and replaces them on update', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, [
      { criterionId: def['transport.vehicle_types'], importance: 'MUST_HAVE', value: ['truck'] },
      { criterionId: def['transport.licence_years'], importance: 'PREFERRED', value: 3 },
      { criterionId: def['all.shifts'], importance: 'PREFERRED', value: ['night'] },
    ]);
    const detail = await request(app).get(`/api/v1/jobs/${jobId}`);
    const byKey = Object.fromEntries(detail.body.job.criteria.map((c: any) => [c.key, c]));
    expect(byKey.vehicle_types).toMatchObject({ importance: 'MUST_HAVE', value: ['truck'], text: 'Heavy truck' });
    expect(byKey.licence_years.text).toBe('at least 3 years');
    expect(detail.body.job.criteria).toHaveLength(3);

    const upd = await request(app).patch(`/api/v1/jobs/${jobId}`).set(auth(e.token)).send({ criteria: [{ criterionId: def['transport.clean_record'], importance: 'PREFERRED', value: true }] });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect((await request(app).get(`/api/v1/jobs/${jobId}`)).body.job.criteria.map((c: any) => c.key)).toEqual(['clean_record']);
  });

  it('refuses requirements that do not fit', async () => {
    const e = await signUp('EMPLOYER');
    const tryJob = (criteria: unknown[], categoryId = transportId) => request(app).post('/api/v1/jobs').set(auth(e.token)).send(jobBody({ criteria }, categoryId));
    const cases: [string, unknown[], string?][] = [
      ['another sector', [{ criterionId: def['ict.portfolio'], importance: 'PREFERRED', value: true }]],
      ['option not in list', [{ criterionId: def['transport.vehicle_types'], importance: 'MUST_HAVE', value: ['hovercraft'] }]],
      ['yes/no must be yes', [{ criterionId: def['transport.clean_record'], importance: 'PREFERRED', value: false }]],
      ['a preference-only criterion cannot be a must-have', [{ criterionId: def['construction.crew_size'], importance: 'MUST_HAVE', value: 5 }], ictId],
      ['listed twice', [{ criterionId: def['transport.clean_record'], importance: 'PREFERRED', value: true }, { criterionId: def['transport.clean_record'], importance: 'MUST_HAVE', value: true }]],
      ['unknown id', [{ criterionId: randomUUID(), importance: 'PREFERRED', value: true }]],
      ['empty choice', [{ criterionId: def['transport.vehicle_types'], importance: 'PREFERRED', value: [] }]],
    ];
    for (const [name, criteria, cat] of cases) {
      const r = await tryJob(criteria, cat);
      expect(r.status, name).toBe(400);
    }
    // a "shared" criterion works in any sector
    expect((await tryJob([{ criterionId: def['all.shifts'], importance: 'PREFERRED', value: ['day'] }], ictId)).status).toBe(201);
  });

  it('moving a job to another sector drops requirements that belonged to the old one but keeps shared ones', async () => {
    const e = await signUp('EMPLOYER');
    const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send(jobBody({ criteria: [
      { criterionId: def['transport.clean_record'], importance: 'PREFERRED', value: true },
      { criterionId: def['all.shifts'], importance: 'PREFERRED', value: ['night'] },
    ] }));
    const id = create.body.job.id;
    expect((await request(app).patch(`/api/v1/jobs/${id}`).set(auth(e.token)).send({ categoryId: ictId })).status).toBe(200);
    const after = (await prisma.jobCriterion.findMany({ where: { jobId: id }, include: { criterion: true } })).map((c) => c.criterion.key);
    expect(after).toEqual(['shifts']);
  });
});

describe('sector requirements in matching', () => {
  it('must-have: a person who lacks the licence is not recommended, an unconfirmed one is shown as unconfirmed', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, [{ criterionId: def['transport.vehicle_types'], importance: 'MUST_HAVE', value: ['truck'] }]);
    const ok = await driver('Has licence', [{ criterionId: def['transport.vehicle_types'], value: ['truck', 'light'] }]);
    const lacks = await driver('Light only', [{ criterionId: def['transport.vehicle_types'], value: ['light'] }]);
    const silent = await driver('No answer', []);

    const rec = await request(app).get(`/api/v1/jobs/${jobId}/recommended-workers`).set(auth(e.token));
    expect(rec.status).toBe(200);
    const text = JSON.stringify(rec.body);
    expect(text).toContain('Has licence');
    expect(text).toContain('No answer');
    expect(text).not.toContain('Light only');
    const byName = (n: string) => rec.body.items.find((i: any) => JSON.stringify(i).includes(n));
    expect(byName('Has licence').match.eligibility).toBe('eligible');
    expect(byName('No answer').match.eligibility).toBe('unknown');
    expect(byName('No answer').match.strength).not.toBe('strong');
    expect(byName('Has licence').match.score).toBeGreaterThanOrEqual(byName('No answer').match.score);

    // the worker who lacks it sees why, on the job page
    const mine = await request(app).get(`/api/v1/jobs/${jobId}/match`).set(auth(lacks.token));
    expect(mine.status).toBe(200);
    expect(mine.body.match.eligibility).toBe('not_eligible');
    expect(mine.body.match.strength).toBe('weak');
    expect(mine.body.match.explanation).toContain('Does not meet a required condition');
    expect(mine.body.match.criteria.unmet[0]).toMatchObject({ mustHave: true });
    // and the recommended jobs list leaves it out
    const jobs = await request(app).get('/api/v1/recommendations/jobs').set(auth(lacks.token));
    expect(JSON.stringify(jobs.body)).not.toContain(jobId);
    expect(JSON.stringify((await request(app).get('/api/v1/recommendations/jobs').set(auth(ok.token))).body)).toContain(jobId);
    void silent;
  });

  it('a person who is not eligible may still apply; the employer sees the flag', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, [{ criterionId: def['transport.vehicle_types'], importance: 'MUST_HAVE', value: ['truck'] }]);
    const lacks = await driver('Applies anyway', [{ criterionId: def['transport.vehicle_types'], value: ['motorcycle'] }]);
    const apply = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(lacks.token)).send({});
    expect(apply.status).toBe(201);
    const candidate = await request(app).get(`/api/v1/applications/${apply.body.applicationId}`).set(auth(e.token));
    expect(candidate.body.match.eligibility).toBe('not_eligible');
    expect(candidate.body.profile.sectorAnswers[0]).toMatchObject({ labelEn: 'Vehicle types I am licensed to drive', text: 'Motorcycle', verified: false });
  });

  it('preferences move the score without blocking anyone', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, [{ criterionId: def['transport.clean_record'], importance: 'PREFERRED', value: true }]);
    const yes = await driver('Clean yes', [{ criterionId: def['transport.clean_record'], value: true }]);
    const no = await driver('Clean no', [{ criterionId: def['transport.clean_record'], value: false }]);
    const a = (await request(app).get(`/api/v1/jobs/${jobId}/match`).set(auth(yes.token))).body.match;
    const b = (await request(app).get(`/api/v1/jobs/${jobId}/match`).set(auth(no.token))).body.match;
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.eligibility).toBe('n/a');
    expect(JSON.stringify((await request(app).get('/api/v1/recommendations/jobs').set(auth(no.token))).body)).toContain(jobId);
  });

  it('a hidden criterion stops affecting matching', async () => {
    const created = await request(app).post('/api/v1/admin/criteria').set(auth(adminToken())).send({ categoryId: transportId, key: 'test_hide_me', type: 'BOOLEAN', labelEn: 'Test criterion to hide' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, [{ criterionId: created.body.id, importance: 'MUST_HAVE', value: true }]);
    const w = await driver('Hidden test', [{ criterionId: created.body.id, value: false }]);
    expect((await request(app).get(`/api/v1/jobs/${jobId}/match`).set(auth(w.token))).body.match.eligibility).toBe('not_eligible');
    expect((await request(app).patch(`/api/v1/admin/criteria/${created.body.id}`).set(auth(adminToken())).send({ isActive: false })).status).toBe(204);
    expect((await request(app).get(`/api/v1/jobs/${jobId}/match`).set(auth(w.token))).body.match.eligibility).toBe('n/a');
    expect((await request(app).get('/api/v1/criteria')).body.items.some((i: any) => i.key === 'test_hide_me')).toBe(false);
  });
});

describe('different sectors ask for different things', () => {
  type Scenario = {
    name: string; sector: string; skill: string; title: string; description: string;
    must: { key: string; value: unknown }; extra: { key: string; importance: 'PREFERRED'; value: unknown }[];
    good: { key: string; value: unknown }[]; bad: { key: string; value: unknown }[];
  };
  const scenarios: Scenario[] = [
    {
      name: 'writer', sector: 'media-creative', skill: 'copywriting', title: 'Content writer for a news website',
      description: 'We need a content writer to produce articles and web copy in Amharic and English. You will research, write, edit and publish to deadlines. Send samples of your work with your application.',
      must: { key: 'portfolio_samples', value: true },
      extra: [{ key: 'writing_languages', importance: 'PREFERRED', value: ['en', 'am'] }, { key: 'writing_types', importance: 'PREFERRED', value: ['web'] }, { key: 'seo_basics', importance: 'PREFERRED', value: true }],
      good: [{ key: 'portfolio_samples', value: true }, { key: 'writing_languages', value: ['en', 'am', 'om'] }, { key: 'writing_types', value: ['web', 'marketing'] }, { key: 'published_pieces', value: 40 }],
      bad: [{ key: 'portfolio_samples', value: false }, { key: 'writing_languages', value: ['en'] }],
    },
    {
      name: 'security guard', sector: 'security', skill: 'guard-duty', title: 'Night security guard for a warehouse',
      description: 'A warehouse needs a security guard for night shifts. You will control the gate, patrol the compound, keep a log and report incidents to the supervisor. Training certificate required.',
      must: { key: 'guard_training', value: true },
      extra: [{ key: 'guard_type', importance: 'PREFERRED', value: ['static', 'patrol'] }, { key: 'first_aid_certificate', importance: 'PREFERRED', value: true }],
      good: [{ key: 'guard_training', value: true }, { key: 'guard_type', value: ['static', 'patrol'] }, { key: 'first_aid_certificate', value: true }],
      bad: [{ key: 'guard_training', value: false }],
    },
    {
      name: 'teacher', sector: 'education', skill: 'teaching-secondary', title: 'Secondary mathematics teacher',
      description: 'A private secondary school needs a mathematics teacher for grades 9 to 12. You will plan lessons, teach, assess students and prepare them for the national exam. Teaching licence required.',
      must: { key: 'teaching_licence', value: true },
      extra: [{ key: 'subjects', importance: 'PREFERRED', value: ['math'] }, { key: 'exam_preparation', importance: 'PREFERRED', value: true }, { key: 'child_safeguarding', importance: 'PREFERRED', value: true }],
      good: [{ key: 'teaching_licence', value: true }, { key: 'subjects', value: ['math', 'physics'] }, { key: 'exam_preparation', value: true }],
      bad: [{ key: 'teaching_licence', value: false }, { key: 'subjects', value: ['math'] }],
    },
  ];

  for (const sc of scenarios) {
    it(`${sc.name}: the sector's own must-have decides eligibility`, async () => {
      const category = await prisma.category.findFirstOrThrow({ where: { slug: sc.sector } });
      const skill = await prisma.skill.findFirstOrThrow({ where: { slug: sc.skill } });
      const id = (key: string) => def[`${sc.sector}.${key}`] ?? (() => { throw new Error(`missing criterion ${sc.sector}.${key}`); })();
      const answers = (list: { key: string; value: unknown }[]) => list.map((a) => ({ criterionId: id(a.key), value: a.value }));
      const person = async (name: string, list: { key: string; value: unknown }[]) => {
        const w = await signUp('WORKER', name);
        await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: category.id, headline: `${sc.name} ${name}`, yearsExperience: 5, availability: 'IMMEDIATELY', locationId: zoneId });
        expect((await request(app).put(`/api/v1/workers/me/skills/${skill.id}`).set(auth(w.token)).send({ proficiency: 4 })).status).toBe(200);
        if (list.length) expect((await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({ items: answers(list) })).status).toBe(200);
        return w;
      };

      const e = await signUp('EMPLOYER');
      const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
        title: sc.title, description: `${sc.description} ${randomUUID()} ${randomUUID()}`, categoryId: category.id, employmentType: 'FULL_TIME', deadline: future(30), locationId: zoneId,
        skills: [{ skillId: skill.id, importance: 'REQUIRED' }],
        criteria: [{ criterionId: id(sc.must.key), importance: 'MUST_HAVE', value: sc.must.value }, ...sc.extra.map((x) => ({ criterionId: id(x.key), importance: x.importance, value: x.value }))],
      });
      expect(create.status, JSON.stringify(create.body)).toBe(201);
      const jobId = create.body.job.id as string;
      expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set(auth(e.token)).send({})).status).toBe(200);

      const good = await person('Good fit', sc.good);
      const bad = await person('Lacks it', sc.bad);
      const silent = await person('No answers', []);

      const rec = await request(app).get(`/api/v1/jobs/${jobId}/recommended-workers`).set(auth(e.token));
      const text = JSON.stringify(rec.body);
      expect(text).toContain('Good fit');
      expect(text).toContain('No answers');
      expect(text).not.toContain('Lacks it');
      const by = (n: string) => rec.body.items.find((i: any) => JSON.stringify(i).includes(n));
      expect(by('Good fit').match.eligibility).toBe('eligible');
      expect(by('No answers').match.eligibility).toBe('unknown');
      expect(by('Good fit').match.score).toBeGreaterThan(by('No answers').match.score);
      expect((await request(app).get(`/api/v1/jobs/${jobId}/match`).set(auth(bad.token))).body.match.eligibility).toBe('not_eligible');
      void good; void silent;
    });
  }
});

describe('verification of an answer', () => {
  it('an administrator can verify an answer from evidence; changing the answer removes the mark', async () => {
    const w = await driver('To verify', [{ criterionId: def['transport.vehicle_types'], value: ['truck'] }]);
    const row = (await request(app).get('/api/v1/workers/me/criteria').set(auth(w.token))).body.items[0];
    const req = await request(app).post('/api/v1/workers/me/verification').set(auth(w.token))
      .field('kind', 'QUALIFICATION').field('targetType', 'CRITERION').field('targetId', row.id)
      .attach('file', makePdf(['Driving licence scan']), { filename: 'licence.pdf', contentType: 'application/pdf' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect((await request(app).get('/api/v1/workers/me/criteria').set(auth(w.token))).body.items[0].verificationPending).toBe(true);

    const queue = await request(app).get('/api/v1/admin/verifications').query({ status: 'PENDING' }).set(auth(adminToken()));
    const item = queue.body.items.find((i: any) => i.target?.startsWith('Vehicle types I am licensed to drive'));
    expect(item, JSON.stringify(queue.body).slice(0, 300)).toBeTruthy();
    expect(item.target).toBe('Vehicle types I am licensed to drive: Heavy truck');
    const review = await request(app).post(`/api/v1/admin/verifications/${item.id}/review`).set(auth(adminToken())).send({ decision: "APPROVED" });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    const after = (await request(app).get('/api/v1/workers/me/criteria').set(auth(w.token))).body.items[0];
    expect(after.source).toBe('VERIFIED');
    expect(after.verifiedAt).not.toBeNull();

    // same answer saved again: still verified. A different answer: back to self-reported.
    await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({ items: [{ criterionId: def['transport.vehicle_types'], value: ['truck'] }] });
    expect((await request(app).get('/api/v1/workers/me/criteria').set(auth(w.token))).body.items[0].source).toBe('VERIFIED');
    await request(app).put('/api/v1/workers/me/criteria').set(auth(w.token)).send({ items: [{ criterionId: def['transport.vehicle_types'], value: ['truck', 'trailer'] }] });
    expect((await request(app).get('/api/v1/workers/me/criteria').set(auth(w.token))).body.items[0].source).toBe('SELF_REPORTED');
  });

  it('a worker cannot request verification of someone else\'s answer', async () => {
    const a = await driver('Owner', [{ criterionId: def['transport.clean_record'], value: true }]);
    const b = await signUp('WORKER');
    const row = (await request(app).get('/api/v1/workers/me/criteria').set(auth(a.token))).body.items[0];
    const r = await request(app).post('/api/v1/workers/me/verification').set(auth(b.token))
      .field('kind', 'QUALIFICATION').field('targetType', 'CRITERION').field('targetId', row.id)
      .attach('file', makePdf(['x']), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(404);
  });
});

describe('administrator management', () => {
  it('creates, edits and hides criteria; shows usage; protects key, type and sector', async () => {
    const admin = adminToken();
    const make = (body: Record<string, unknown>) => request(app).post('/api/v1/admin/criteria').set(auth(admin)).send(body);
    const c = await make({ categoryId: transportId, key: 'test_shift_pref', type: 'CHOICE', labelEn: 'Test preferred shift', options: [{ value: 'a', labelEn: 'A' }, { value: 'b', labelEn: 'B' }] });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await make({ categoryId: transportId, key: 'test_shift_pref', type: 'BOOLEAN', labelEn: 'Duplicate key' })).status).toBe(409);
    expect((await make({ key: 'Bad Key', type: 'BOOLEAN', labelEn: 'Bad key here' })).status).toBe(400);
    expect((await make({ key: 'test_one_option', type: 'CHOICE', labelEn: 'One option only', options: [{ value: 'a', labelEn: 'A' }] })).status).toBe(400);
    expect((await make({ key: 'test_bool_opts', type: 'BOOLEAN', labelEn: 'Boolean with options', options: [{ value: 'a', labelEn: 'A' }, { value: 'b', labelEn: 'B' }] })).status).toBe(400);
    expect((await make({ key: 'test_range', type: 'NUMBER', labelEn: 'Bad range here', minValue: 10, maxValue: 1 })).status).toBe(400);

    const patch = (body: Record<string, unknown>) => request(app).patch(`/api/v1/admin/criteria/${c.body.id}`).set(auth(admin)).send(body);
    expect((await patch({ labelEn: 'Test preferred shift (edited)', labelAm: 'ሙከራ' })).status).toBe(204);
    expect((await patch({ key: 'other' })).status).toBe(400); // immutable
    expect((await patch({ type: 'BOOLEAN' })).status).toBe(400);
    expect((await patch({ categoryId: ictId })).status).toBe(400);
    expect((await patch({ options: [{ value: 'a', labelEn: 'A' }] })).status).toBe(400);

    const list = await request(app).get('/api/v1/admin/criteria').set(auth(admin));
    const row = list.body.items.find((i: any) => i.id === c.body.id);
    expect(row).toMatchObject({ labelEn: 'Test preferred shift (edited)', labelAm: 'ሙከራ', usage: { jobs: 0, workers: 0 } });
    expect(list.body.items.length).toBeGreaterThanOrEqual(36);
  });

  it('is for administrators only', async () => {
    const w = await signUp('WORKER');
    const e = await signUp('EMPLOYER');
    for (const t of [w.token, e.token]) {
      expect((await request(app).get('/api/v1/admin/criteria').set(auth(t))).status).toBe(403);
      expect((await request(app).post('/api/v1/admin/criteria').set(auth(t)).send({ key: 'test_x', type: 'BOOLEAN', labelEn: 'Sneaky one' })).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/criteria')).status).toBe(401);
  });
});

describe('job text must be job-related', () => {
  const create = (e: User, description: string, extra: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/jobs').set(auth(e.token)).send(jobBody({ description: `${description} ${randomUUID()} ${randomUUID()}`, ...extra }));

  it('refuses gender, age, religion, ethnicity and marital-status demands with a message that says what to write instead', async () => {
    const e = await signUp('EMPLOYER');
    for (const text of [
      'We need a driver. Male candidates only.',
      'Cashier wanted, females only, apply now.',
      'Looking for a guard. Age between 25 and 35 years.',
      'Waiter needed, must be below 30 years old.',
      'Orthodox Christians only will be considered.',
      'Single women preferred for this household job.',
    ]) {
      const r = await create(e, text);
      expect(r.status, text).toBe(400);
      expect(r.body.error.details.description[0]).toContain('Please rewrite');
    }
    const t = await request(app).post('/api/v1/jobs').set(auth(e.token)).send(jobBody({ title: 'Driver (male only)' }));
    expect(t.status).toBe(400);
  });

  it('also refuses it when an existing job is edited', async () => {
    const e = await signUp('EMPLOYER');
    const ok = await create(e, 'We need a heavy truck driver for regional deliveries.');
    expect(ok.status).toBe(201);
    const r = await request(app).patch(`/api/v1/jobs/${ok.body.job.id}`).set(auth(e.token)).send({ benefits: 'Housing for females only' });
    expect(r.status).toBe(400);
  });

  it('allows legitimate job-related wording', async () => {
    const e = await signUp('EMPLOYER');
    for (const text of [
      'Must be 18 or older and hold a valid heavy vehicle licence.',
      'The work involves lifting 20 kg loads and night shifts.',
      'You will care for female patients on the maternity ward.',
      'Applicants from all regions and backgrounds are welcome.',
      'Experience of 5 to 10 years in transport is required.',
    ]) {
      expect((await create(e, text)).status, text).toBe(201);
    }
  });

  it('warns while the employer is still writing (job analysis)', async () => {
    const e = await signUp('EMPLOYER');
    const r = await request(app).post('/api/v1/analysis/job').set(auth(e.token)).send({ title: 'Driver', description: 'We need a driver for trucks. Males only. Apply with references.' });
    expect(r.status).toBe(200);
    expect(r.body.analysis.notes[0]).toContain('gender requirement');
  });
});

describe('discrimination detector (unit)', () => {
  it('finds explicit demands and ignores job-related text', () => {
    const kinds = (t: string) => detectDiscrimination(t).map((f) => f.kind);
    expect(kinds('Female only')).toEqual(['gender']);
    expect(kinds('only men may apply')).toEqual(['gender']);
    expect(kinds('Sex: male')).toEqual(['gender']);
    expect(kinds('Aged 20-30 years old')).toContain('age');
    expect(kinds('not older than 35 years')).toContain('age');
    expect(kinds('Muslim only')).toEqual(['religion']);
    expect(kinds('Marital status: single')).toEqual(['marital']);
    expect(kinds('must be 18 or older')).toEqual([]);
    expect(kinds('Men and women are equally welcome to apply')).toEqual([]);
    expect(kinds('5 to 10 years of experience')).toEqual([]);
    expect(kinds('')).toEqual([]);
  });
});
