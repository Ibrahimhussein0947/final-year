import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { makePdf } from './helpers/pdf';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const phones: string[] = [];
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz'[randomInt(0, 26)]).join('');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
type User = { token: string; id: string; name: string; phone: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', fullName?: string): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const name = fullName ?? `${cap(letters(7))} ${cap(letters(8))}`;
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: name, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Cv ${letters(6)}`, organizationType: 'SME' } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, name, phone: p };
}

let categoryId = '';
let skillId = '';
beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { categoryId } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

async function liveJob(e: User) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Mechanic ${letters(6)}`, description: `Workshop role for the CV test. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE', skills: [{ skillId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}

/** A worker whose profile says: 4 years of experience, a diploma, and the skill the test job needs. */
async function profiledWorker() {
  const w = await signUp('WORKER');
  expect((await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ yearsExperience: 4, categoryId, occupation: 'Mechanic' })).status).toBe(200);
  expect((await request(app).put(`/api/v1/workers/me/skills/${skillId}`).set(auth(w.token)).send({ proficiency: 4, years: 3 })).status).toBe(200);
  expect((await request(app).post('/api/v1/workers/me/education').set(auth(w.token)).send({ level: 'DIPLOMA', field: 'Automotive', institution: 'Adama Polytechnic', year: 2018 })).status).toBe(201);
  return w;
}
/** The text of a CV that agrees with that profile (dated jobs add up to 4 years, a diploma, the worker's own phone). */
const cvLines = (w: User, over: { name?: string; education?: string } = {}) => [
  over.name ?? w.name, `Phone: ${w.phone.slice(0, 4)} ${w.phone.slice(4, 6)} ${w.phone.slice(6, 8)} ${w.phone.slice(8)}`,
  'Experience', `Mechanic at Adama Garage ${new Date().getFullYear() - 4} - ${new Date().getFullYear()}`, 'Repaired engines and gearboxes for trucks and buses.',
  'Education', over.education ?? 'Diploma in Automotive Technology, Adama Polytechnic 2018',
  'Skills', 'welding, engine repair, diagnostics',
];
const uploadCv = (w: User, lines: string[]) => request(app).post('/api/v1/workers/me/cv').set(auth(w.token)).attach('file', makePdf(lines), 'cv.pdf');

describe('a CV is compared with the profile before it is accepted', () => {
  it("declines a CV in someone else's name and keeps nothing", async () => {
    const w = await profiledWorker();
    const r = await uploadCv(w, cvLines(w, { name: `${cap(letters(6))} ${cap(letters(7))}` }));
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error.code).toBe('PROFILE_MISMATCH');
    expect(r.body.error.details.reasons.join(' ')).toMatch(/name on your account/);
    expect(r.body.error.details.fix).toBeDefined();
    const profile = await request(app).get('/api/v1/workers/me').set(auth(w.token));
    expect(profile.body.profile?.cvUrl ?? profile.body.cvUrl ?? null).toBeNull();
    expect(await prisma.fileAsset.count({ where: { ownerId: w.id, kind: 'CV' } })).toBe(0);
    const last = await request(app).get('/api/v1/workers/me/cv-check').set(auth(w.token));
    expect(last.body.check.outcome).toBe('DECLINED');
    expect(last.body.hasCv).toBe(false);
  });

  it('declines a profile that claims much more education than the CV shows', async () => {
    const w = await profiledWorker();
    expect((await request(app).post('/api/v1/workers/me/education').set(auth(w.token)).send({ level: 'MASTER', field: 'Engineering', institution: 'Some University', year: 2022 })).status).toBe(201);
    const r = await uploadCv(w, cvLines(w));
    expect(r.status).toBe(422);
    expect(r.body.error.details.reasons.join(' ')).toMatch(/master/i);
  });

  it('accepts a CV that agrees, says what matched, and returns the open jobs that fit', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await profiledWorker();
    const r = await uploadCv(w, cvLines(w));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.cvCheck.outcome).toBe('ACCEPTED');
    expect(r.body.cvCheck.findings.filter((f: { severity: string }) => f.severity === 'ok').map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(['NAME', 'PHONE', 'EDUCATION', 'EXPERIENCE']));
    expect(r.body.profile.cvUrl).toBeTruthy();
    // the job opportunities according to what the worker offers
    expect(r.body.opportunities.items.map((i: { job: { id: string } }) => i.job.id)).toContain(jobId);
    expect(await prisma.notification.count({ where: { userId: w.id, type: 'cv.accepted' } })).toBe(1);
    const again = await request(app).get('/api/v1/workers/me/opportunities').set(auth(w.token));
    expect(again.body.items.map((i: { job: { id: string } }) => i.job.id)).toContain(jobId);
  });

  it('lets a CV through when it cannot be read, without calling it checked', async () => {
    const w = await profiledWorker();
    const r = await uploadCv(w, ['hi']);
    expect(r.status).toBe(201);
    expect(r.body.cvCheck.outcome).toBe('UNCHECKED');
    expect(r.body.opportunities).toBeNull();
  }, 60_000);
});

describe('applying', () => {
  it('declines the application when the profile has since been changed to contradict the CV, and accepts it once corrected', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await profiledWorker();
    expect((await uploadCv(w, cvLines(w))).status).toBe(201);

    expect((await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ yearsExperience: 15 })).status).toBe(200);
    const declined = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    expect(declined.status, JSON.stringify(declined.body)).toBe(422);
    expect(declined.body.error.code).toBe('PROFILE_MISMATCH');
    expect(declined.body.error.details.reasons.join(' ')).toMatch(/15 years/);
    expect(await prisma.application.count({ where: { jobId } })).toBe(0);

    expect((await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ yearsExperience: 4 })).status).toBe(200);
    const ok = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // the employer is told the CV was checked
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: e.id, type: 'application.received' } });
    expect(note.payload).toMatchObject({ cvCheck: 'ACCEPTED' });
  });

  it('applies normally when there is no CV to compare', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const w = await profiledWorker();
    expect((await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ yearsExperience: 30 })).status).toBe(200);
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
  });

  it('can be re-checked on request after the profile is corrected', async () => {
    const w = await profiledWorker();
    expect((await uploadCv(w, cvLines(w))).status).toBe(201);
    expect((await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ yearsExperience: 20 })).status).toBe(200);
    const bad = await request(app).post('/api/v1/workers/me/cv-check').set(auth(w.token)).send({});
    expect(bad.body.check.outcome).toBe('DECLINED');
    expect(bad.body.opportunities).toBeNull();
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ yearsExperience: 4 });
    const good = await request(app).post('/api/v1/workers/me/cv-check').set(auth(w.token)).send({});
    expect(good.body.check.outcome).toBe('ACCEPTED');
    expect((await request(app).post('/api/v1/workers/me/cv-check').set(auth((await signUp('WORKER')).token)).send({})).status).toBe(400); // no CV yet
  });

  it('is for workers only', async () => {
    const e = await signUp('EMPLOYER');
    expect((await request(app).get('/api/v1/workers/me/cv-check').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/workers/me/opportunities')).status).toBe(401);
  });
});
