import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
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
const newPhone = () => {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
};
type User = { token: string; id: string; name: string };

const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz'[randomInt(0, 26)]).join('');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

async function person(): Promise<User & { first: string; father: string }> {
  const first = cap(letters(7)); const father = cap(letters(8));
  const name = `${first} ${father}`;
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: name, phone: newPhone(), password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, name, first, father };
}
let admin: User;
beforeAll(async () => {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: 'Test Admin Proof', phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' });
  admin = { token: login.body.accessToken, id: u.id, name: 'Test Admin Proof' };
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { OR: [{ phone: { in: phones } }, { fullName: 'Test Admin Proof' }] } });
  await prisma.organization.deleteMany({ where: { name: 'TEST_ORG Proof' } });
  await prisma.$disconnect();
});

const upload = (u: User, fields: Record<string, string>, buf: Buffer) => {
  const r = request(app).post('/api/v1/workers/me/documents').set(auth(u.token));
  for (const [k, v] of Object.entries(fields)) r.field(k, v);
  return r.attach('file', buf, 'doc.pdf');
};
const review = (id: string, decision: 'APPROVED' | 'REJECTED') =>
  request(app).post(`/api/v1/admin/verifications/${id}/review`).set(auth(admin.token)).send({ decision, note: decision === 'REJECTED' ? 'Not clear enough' : undefined });
const addJob = async (u: User, body: object) => {
  const r = await request(app).post('/api/v1/workers/me/experience').set(auth(u.token)).send(body);
  expect(r.status).toBe(201);
  return (r.body.profile.experiences as { id: string; title: string }[]).find((e) => e.title === (body as { title: string }).title)!.id;
};
const addCert = async (u: User, body: { name: string }) => {
  const r = await request(app).post('/api/v1/workers/me/certifications').set(auth(u.token)).send(body);
  expect(r.status).toBe(201);
  return (r.body.profile.certifications as { id: string; name: string }[]).find((c) => c.name === body.name)!.id;
};
const trust = async (u: User) => (await request(app).get('/api/v1/workers/me/trust').set(auth(u.token))).body.trust;

describe('an experience letter for one job', () => {
  it('is compared with the job entry, approved by an administrator, and marks only that job verified', async () => {
    const u = await person();
    const employer = `Zemen${cap(letters(6))} Garage`;
    const jobId = await addJob(u, { title: 'Mechanic', employer, startDate: '2019-02-01', endDate: '2022-06-30' });
    const otherId = await addJob(u, { title: 'Driver', employer: 'Another Place', startDate: '2022-08-01' });

    const wrong = await upload(u, { docType: 'EXPERIENCE_LETTER', experienceId: jobId }, makePdf(['TO WHOM IT MAY CONCERN', `This letter confirms that ${u.name}`, 'worked as a cook for Somebody Else PLC', 'from 2010 to 2012 and was reliable.']));
    expect(wrong.status).toBe(201);
    expect(wrong.body.check.experienceId).toBe(jobId);
    expect(wrong.body.check.outcome).toBe('MISMATCH');
    expect(wrong.body.check.fields.find((f: { field: string }) => f.field === 'Employer').status).toBe('NOT_FOUND');

    const good = await upload(u, { docType: 'EXPERIENCE_LETTER', experienceId: jobId }, makePdf(['TO WHOM IT MAY CONCERN', `This letter confirms that ${u.name}`, `worked as a Mechanic at ${employer}`, 'from February 2019 to June 2022.', 'Signed by the manager.']));
    expect(good.status).toBe(201);
    expect(good.body.check.fields.filter((f: { status: string }) => f.status !== 'FOUND'), 'not found').toEqual([]);
    expect(good.body.check.outcome).toBe('CONSISTENT');
    expect(good.body.check.fields.map((f: { field: string }) => f.field)).toEqual(expect.arrayContaining(['Your name', 'Employer', 'Job title', 'Years']));

    // the checklist has one line for each job
    const list = await request(app).get('/api/v1/documents/checklist').set(auth(u.token));
    const ids = list.body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([`EXPERIENCE_LETTER:${jobId}`, `EXPERIENCE_LETTER:${otherId}`]));
    expect(ids).not.toContain('EXPERIENCE_LETTER');

    // nothing is verified until an administrator approves
    expect((await prisma.workExperience.findUniqueOrThrow({ where: { id: jobId } })).source).toBe('SELF_REPORTED');
    const reqs = await prisma.verificationRequest.findMany({ where: { userId: u.id, targetType: 'EXPERIENCE' } });
    expect(reqs).toHaveLength(1); // the new upload replaced the one still waiting
    expect(reqs[0].targetId).toBe(jobId);
    expect((await review(reqs[0].id, 'APPROVED')).status).toBe(200);
    expect((await prisma.workExperience.findUniqueOrThrow({ where: { id: jobId } })).source).toBe('VERIFIED');
    expect((await prisma.workExperience.findUniqueOrThrow({ where: { id: otherId } })).source).toBe('SELF_REPORTED');

    // an approved job cannot be uploaded again, and editing it removes the mark
    expect((await upload(u, { docType: 'EXPERIENCE_LETTER', experienceId: jobId }, makePdf([`Mechanic at ${employer} for ${u.name}`]))).status).toBe(409);
    const edit = await request(app).put(`/api/v1/workers/me/experience/${jobId}`).set(auth(u.token)).send({ title: 'Mechanic', employer: 'Changed Garage', startDate: '2019-02-01', endDate: '2022-06-30' });
    expect(edit.status).toBe(200);
    expect((await prisma.workExperience.findUniqueOrThrow({ where: { id: jobId } })).source).toBe('SELF_REPORTED');
  });

  it("cannot be uploaded for someone else's job, or for the wrong kind of document", async () => {
    const a = await person(); const b = await person();
    const jobId = await addJob(a, { title: 'Welder', employer: 'Steel Works', startDate: '2018-01-01' });
    expect((await upload(b, { docType: 'EXPERIENCE_LETTER', experienceId: jobId }, makePdf(['letter']))).status).toBe(404);
    expect((await upload(a, { docType: 'NATIONAL_ID', experienceId: jobId }, makePdf(['id']))).status).toBe(400);
  });
});

describe('a certificate for one certification entry', () => {
  it('is compared with the entry and verifies it only after approval', async () => {
    const u = await person();
    const name = `Certificate of Competence ${cap(letters(6))} Welding`;
    const certId = await addCert(u, { name });
    expect((await upload(u, { docType: 'PROFESSIONAL_CERTIFICATE' }, makePdf(['x']))).status).toBe(400); // must say which entry

    const r = await upload(u, { docType: 'PROFESSIONAL_CERTIFICATE', certificationId: certId }, makePdf(['FEDERAL TVET AGENCY', `This is to certify that ${u.name}`, `has passed the assessment for ${name}`, 'and is hereby awarded this certificate.']));
    expect(r.status).toBe(201);
    expect(r.body.check.certificationId).toBe(certId);
    expect(r.body.check.outcome).toBe('CONSISTENT');

    const wrong = await upload(u, { docType: 'PROFESSIONAL_CERTIFICATE', certificationId: certId }, makePdf(['FEDERAL TVET AGENCY', 'This is to certify that Somebody Else', 'has passed the assessment for Plumbing Level Two', 'and is hereby awarded this certificate.']));
    expect(wrong.body.check.outcome).toBe('MISMATCH');

    const req = await prisma.verificationRequest.findFirstOrThrow({ where: { userId: u.id, targetType: 'CERTIFICATION', status: 'PENDING' } });
    expect((await review(req.id, 'APPROVED')).status).toBe(200);
    expect((await prisma.certification.findUniqueOrThrow({ where: { id: certId } })).source).toBe('VERIFIED');
  });

  it('lists a blocked line when there is no certificate entry yet', async () => {
    const u = await person();
    const list = await request(app).get('/api/v1/documents/checklist').set(auth(u.token));
    const item = list.body.items.find((i: { id: string }) => i.id === 'PROFESSIONAL_CERTIFICATE');
    expect(item.blockedBy.length).toBeGreaterThan(0);
    expect(item.required).toBe(false);
  });
});

describe('trust level', () => {
  it('starts at 0 and rises one step for each approved proof, starting with the ID', async () => {
    const u = await person();
    expect(await trust(u)).toMatchObject({ level: 0, label: 'Not verified' });
    const t0 = await trust(u);
    expect(t0.next.map((s: { key: string }) => s.key)).toEqual(expect.arrayContaining(['identity', 'photo']));

    // a verified job alone is not trust: the ID has to come first
    const jobId = await addJob(u, { title: 'Cook', employer: 'Sheraton Kitchen', startDate: '2020-01-01' });
    await prisma.workExperience.update({ where: { id: jobId }, data: { source: 'VERIFIED' } });
    expect((await trust(u)).level).toBe(0);

    const worker = await prisma.workerProfile.findFirstOrThrow({ where: { userId: u.id } });
    await prisma.verificationRequest.create({ data: { userId: u.id, kind: 'IDENTITY', targetType: 'NATIONAL_ID', targetId: worker.id, status: 'APPROVED', evidenceFileId: null } });
    expect(await trust(u)).toMatchObject({ level: 2, label: 'Verified' }); // ID + the job

    const certId = await addCert(u, { name: 'Food Safety Certificate' });
    await prisma.certification.update({ where: { id: certId }, data: { source: 'VERIFIED' } });
    expect((await trust(u)).level).toBe(3);
    const edu = await request(app).post('/api/v1/workers/me/education').set(auth(u.token)).send({ level: 'DIPLOMA', institution: 'Adama Polytechnic', year: 2018 });
    expect(edu.status).toBe(201);
    await prisma.education.updateMany({ where: { workerId: worker.id }, data: { source: 'VERIFIED' } });
    expect(await trust(u)).toMatchObject({ level: 4, label: 'Highly trusted' });
  });

  it('is shown to employers without exposing the documents', async () => {
    const u = await person();
    const worker = await prisma.workerProfile.findFirstOrThrow({ where: { userId: u.id } });
    const emp = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test Emp Proof', phone: newPhone(), password: 'Passw0rdTest', role: 'EMPLOYER', region: 'Oromia', zone: 'Adama', language: 'en', organizationName: 'TEST_ORG Proof', organizationType: 'SME' });
    expect(emp.status).toBe(201);
    const view = await request(app).get(`/api/v1/workers/${worker.id}`).set(auth(emp.body.accessToken));
    expect(view.status).toBe(200);
    expect(view.body.worker?.trust ?? view.body.profile?.trust ?? view.body.trust).toMatchObject({ level: 0, label: 'Not verified' });
    expect(JSON.stringify(view.body)).not.toContain('evidenceFileId');
  });
});
