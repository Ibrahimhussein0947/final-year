import { randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 6)}`;
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string; phone: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', orgType = 'SME'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Hire ${tag()}`, organizationType: orgType } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}
const verify = async (e: User) => {
  const ep = await prisma.employerProfile.findFirstOrThrow({ where: { userId: e.id } });
  await prisma.organization.update({ where: { id: ep.organizationId }, data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() } });
};

let categoryId = '';
let skillId = '';
let zoneId = '';
const adminId = { value: '' };
const adminToken = () => jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: adminId.value, expiresIn: '10m' });

/** COOPERATIVE has no rules by default; the administrator test edits it. Reset it directly so an interrupted earlier run cannot leave it changed. */
const resetCooperative = () => prisma.hiringPolicy.upsert({
  where: { organizationType: 'COOPERATIVE' },
  update: { label: null, minAnnouncementDays: 0, requireVerified: false, requireDeadline: false, requireSalary: false, requireReference: false, requireDecisionNote: false, requireInterview: false, requiredSteps: [], suggestedSteps: ['ID_VERIFIED', 'REFERENCE_CHECKED'], panelSize: 1, maxProbationDays: 45, appealDays: 0 },
  create: { organizationType: 'COOPERATIVE' },
});

beforeAll(async () => {
  await resetCooperative();
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'business' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'office-admin' } })).id;
  zoneId = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  adminId.value = (await prisma.user.create({ data: { phone: `+251${p.slice(1)}`, passwordHash: 'x', fullName: 'Hiring Admin', role: 'ADMIN' } })).id;
});

afterAll(async () => {
  await resetCooperative();
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

const body = (extra: Record<string, unknown> = {}) => ({
  title: `Office officer ${tag()}`, description: `We need an office administrator for our team. ${randomUUID()} ${randomUUID()} Apply with references.`,
  categoryId, employmentType: 'FULL_TIME', locationId: zoneId, skills: [{ skillId, importance: 'REQUIRED' }], deadline: day(30), ...extra,
});
const create = (e: User, extra: Record<string, unknown> = {}) => request(app).post('/api/v1/jobs').set(auth(e.token)).send(body(extra));
const publish = (e: User, id: string) => request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({});
const compliant = { referenceNumber: '', salaryMin: 8000, salaryMax: 12000 };
let seq = 0;
const ref = () => `T-${Date.now().toString(36)}-${seq++}`;

describe('organization types and the rules that come with them', () => {
  it('accepts the new organization types and rejects unknown ones', async () => {
    for (const t of ['GOVERNMENT', 'PUBLIC_ENTERPRISE', 'COOPERATIVE', 'NGO', 'PRIVATE_COMPANY']) await signUp('EMPLOYER', t);
    const r = await request(app).post('/api/v1/auth/register').send({ fullName: 'X Y', phone: '0911999999', password: 'Passw0rdTest', role: 'EMPLOYER', region: 'Oromia', zone: 'Adama', language: 'en', organizationName: 'TEST_ORG Bad', organizationType: 'MAFIA' });
    expect(r.status).toBe(400);
  });

  it('tells an employer which rules apply to their organization type', async () => {
    const gov = await signUp('EMPLOYER', 'GOVERNMENT');
    const priv = await signUp('EMPLOYER', 'PRIVATE_COMPANY');
    const g = await request(app).get('/api/v1/employers/me/hiring-rules').set(auth(gov.token));
    expect(g.body.organizationType).toBe('GOVERNMENT');
    expect(g.body.rules).toMatchObject({ label: 'Government vacancy', minAnnouncementDays: 10, requireVerified: true, requireDeadline: true, requireSalary: true, requireReference: true, requireDecisionNote: true, requireInterview: true });
    const p = await request(app).get('/api/v1/employers/me/hiring-rules').set(auth(priv.token));
    expect(p.body.rules).toMatchObject({ minAnnouncementDays: 0, requireVerified: false, requireReference: false, requireDecisionNote: false, requireInterview: false });
    const w = await signUp('WORKER');
    expect((await request(app).get('/api/v1/employers/me/hiring-rules').set(auth(w.token))).status).toBe(403);
  });
});

describe('publishing a vacancy', () => {
  it('a private company publishes with no extra rules', async () => {
    const e = await signUp('EMPLOYER', 'PRIVATE_COMPANY');
    const j = await create(e, { deadline: day(2) });
    expect(j.status).toBe(201);
    expect((await publish(e, j.body.job.id)).status).toBe(200);
  });

  it('a government office must be verified, state pay, give a reference number and keep the vacancy open long enough', async () => {
    const e = await signUp('EMPLOYER', 'GOVERNMENT');
    const j = await create(e, { deadline: day(3) });
    expect(j.status).toBe(201);
    const first = await publish(e, j.body.job.id);
    expect(first.status).toBe(400);
    const d = first.body.error.details;
    expect(d.organization[0]).toContain('must be verified');
    expect(d.deadline[0]).toContain('at least 10 days');
    expect(d.salaryMin[0]).toContain('salary');
    expect(d.referenceNumber[0]).toContain('reference number');

    await verify(e);
    const fixed = await request(app).patch(`/api/v1/jobs/${j.body.job.id}`).set(auth(e.token)).send({ deadline: day(15), salaryMin: 9000, salaryMax: 14000, referenceNumber: ref() });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect((await publish(e, j.body.job.id)).status).toBe(200);

    const page = await request(app).get(`/api/v1/jobs/${j.body.job.id}`);
    expect(page.body.job.vacancyLabel).toBe('Government vacancy');
    expect(page.body.job.referenceNumber).toMatch(/^T-/);
  });

  it('a government office with no closing date at all is told so', async () => {
    const e = await signUp('EMPLOYER', 'GOVERNMENT');
    await verify(e);
    const j = await create(e, { deadline: null, salaryMin: 1, referenceNumber: ref() });
    const r = await publish(e, j.body.job.id);
    expect(r.status).toBe(400);
    expect(r.body.error.details.deadline[0]).toContain('closing date is required');
  });

  it('a public enterprise has its own, shorter announcement period', async () => {
    const e = await signUp('EMPLOYER', 'PUBLIC_ENTERPRISE');
    await verify(e);
    const early = await create(e, { deadline: day(5), salaryMin: 7000, referenceNumber: ref() });
    expect((await publish(e, early.body.job.id)).body.error.details.deadline[0]).toContain('at least 7 days');
    const ok = await create(e, { deadline: day(8), salaryMin: 7000, referenceNumber: ref() });
    expect((await publish(e, ok.body.job.id)).status).toBe(200);
    expect((await request(app).get(`/api/v1/jobs/${ok.body.job.id}`)).body.job.vacancyLabel).toBe('Public enterprise vacancy');
  });

  it('an NGO must be verified and set a closing date, but is not forced to state pay', async () => {
    const e = await signUp('EMPLOYER', 'NGO');
    const j = await create(e, { deadline: day(10) });
    expect((await publish(e, j.body.job.id)).body.error.details.organization).toBeTruthy();
    await verify(e);
    expect((await publish(e, j.body.job.id)).status).toBe(200);
  });

  it('a reference number identifies one vacancy within the organization', async () => {
    const e = await signUp('EMPLOYER', 'SME');
    const r = ref();
    expect((await create(e, { referenceNumber: r })).status).toBe(201);
    const dup = await create(e, { referenceNumber: r });
    expect(dup.status).toBe(409);
    const other = await signUp('EMPLOYER', 'SME');
    expect((await create(other, { referenceNumber: r })).status).toBe(201); // another organization may reuse it
    expect((await create(e, { referenceNumber: 'bad/<script>' })).status).toBe(400);
  });

  it('a live government vacancy keeps obeying the rules when it is edited', async () => {
    const e = await signUp('EMPLOYER', 'GOVERNMENT');
    await verify(e);
    const j = await create(e, { deadline: day(15), salaryMin: 9000, referenceNumber: ref() });
    expect((await publish(e, j.body.job.id)).status).toBe(200);
    const edit = (data: Record<string, unknown>) => request(app).patch(`/api/v1/jobs/${j.body.job.id}`).set(auth(e.token)).send(data);
    expect((await edit({ deadline: day(4) })).status).toBe(400); // pulling the closing date forward
    expect((await edit({ salaryMin: null })).status).toBe(400); // hiding the pay
    expect((await edit({ referenceNumber: null })).status).toBe(400);
    expect((await edit({ benefits: 'Medical cover and pension.' })).status).toBe(200);
    expect((await edit({ deadline: day(40) })).status).toBe(200); // extending is fine
  });
});

describe('deciding on candidates', () => {
  async function setup(orgType: string, over: Record<string, unknown> = {}) {
    const e = await signUp('EMPLOYER', orgType);
    await verify(e);
    const j = await create(e, { deadline: day(30), salaryMin: 8000, referenceNumber: ref(), ...over });
    expect((await publish(e, j.body.job.id)).status).toBe(200);
    const w = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId, headline: 'Office administrator', yearsExperience: 4, availability: 'IMMEDIATELY', locationId: zoneId });
    await request(app).put(`/api/v1/workers/me/skills/${skillId}`).set(auth(w.token)).send({ proficiency: 4 });
    const applied = await request(app).post(`/api/v1/jobs/${j.body.job.id}/apply`).set(auth(w.token)).send({});
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    return { e, w, jobId: j.body.job.id as string, appId: applied.body.applicationId as string };
  }
  const status = (e: User, id: string, to: string, note?: string) => request(app).patch(`/api/v1/applications/${id}/status`).set(auth(e.token)).send({ status: to, ...(note !== undefined ? { note } : {}) });

  it('a private company can accept without a note, an interview or waiting', async () => {
    const { e, appId } = await setup('PRIVATE_COMPANY');
    expect((await status(e, appId, 'SHORTLISTED')).status).toBe(200);
    expect((await status(e, appId, 'ACCEPTED')).status).toBe(200);
  });

  it('a government office needs a written reason, a closed announcement and a recorded interview before hiring', async () => {
    const { e, jobId, appId } = await setup('GOVERNMENT');
    expect((await status(e, appId, 'SHORTLISTED')).status).toBe(200);

    // 1. a written reason
    const noNote = await status(e, appId, 'ACCEPTED');
    expect(noNote.status).toBe(400);
    expect(noNote.body.error.details.note[0]).toContain('written reason');
    expect((await status(e, appId, 'ACCEPTED', 'too short')).status).toBe(400);

    // 2. the announcement is still open
    const open = await status(e, appId, 'ACCEPTED', 'Best score in the written assessment and interview.');
    expect(open.status).toBe(409);
    expect(open.body.error.code).toBe('ANNOUNCEMENT_OPEN');

    // the closing date passes
    await prisma.job.update({ where: { id: jobId }, data: { deadline: new Date(Date.now() - 86_400_000) } });

    // 3. no interview yet
    const noInterview = await status(e, appId, 'ACCEPTED', 'Best score in the written assessment and interview.');
    expect(noInterview.status).toBe(409);
    expect(noInterview.body.error.code).toBe('INTERVIEW_REQUIRED');

    const iv = await request(app).post(`/api/v1/applications/${appId}/interviews`).set(auth(e.token)).send({ scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), mode: 'IN_PERSON', locationOrLink: 'Head office, room 4' });
    expect(iv.status, JSON.stringify(iv.body)).toBe(201);

    // 4. the recruitment methods of a government office: ID checked, written exam, a panel of three (see hiring-methods.test.ts)
    const steps = await status(e, appId, 'ACCEPTED', 'Best score in the written assessment and interview.');
    expect(steps.status).toBe(409);
    expect(steps.body.error.code).toBe('STEPS_REQUIRED');
    const worker = await prisma.application.findUniqueOrThrow({ where: { id: appId }, select: { workerId: true, worker: { select: { userId: true } } } });
    await prisma.verificationRequest.create({ data: { userId: worker.worker.userId, kind: 'IDENTITY', targetType: 'NATIONAL_ID', targetId: worker.workerId, status: 'APPROVED' } });
    await prisma.hiringStep.createMany({ data: [
      { applicationId: appId, kind: 'WRITTEN_EXAM', data: { score: 78, examDate: day(-5) }, recordedById: e.id },
      ...['Abebe Kebede', 'Almaz Tesfaye', 'Dawit Hailu'].map((panelist) => ({ applicationId: appId, kind: 'SCORE_SHEET' as const, data: { panelist, scores: { skills: 4, experience: 4, communication: 4, suitability: 4 } }, recordedById: e.id })),
    ] });

    const done = await status(e, appId, 'ACCEPTED', 'Best score in the written assessment and interview.');
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const history = await prisma.applicationStatusHistory.findMany({ where: { applicationId: appId, toStatus: 'ACCEPTED' } });
    expect(history[0].note).toContain('Best score'); // the reason is kept with the decision
  });

  it('rejecting also needs a written reason in a government office, so the decision can be explained', async () => {
    const { e, appId } = await setup('GOVERNMENT');
    expect((await status(e, appId, 'REJECTED')).status).toBe(400);
    expect((await status(e, appId, 'REJECTED', 'Does not meet the minimum qualification in the announcement.')).status).toBe(200);
  });

  it('an NGO needs a written reason and an interview, and waits for its own announcement period to close', async () => {
    const { e, jobId, appId } = await setup('NGO');
    await status(e, appId, 'SHORTLISTED');
    expect((await status(e, appId, 'ACCEPTED')).body.error.details.note).toBeTruthy();
    expect((await status(e, appId, 'ACCEPTED', 'Selected by the panel after interviews.')).body.error.code).toBe('ANNOUNCEMENT_OPEN');
    await prisma.job.update({ where: { id: jobId }, data: { deadline: new Date(Date.now() - 3_600_000) } });
    expect((await status(e, appId, 'ACCEPTED', 'Selected by the panel after interviews.')).body.error.code).toBe('INTERVIEW_REQUIRED');
  });

  it('shows the rules to the screens that need them', async () => {
    const { e, jobId, appId } = await setup('GOVERNMENT');
    const list = await request(app).get(`/api/v1/jobs/${jobId}/applications`).set(auth(e.token));
    expect(list.body.rules).toMatchObject({ label: 'Government vacancy', requireDecisionNote: true, requireInterview: true });
    expect(list.body.rules.announcementClosesAt).not.toBeNull();
    const cand = await request(app).get(`/api/v1/applications/${appId}`).set(auth(e.token));
    expect(cand.body.rules).toMatchObject({ requireDecisionNote: true, requireInterview: true });
    expect(list.body.job.organization).toBeUndefined(); // the extra join is not leaked into the response
  });
});

describe('administrators set the rules per organization type', () => {
  it('lists every type with how many organizations use it, and applies edits at once, then restores them', async () => {
    const admin = adminToken();
    const list = await request(app).get('/api/v1/admin/hiring-policies').set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(14);
    expect(list.body.items.find((i: any) => i.organizationType === 'GOVERNMENT')).toMatchObject({ minAnnouncementDays: 10, requireReference: true });

    const original = { label: null, minAnnouncementDays: 0, requireReference: false };
    const patch = (data: Record<string, unknown>) => request(app).patch('/api/v1/admin/hiring-policies/COOPERATIVE').set(auth(admin)).send(data);
    try {
      expect((await patch({ requireReference: true, minAnnouncementDays: 3, label: 'Cooperative vacancy' })).status).toBe(204);
      const e = await signUp('EMPLOYER', 'COOPERATIVE');
      const j = await create(e, { deadline: day(1) });
      const blocked = await publish(e, j.body.job.id);
      expect(blocked.status).toBe(400);
      expect(blocked.body.error.details.referenceNumber).toBeTruthy();
      expect(blocked.body.error.details.deadline[0]).toContain('at least 3 days');
      await request(app).patch(`/api/v1/jobs/${j.body.job.id}`).set(auth(e.token)).send({ deadline: day(5), referenceNumber: ref() });
      expect((await publish(e, j.body.job.id)).status).toBe(200);
      expect((await request(app).get(`/api/v1/jobs/${j.body.job.id}`)).body.job.vacancyLabel).toBe('Cooperative vacancy');
    } finally {
      await patch({ label: original.label, minAnnouncementDays: original.minAnnouncementDays, requireReference: original.requireReference });
    }
    const after = await request(app).get('/api/v1/admin/hiring-policies').set(auth(admin));
    expect(after.body.items.find((i: any) => i.organizationType === 'COOPERATIVE')).toMatchObject({ requireReference: false, minAnnouncementDays: 0, label: null });
  });

  it('is for administrators only and validates input', async () => {
    const e = await signUp('EMPLOYER');
    expect((await request(app).get('/api/v1/admin/hiring-policies').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/hiring-policies')).status).toBe(401);
    const admin = adminToken();
    const patch = (type: string, data: Record<string, unknown>) => request(app).patch(`/api/v1/admin/hiring-policies/${type}`).set(auth(admin)).send(data);
    expect((await patch('NOT_A_TYPE', { requireDeadline: true })).status).toBe(404);
    expect((await patch('COOPERATIVE', { minAnnouncementDays: 500 })).status).toBe(400);
    expect((await patch('COOPERATIVE', { minAnnouncementDays: -1 })).status).toBe(400);
    expect((await patch('COOPERATIVE', { organizationType: 'GOVERNMENT' })).status).toBe(400);
    expect((await patch('COOPERATIVE', { requireDeadline: 'yes' })).status).toBe(400);
  });
});

describe('the organization type cannot be switched to escape the rules', () => {
  it('can be changed freely before verification or publishing, then only by an administrator', async () => {
    const e = await signUp('EMPLOYER', 'PRIVATE_COMPANY');
    const patch = (type: string) => request(app).patch('/api/v1/employers/me').set(auth(e.token)).send({ type });
    expect((await patch('GOVERNMENT')).status).toBe(200); // nothing published yet
    expect((await patch('NGO')).status).toBe(200);

    // an organization that has published a job is locked, even if it was never verified
    const s = await signUp('EMPLOYER', 'SME');
    const j = await create(s);
    expect((await publish(s, j.body.job.id)).status).toBe(200);
    const swap = await request(app).patch('/api/v1/employers/me').set(auth(s.token)).send({ type: 'GOVERNMENT' });
    expect(swap.status).toBe(409);
    expect(swap.body.error.message).toContain('Contact an administrator');
    // changing other details is still fine, and "changing" to the same type is not a change
    expect((await request(app).patch('/api/v1/employers/me').set(auth(s.token)).send({ type: 'SME', description: 'We sell office supplies.' })).status).toBe(200);

    // a verified organization is locked too
    const v = await signUp('EMPLOYER', 'GOVERNMENT');
    await verify(v);
    expect((await request(app).patch('/api/v1/employers/me').set(auth(v.token)).send({ type: 'PRIVATE_COMPANY' })).status).toBe(409);

    // an administrator can correct it, and it is recorded
    const orgId = (await prisma.employerProfile.findFirstOrThrow({ where: { userId: v.id } })).organizationId;
    const admin = adminToken();
    expect((await request(app).patch(`/api/v1/admin/organizations/${orgId}/type`).set(auth(admin)).send({ type: 'PUBLIC_ENTERPRISE' })).status).toBe(204);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).type).toBe('PUBLIC_ENTERPRISE');
    expect(await prisma.auditLog.count({ where: { action: 'admin.organization_type_changed', entityId: orgId } })).toBe(1);
    expect((await request(app).patch(`/api/v1/admin/organizations/${orgId}/type`).set(auth(v.token)).send({ type: 'SME' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/admin/organizations/${orgId}/type`).set(auth(admin)).send({ type: 'MAFIA' })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/admin/organizations/${randomUUID()}/type`).set(auth(admin)).send({ type: 'SME' })).status).toBe(404);
  });
});
