import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { csvCell } from '../modules/admin/routes';
import { uploadRoot } from '../modules/files/storage';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
type User = { token: string; id: string; phone: string };

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}
async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const phone = newPhone();
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag().slice(2, 6)}`, phone, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Admin ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}
async function makeAdmin(): Promise<User> {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: `Test Admin ${tag().slice(2, 6)}`, phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' });
  return { token: login.body.accessToken, id: u.id, phone: u.phone };
}

let autoId = '';
let skill: Record<string, string> = {};
let admin: User;
const get = (u: User, p: string) => request(app).get(`/api/v1/admin${p}`).set(auth(u.token));
const post = (u: User, p: string, body: unknown = {}) => request(app).post(`/api/v1/admin${p}`).set(auth(u.token)).send(body as object);
const patch = (u: User, p: string, body: unknown) => request(app).patch(`/api/v1/admin${p}`).set(auth(u.token)).send(body as object);

async function liveJob(e: User, over: Record<string, unknown> = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Admin job ${tag()}`, description: `Repair vehicles. ${randomUUID()} ${randomUUID()} Please apply with your experience and references.`,
    categoryId: autoId, employmentType: 'FULL_TIME', deadline: future(30), minExperienceYears: 2,
    locationId: (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id,
    skills: [{ skillId: skill['engine-repair'], importance: 'REQUIRED' }, { skillId: skill['brake-systems'], importance: 'REQUIRED' }], ...over,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const id = create.body.job.id as string;
  const pub = await request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({});
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return { id, status: pub.body.job.status as string };
}
async function skilledWorker(skills = ['engine-repair', 'brake-systems']) {
  const w = await signUp('WORKER');
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: autoId, yearsExperience: 6, headline: 'Mechanic' });
  for (const s of skills) await request(app).put(`/api/v1/workers/me/skills/${skill[s]}`).set(auth(w.token)).send({ proficiency: 4 });
  return w;
}

beforeAll(async () => {
  autoId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  const rows = await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems', 'welding'] } } });
  skill = Object.fromEntries(rows.map((s) => [s.slug, s.id]));
  admin = await makeAdmin();
});
afterEach(() => {
  env.reviewUnverifiedJobs = false;
});
afterAll(async () => {
  const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  for (const f of await prisma.fileAsset.findMany({ where: { ownerId: { in: ids } } })) fs.rmSync(path.join(uploadRoot, f.storagePath), { force: true });
  await prisma.auditLog.deleteMany({});
  await prisma.report.deleteMany({});
  await prisma.verificationRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.translation.deleteMany({ where: { key: { startsWith: 'zqtest' } } });
  await prisma.skill.deleteMany({ where: { nameEn: { startsWith: 'ZQ Test' } } });
  await prisma.category.deleteMany({ where: { nameEn: { startsWith: 'ZQ Test' } } });
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('access control', () => {
  it('keeps every admin endpoint away from everyone but administrators', async () => {
    const w = await signUp('WORKER');
    const e = await signUp('EMPLOYER');
    const paths = ['/stats', '/system', '/users', '/verifications', '/moderation/reports', '/moderation/jobs', '/categories', '/skills', '/translations', '/audit', '/analytics/national', '/analytics/recommendations', '/export/platform-summary'];
    for (const p of paths) {
      expect((await request(app).get(`/api/v1/admin${p}`)).status, `anon ${p}`).toBe(401);
      expect((await get(w, p)).status, `worker ${p}`).toBe(403);
      expect((await get(e, p)).status, `employer ${p}`).toBe(403);
      expect((await get(admin, p)).status, `admin ${p}`).toBe(200);
    }
    expect((await post(w, '/verifications/00000000-0000-4000-8000-000000000000/review', { decision: 'APPROVED' })).status).toBe(403);
    expect((await patch(e, '/users/00000000-0000-4000-8000-000000000000/status', { status: 'SUSPENDED', reason: 'abc' })).status).toBe(403);
  });
});

describe('overview, system and audit', () => {
  it('reports platform numbers and health', async () => {
    const before = (await get(admin, '/stats')).body.stats;
    await signUp('WORKER');
    await signUp('EMPLOYER');
    const after = (await get(admin, '/stats')).body.stats;
    expect(after.users).toBe(before.users + 2);
    expect(after.workers).toBe(before.workers + 1);
    expect(after.employers).toBe(before.employers + 1);
    for (const k of ['jobs', 'activeJobs', 'applications', 'successfulRecruitments', 'pendingVerifications', 'openReports', 'suspiciousAds']) expect(typeof after[k]).toBe('number');
    const sys = (await get(admin, '/system')).body;
    expect(sys.database.ok).toBe(true);
    expect(sys.aiService).toEqual({ configured: false });
    expect(sys.sms.gatewayConfigured).toBe(false);
  });

  it('lets administrators search the audit trail and records their own actions', async () => {
    const w = await signUp('WORKER');
    await patch(admin, `/users/${w.id}/status`, { status: 'SUSPENDED', reason: 'test reason' });
    const r = await get(admin, '/audit?action=admin.user_suspended&pageSize=5');
    expect(r.status).toBe(200);
    expect(r.body.items[0]).toMatchObject({ action: 'admin.user_suspended', entityId: w.id, actor: { id: admin.id, role: 'ADMIN' } });
    expect(r.body.items[0].meta).toEqual({ reason: 'test reason' });
    expect((await get(admin, `/audit?actorId=${admin.id}&pageSize=1`)).body.items).toHaveLength(1);
    expect((await get(admin, '/audit?from=not-a-date')).status).toBe(400);
    expect((await get(admin, '/audit?pageSize=1000')).status).toBe(400);
  });
});

describe('managing users', () => {
  it('searches and filters', async () => {
    const w = await signUp('WORKER');
    const byPhone = await get(admin, `/users?q=${encodeURIComponent(w.phone.slice(-7))}`);
    expect(byPhone.body.items.map((u: { id: string }) => u.id)).toContain(w.id);
    expect((await get(admin, '/users?role=EMPLOYER')).body.items.every((u: { role: string }) => u.role === 'EMPLOYER')).toBe(true);
    expect((await get(admin, '/users?role=NOPE')).status).toBe(400);
    const e = (await get(admin, '/users?role=EMPLOYER&pageSize=1')).body.items[0];
    expect(e.organization).toMatchObject({ verificationStatus: 'UNVERIFIED' });
    expect(JSON.stringify(e)).not.toContain('passwordHash');
  });

  it('suspends with a reason, cuts off every session, and can reactivate', async () => {
    const w = await signUp('WORKER');
    const login = await request(app).post('/api/v1/auth/login').send({ phone: w.phone.replace('+251', '0'), password: 'Passw0rdTest' });
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('et_refresh='))!;

    expect((await patch(admin, `/users/${w.id}/status`, { status: 'SUSPENDED' })).status).toBe(400); // reason required
    expect((await patch(admin, `/users/${w.id}/status`, { status: 'SUSPENDED', reason: 'Repeated fake profiles' })).body).toMatchObject({ status: 'SUSPENDED', changed: true });

    expect((await request(app).get('/api/v1/auth/me').set(auth(w.token))).status).toBe(401); // existing token
    expect((await request(app).post('/api/v1/auth/refresh').set('X-CSRF-Protection', '1').set('Cookie', cookie)).status).toBe(401); // refresh revoked
    expect((await request(app).post('/api/v1/auth/login').send({ phone: w.phone.replace('+251', '0'), password: 'Passw0rdTest' })).status).toBe(401);
    expect((await patch(admin, `/users/${w.id}/status`, { status: 'SUSPENDED', reason: 'again' })).body.changed).toBe(false);

    expect((await patch(admin, `/users/${w.id}/status`, { status: 'ACTIVE' })).body.status).toBe('ACTIVE');
    expect((await request(app).post('/api/v1/auth/login').send({ phone: w.phone.replace('+251', '0'), password: 'Passw0rdTest' })).status).toBe(200);
  });

  it('never lets an administrator suspend themselves or another administrator', async () => {
    const other = await makeAdmin();
    expect((await patch(admin, `/users/${admin.id}/status`, { status: 'SUSPENDED', reason: 'oops' })).status).toBe(403);
    expect((await patch(admin, `/users/${other.id}/status`, { status: 'SUSPENDED', reason: 'coup' })).status).toBe(403);
    expect((await patch(admin, '/users/00000000-0000-4000-8000-000000000000/status', { status: 'SUSPENDED', reason: 'ghost' })).status).toBe(404);
    expect((await patch(admin, `/users/${other.id}/status`, { status: 'DELETED', reason: 'x' })).status).toBe(400);
  });
});

describe('verification review', () => {
  it('verifies an employer only after an administrator approves the evidence', async () => {
    const e = await signUp('EMPLOYER');
    await request(app).post('/api/v1/employers/me/verification').set(auth(e.token)).attach('file', PDF, 'licence.pdf');
    const queue = (await get(admin, '/verifications')).body.items;
    const item = queue.find((i: { requester: { id: string } }) => i.requester.id === e.id);
    expect(item).toMatchObject({ kind: 'EMPLOYER', status: 'PENDING', organization: { verificationStatus: 'PENDING' } });
    expect(item.evidenceUrl).toMatch(/^\/api\/v1\/files\//);
    expect((await request(app).get(item.evidenceUrl).set(auth(admin.token))).status).toBe(200);

    expect((await post(admin, `/verifications/${item.id}/review`, { decision: 'REJECTED' })).status).toBe(400); // note required
    const ok = await post(admin, `/verifications/${item.id}/review`, { decision: 'APPROVED', note: 'Licence checked' });
    expect(ok.status).toBe(200);
    const org = await prisma.organization.findFirstOrThrow({ where: { employers: { some: { userId: e.id } } } });
    expect(org.verificationStatus).toBe('VERIFIED');
    expect(org.verifiedAt).not.toBeNull();
    expect((await post(admin, `/verifications/${item.id}/review`, { decision: 'APPROVED' })).status).toBe(409); // already reviewed
    const note = (await request(app).get('/api/v1/notifications').set(auth(e.token))).body.items.find((n: { type: string }) => n.type === 'verification.reviewed');
    expect(note.payload).toMatchObject({ kind: 'EMPLOYER', decision: 'APPROVED' });
  });

  it('rejects with a reason that the employer can see, and they can try again', async () => {
    const e = await signUp('EMPLOYER');
    await request(app).post('/api/v1/employers/me/verification').set(auth(e.token)).attach('file', PDF, 'licence.pdf');
    const id = (await get(admin, '/verifications')).body.items.find((i: { requester: { id: string } }) => i.requester.id === e.id).id;
    await post(admin, `/verifications/${id}/review`, { decision: 'REJECTED', note: 'Document is unreadable' });
    const mine = (await request(app).get('/api/v1/employers/me').set(auth(e.token))).body;
    expect(mine.organization.verificationStatus).toBe('REJECTED');
    expect(mine.latestVerificationRequest).toMatchObject({ status: 'REJECTED', note: 'Document is unreadable' });
    expect((await request(app).post('/api/v1/employers/me/verification').set(auth(e.token)).attach('file', PDF, 'new.pdf')).status).toBe(201);
  });

  it('verifies a worker qualification or skill, and only the one that was reviewed', async () => {
    const w = await skilledWorker();
    const other = await signUp('WORKER');
    await request(app).post('/api/v1/workers/me/education').set(auth(w.token)).send({ level: 'DIPLOMA', field: 'Automotive' });
    await request(app).post('/api/v1/workers/me/education').set(auth(w.token)).send({ level: 'BACHELOR', field: 'Law' });
    const prof = (await request(app).get('/api/v1/workers/me').set(auth(w.token))).body.profile;
    const dipId = prof.education.find((x: { level: string }) => x.level === 'DIPLOMA').id;
    const req = (u: User, fields: Record<string, string>, file = PDF) => {
      let r = request(app).post('/api/v1/workers/me/verification').set(auth(u.token));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file, 'proof.pdf');
    };

    expect((await req(other, { kind: 'QUALIFICATION', targetType: 'EDUCATION', targetId: dipId })).status).toBe(404); // not their item
    expect((await req(w, { kind: 'SKILL', targetType: 'EDUCATION', targetId: dipId })).status).toBe(400); // mismatch
    expect((await req(w, { kind: 'QUALIFICATION', targetType: 'EDUCATION', targetId: dipId }, Buffer.from('nope'))).status).toBe(415);
    const sent = await req(w, { kind: 'QUALIFICATION', targetType: 'EDUCATION', targetId: dipId });
    expect(sent.status).toBe(201);
    expect((await req(w, { kind: 'QUALIFICATION', targetType: 'EDUCATION', targetId: dipId })).status).toBe(409); // already waiting
    expect((await req(w, { kind: 'SKILL', targetType: 'SKILL', targetId: skill['engine-repair'] })).status).toBe(201);

    const queue = (await get(admin, '/verifications?kind=QUALIFICATION')).body.items;
    const row = queue.find((i: { id: string }) => i.id === sent.body.id);
    expect(row.target).toContain('DIPLOMA');
    await post(admin, `/verifications/${sent.body.id}/review`, { decision: 'APPROVED' });
    const skillReq = (await get(admin, '/verifications?kind=SKILL')).body.items.find((i: { requester: { id: string } }) => i.requester.id === w.id);
    await post(admin, `/verifications/${skillReq.id}/review`, { decision: 'APPROVED' });

    const after = (await request(app).get('/api/v1/workers/me').set(auth(w.token))).body.profile;
    expect(after.education.find((x: { level: string }) => x.level === 'DIPLOMA').source).toBe('VERIFIED');
    expect(after.education.find((x: { level: string }) => x.level === 'BACHELOR').source).toBe('SELF_REPORTED'); // untouched
    expect(after.skills.find((s: { name: string }) => s.name === 'Engine Repair').source).toBe('VERIFIED');
    expect(after.skills.find((s: { name: string }) => s.name === 'Brake Systems').source).toBe('SELF_REPORTED');
    expect((await req(w, { kind: 'QUALIFICATION', targetType: 'EDUCATION', targetId: dipId })).status).toBe(409); // already verified
  });

  it('lets a worker withdraw a pending request, and a rejection leaves the item self-reported', async () => {
    const w = await signUp('WORKER');
    await request(app).post('/api/v1/workers/me/certifications').set(auth(w.token)).send({ name: 'Welding level 2' });
    const certId = (await request(app).get('/api/v1/workers/me').set(auth(w.token))).body.profile.certifications[0].id;
    const r = await request(app).post('/api/v1/workers/me/verification').set(auth(w.token)).field('kind', 'QUALIFICATION').field('targetType', 'CERTIFICATION').field('targetId', certId).attach('file', PDF, 'c.pdf');
    expect((await request(app).delete(`/api/v1/workers/me/verifications/${r.body.id}`).set(auth(w.token))).status).toBe(204);
    expect(await prisma.verificationRequest.count({ where: { id: r.body.id } })).toBe(0);

    const r2 = await request(app).post('/api/v1/workers/me/verification').set(auth(w.token)).field('kind', 'QUALIFICATION').field('targetType', 'CERTIFICATION').field('targetId', certId).attach('file', PDF, 'c.pdf');
    await post(admin, `/verifications/${r2.body.id}/review`, { decision: 'REJECTED', note: 'Name does not match' });
    expect((await request(app).get('/api/v1/workers/me').set(auth(w.token))).body.profile.certifications[0].source).toBe('SELF_REPORTED');
    expect((await request(app).get('/api/v1/workers/me/verifications').set(auth(w.token))).body.items[0]).toMatchObject({ status: 'REJECTED', note: 'Name does not match' });
  });
});

describe('moderation', () => {
  const report = (u: User, body: unknown) => request(app).post('/api/v1/reports').set(auth(u.token)).send(body as object);

  it('lets signed-in users report jobs and people, with sensible limits', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const { id: jobId } = await liveJob(e);
    expect((await request(app).post('/api/v1/reports').send({ targetType: 'JOB', targetId: jobId, reason: 'SCAM' })).status).toBe(401);
    expect((await report(e, { targetType: 'JOB', targetId: jobId, reason: 'SCAM' })).status).toBe(400); // own job
    expect((await report(w, { targetType: 'USER', targetId: w.id, reason: 'OTHER' })).status).toBe(400); // yourself
    expect((await report(w, { targetType: 'JOB', targetId: jobId, reason: 'BANANAS' })).status).toBe(400);
    expect((await report(w, { targetType: 'JOB', targetId: '00000000-0000-4000-8000-000000000000', reason: 'SCAM' })).status).toBe(404);
    expect((await report(w, { targetType: 'JOB', targetId: jobId, reason: 'SCAM', details: 'x'.repeat(1001) })).status).toBe(400);
    expect((await report(w, { targetType: 'JOB', targetId: jobId, reason: 'SCAM', extra: 1 })).status).toBe(400);
    expect((await report(w, { targetType: 'JOB', targetId: jobId, reason: 'SCAM', details: 'Asks for a deposit' })).status).toBe(201);
    expect((await report(w, { targetType: 'JOB', targetId: jobId, reason: 'FALSE_INFO' })).status).toBe(409); // one open report per target
  });

  it('removes a reported job, closes every report about it, and tells the poster', async () => {
    const e = await signUp('EMPLOYER');
    const { id: jobId } = await liveJob(e);
    const a = await signUp('WORKER');
    const b = await signUp('WORKER');
    await report(a, { targetType: 'JOB', targetId: jobId, reason: 'SCAM' });
    await report(b, { targetType: 'JOB', targetId: jobId, reason: 'FALSE_INFO' });

    const open = (await get(admin, '/moderation/reports')).body.items.filter((r: { targetId: string }) => r.targetId === jobId);
    expect(open).toHaveLength(2);
    expect(open[0]).toMatchObject({ targetType: 'JOB', openReportsOnTarget: 2 });
    expect(open[0].target.label).toContain('unverified');
    expect(JSON.stringify(open)).not.toContain(a.phone); // reporters stay anonymous to nobody but admins, and never expose phones

    expect((await post(admin, `/moderation/reports/${open[0].id}/resolve`, { action: 'REMOVE_JOB' })).status).toBe(400); // note required
    expect((await post(admin, `/moderation/reports/${open[0].id}/resolve`, { action: 'SUSPEND_USER', note: 'x' })).status).toBe(400); // wrong target type
    expect((await post(admin, `/moderation/reports/${open[0].id}/resolve`, { action: 'REMOVE_JOB', note: 'Asked workers for money' })).status).toBe(200);

    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('REMOVED');
    expect((await request(app).get(`/api/v1/jobs/${jobId}`)).status).toBe(404);
    expect(await prisma.report.count({ where: { targetId: jobId, status: 'RESOLVED' } })).toBe(2);
    const n = (await request(app).get('/api/v1/notifications').set(auth(e.token))).body.items.find((x: { type: string }) => x.type === 'job.reviewed');
    expect(n.payload).toMatchObject({ decision: 'REMOVED', note: 'Asked workers for money' });
    expect((await post(admin, `/moderation/reports/${open[0].id}/resolve`, { action: 'DISMISS' })).status).toBe(409); // already handled
  });

  it('suspends a reported user, or dismisses a report without action', async () => {
    const bad = await signUp('EMPLOYER');
    const ok = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    await report(w, { targetType: 'USER', targetId: bad.id, reason: 'SCAM' });
    await report(w, { targetType: 'USER', targetId: ok.id, reason: 'OTHER' });
    const reports = (await get(admin, '/moderation/reports')).body.items;
    const rBad = reports.find((r: { targetId: string }) => r.targetId === bad.id);
    const rOk = reports.find((r: { targetId: string }) => r.targetId === ok.id);
    expect((await post(admin, `/moderation/reports/${rBad.id}/resolve`, { action: 'SUSPEND_USER', note: 'Fraud' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe('SUSPENDED');
    expect((await post(admin, `/moderation/reports/${rOk.id}/resolve`, { action: 'DISMISS' })).body.status).toBe('DISMISSED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ok.id } })).status).toBe('ACTIVE');
  });

  it('holds suspicious jobs for review and lets an administrator approve or reject them', async () => {
    env.reviewUnverifiedJobs = true;
    const e = await signUp('EMPLOYER');
    const worker = await skilledWorker();
    const a = await liveJob(e);
    expect(a.status).toBe('PENDING_REVIEW');
    const b = await liveJob(e);

    const queue = (await get(admin, '/moderation/jobs')).body.items;
    expect(queue.find((j: { id: string }) => j.id === a.id)).toMatchObject({ reason: 'Unverified organization', organizationVerified: false });
    expect((await get(admin, '/stats')).body.stats.suspiciousAds).toBeGreaterThanOrEqual(2);

    expect((await post(admin, `/moderation/jobs/${b.id}/review`, { decision: 'REJECT' })).status).toBe(400); // reason required
    expect((await post(admin, `/moderation/jobs/${b.id}/review`, { decision: 'REJECT', note: 'Unclear duties' })).status).toBe(200);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('REMOVED');

    expect((await post(admin, `/moderation/jobs/${a.id}/review`, { decision: 'APPROVE' })).status).toBe(200);
    expect((await request(app).get(`/api/v1/jobs/${a.id}`)).status).toBe(200); // public now
    expect((await post(admin, `/moderation/jobs/${a.id}/review`, { decision: 'APPROVE' })).status).toBe(409); // no longer pending
    expect(await prisma.notification.count({ where: { userId: worker.id, type: 'job.recommended' } })).toBe(1); // alerts go out on approval
    const types = (await request(app).get('/api/v1/notifications').set(auth(e.token))).body.items.map((n: { type: string; payload: { decision: string } }) => `${n.type}:${n.payload.decision}`);
    expect(types).toEqual(expect.arrayContaining(['job.reviewed:APPROVED', 'job.reviewed:REJECTED']));
  });

  it('lets an administrator remove any job directly', async () => {
    const e = await signUp('EMPLOYER');
    const { id } = await liveJob(e);
    expect((await post(admin, `/moderation/jobs/${id}/remove`, { note: 'ab' })).status).toBe(400);
    expect((await post(admin, `/moderation/jobs/${id}/remove`, { note: 'Violates the terms' })).status).toBe(204);
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe('REMOVED');
  });
});

describe('taxonomy, translations and exports', () => {
  it('manages categories and skills and keeps public lists in sync', async () => {
    const name = `ZQ Test ${tag().slice(2, 8)}`;
    const cat = await post(admin, '/categories', { nameEn: name, nameAm: 'ምድብ' });
    expect(cat.status).toBe(201);
    expect((await post(admin, '/categories', { nameEn: name.toLowerCase() })).status).toBe(409);
    expect((await request(app).get('/api/v1/categories')).body.items.some((c: { id: string }) => c.id === cat.body.id)).toBe(true);

    const sk = await post(admin, '/skills', { nameEn: `${name} Skill`, categoryId: cat.body.id, aliases: ['ZQ Alias ', 'zq alias', 'ab'.repeat(3)] });
    expect(sk.status).toBe(201);
    const listed = (await get(admin, `/skills?q=${encodeURIComponent(name)}`)).body.items[0];
    expect(listed.aliases.sort()).toEqual(['abababab'.slice(0, 6), 'zq alias'].sort()); // lower-cased and de-duplicated
    expect((await post(admin, '/skills', { nameEn: `${name} Skill`, categoryId: cat.body.id })).status).toBe(409);
    expect((await post(admin, '/skills', { nameEn: 'Whatever', categoryId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await request(app).get(`/api/v1/skills?q=${encodeURIComponent(name)}`)).body.items).toHaveLength(1);

    expect((await patch(admin, `/skills/${sk.body.id}`, { isActive: false })).status).toBe(204);
    expect((await request(app).get(`/api/v1/skills?q=${encodeURIComponent(name)}`)).body.items).toHaveLength(0); // hidden from workers and employers
    expect((await get(admin, `/skills?q=${encodeURIComponent(name)}`)).body.items[0].isActive).toBe(false); // still visible to admins
    expect((await patch(admin, `/categories/${cat.body.id}`, { isActive: false, nameOm: 'Kutaa' })).status).toBe(204);
    expect((await request(app).get('/api/v1/categories')).body.items.some((c: { id: string }) => c.id === cat.body.id)).toBe(false);
    expect((await patch(admin, `/skills/${sk.body.id}`, { slug: 'hacked' })).status).toBe(400);
  });

  it('serves translation overrides publicly and validates keys', async () => {
    const key = `zqtest.hello_${tag().slice(2, 6)}`;
    expect((await request(app).put('/api/v1/admin/translations').set(auth(admin.token)).send({ key: 'bad key!', locale: 'am', value: 'x' })).status).toBe(400);
    expect((await request(app).put('/api/v1/admin/translations').set(auth(admin.token)).send({ key, locale: 'fr', value: 'x' })).status).toBe(400);
    expect((await request(app).put('/api/v1/admin/translations').set(auth(admin.token)).send({ key, locale: 'am', value: 'ሰላም' })).status).toBe(200);
    expect((await request(app).get('/api/v1/translations/am')).body[key]).toBe('ሰላም');
    expect((await request(app).get('/api/v1/translations/om')).body[key]).toBeUndefined();
    expect((await request(app).get('/api/v1/translations/fr')).status).toBe(404);
    await request(app).put('/api/v1/admin/translations').set(auth(admin.token)).send({ key, locale: 'am', value: 'ሰላም ዓለም' }); // update replaces
    expect((await request(app).get('/api/v1/translations/am')).body[key]).toBe('ሰላም ዓለም');
    expect((await request(app).delete(`/api/v1/admin/translations/am/${key}`).set(auth(admin.token))).status).toBe(204);
    expect((await request(app).get('/api/v1/translations/am')).body[key]).toBeUndefined();
    expect((await request(app).delete(`/api/v1/admin/translations/am/${key}`).set(auth(admin.token))).status).toBe(404);
  });

  it('exports CSV safely, hiding small numbers', async () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');

    const summary = await get(admin, '/export/platform-summary');
    expect(summary.headers['content-type']).toContain('text/csv');
    expect(summary.headers['content-disposition']).toContain('attachment');
    expect(summary.text.startsWith('﻿metric,value')).toBe(true);
    expect(summary.text).toContain('users,');

    const e = await signUp('EMPLOYER');
    await liveJob(e);
    const regions = (await get(admin, '/export/jobs-by-region')).text;
    expect(regions).toContain('<5'); // one job in Oromia is below the threshold of 5
    expect(regions).not.toMatch(/Oromia,1,/);
    expect((await get(admin, '/export/anything-else')).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'admin.export', actorId: admin.id } })).toBeGreaterThanOrEqual(2);
  });
});

/** Start from an empty marketplace so counts depend only on what the test itself creates (test database only). */
async function resetMarket() {
  await prisma.job.updateMany({ data: { status: 'REMOVED' } });
  await prisma.workerProfile.updateMany({ data: { isVisible: false } });
  await prisma.recommendation.deleteMany({}); // cascades the feedback rows
}

describe('analytics', () => {
  beforeEach(resetMarket);

  it('hides national numbers that are too small to be anonymous', async () => {
    const e = await signUp('EMPLOYER');
    for (let i = 0; i < 4; i++) await liveJob(e);
    let n = (await get(admin, '/analytics/national')).body;
    expect(n.k).toBe(5);
    let oromia = n.regions.find((r: { region: string }) => r.region === 'Oromia');
    expect(oromia.openJobs).toBeNull();
    expect(oromia.vacancies).toBeNull();
    const pub1 = (await request(app).get('/api/v1/public/stats')).body;
    expect(pub1.activeJobs).toBeNull();

    await liveJob(e);
    n = (await get(admin, '/analytics/national')).body;
    oromia = n.regions.find((r: { region: string }) => r.region === 'Oromia');
    expect(oromia.openJobs).toBe(5);
    expect(oromia.vacancies).toBe(5);
    expect(n.mostRequiredSkills[0].openJobs).toBe(5);
    expect(n.categories.find((c: { category: string }) => c.category === 'Automotive and Mechanics').openJobs).toBe(5);
    expect((await request(app).get('/api/v1/public/stats')).body.activeJobs).toBe(5);
    expect(n.popularOccupations).toEqual([]); // fewer than 5 workers share any occupation
    expect(JSON.stringify(n)).not.toMatch(/\+251/); // no phone numbers anywhere
  });

  it('shows workers their own numbers and the skills open jobs ask for', async () => {
    const e = await signUp('EMPLOYER');
    await liveJob(e);
    await liveJob(e);
    const w = await skilledWorker(['engine-repair']); // lacks brake systems, which both jobs require
    const { id: jobId } = await liveJob(e, { title: `Third ${tag()}` });
    await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    const a = (await request(app).get('/api/v1/analytics/worker').set(auth(w.token))).body;
    expect(a.applications).toMatchObject({ total: 1, interviewInvitations: 0, successful: 0, successRate: null });
    expect(a.mostRequestedSkills[0]).toMatchObject({ name: expect.stringMatching(/Engine Repair|Brake Systems/), openJobs: expect.any(Number) });
    expect(a.mostRequestedSkills.find((s: { name: string }) => s.name === 'Engine Repair').youHaveIt).toBe(true);
    const gap = a.recommendedSkills.find((s: { name: string }) => s.name === 'Brake Systems');
    expect(gap).toMatchObject({ requiredInOpenJobs: 3, closeToYourSkills: true }); // related to Engine Repair in the taxonomy
    expect(a.recommendedSkills.find((s: { name: string }) => s.name === 'Engine Repair')).toBeUndefined(); // already has it
    expect(a.note).toContain('do not guarantee');
    expect((await request(app).get('/api/v1/analytics/worker').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/analytics/worker')).status).toBe(401);
  });

  it('shows employers their funnel, match quality and time to hire', async () => {
    const e = await signUp('EMPLOYER');
    const { id: jobId } = await liveJob(e);
    const [w1, w2, w3] = [await skilledWorker(), await skilledWorker(['engine-repair']), await skilledWorker(['welding'])];
    const ids: string[] = [];
    for (const w of [w1, w2, w3]) ids.push((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).body.applicationId);
    const st = (id: string, status: string) => request(app).patch(`/api/v1/applications/${id}/status`).set(auth(e.token)).send({ status });
    await st(ids[0], 'SHORTLISTED');
    await request(app).post(`/api/v1/applications/${ids[0]}/interviews`).set(auth(e.token)).send({ scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), mode: 'PHONE' });
    await st(ids[0], 'ACCEPTED');
    await st(ids[1], 'REJECTED');

    const a = (await request(app).get('/api/v1/analytics/employer').set(auth(e.token))).body;
    expect(a.applications.total).toBe(3);
    expect(a.funnel).toEqual({ applied: 3, reviewed: 0, shortlisted: 1, interviewed: 1, hired: 1 });
    expect(a.hiring.hires).toBe(1);
    expect(a.hiring.averageDaysFromApplicationToHire).toBeGreaterThanOrEqual(0);
    expect(a.hiring.averageDaysFromPostingToFirstHire).toBeGreaterThanOrEqual(0);
    expect(a.candidateMatchQuality.scored).toBe(3);
    expect(a.candidateMatchQuality.averageScore).toBeGreaterThan(0);
    expect(a.jobs.openVacancies).toBe(1);
    expect(a.perJob[0]).toMatchObject({ jobId, applications: 3, shortlisted: 1, accepted: 1 });
    expect((await request(app).get('/api/v1/analytics/employer').set(auth(w1.token))).status).toBe(403);
  });
});

describe('recommendation performance', () => {
  beforeEach(resetMarket);

  it('credits recommendations with what happened next, once each, and warns about reading too much into it', async () => {
    const e = await signUp('EMPLOYER');
    const { id: jobId } = await liveJob(e);
    const w = await skilledWorker();
    // the employer opens "recommended workers" (this logs the recommendation), then the worker applies and is hired
    const rec = await request(app).get(`/api/v1/jobs/${jobId}/recommended-workers`).set(auth(e.token));
    expect(rec.body.items).toHaveLength(1);
    const appId = (await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).body.applicationId;
    await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status: 'SHORTLISTED' });
    await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status: 'ACCEPTED' });

    const rows = await prisma.recommendationFeedback.findMany({ where: { recommendation: { jobId } } });
    expect(rows.map((r) => r.action).sort()).toEqual(['APPLIED', 'HIRED', 'SHORTLISTED']);

    const p = (await get(admin, '/analytics/recommendations')).body;
    expect(p.feedbackTotals).toMatchObject({ APPLIED: expect.any(Number), SHORTLISTED: expect.any(Number), HIRED: expect.any(Number) });
    const engine = p.byEngine.find((x: { direction: string }) => x.direction === 'JOB_TO_WORKER');
    expect(engine.recommendations).toBeGreaterThanOrEqual(1);
    expect(engine.hiredPct).toBeNull(); // fewer than 5 recommendations: percentages are hidden
    expect(p.byScoreBand).toHaveLength(4);
    expect(p.caveats.join(' ')).toContain('observational');
  });
});
