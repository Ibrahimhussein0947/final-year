import { randomInt, randomUUID } from 'node:crypto';
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
const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz'[randomInt(0, 26)]).join('');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
type User = { token: string; id: string; name: string; org?: string };

async function signUp(role: 'WORKER' | 'EMPLOYER', opts: { type?: string } = {}): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const name = `${cap(letters(7))} ${cap(letters(8))}`;
  const org = `${cap(letters(8))} ${cap(letters(6))}`;
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: name, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG ${org}`, organizationType: opts.type ?? 'SME' } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, name, org: role === 'EMPLOYER' ? `TEST_ORG ${org}` : undefined };
}

let admin: User;
let categoryId = '';
let skillId = '';
const wasRequired = process.env.DOCUMENTS_REQUIRED;
beforeAll(async () => {
  process.env.DOCUMENTS_REQUIRED = 'true'; // these tests are about the requirement itself
  const phone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${phone.slice(1)}`);
  const u = await prisma.user.create({ data: { fullName: 'Test Admin Req', phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' });
  admin = { token: login.body.accessToken, id: u.id, name: 'Test Admin Req' };
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  skillId = (await prisma.skill.findFirstOrThrow({ where: { categoryId } })).id;
});
afterAll(async () => {
  if (wasRequired === undefined) delete process.env.DOCUMENTS_REQUIRED; else process.env.DOCUMENTS_REQUIRED = wasRequired;
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

const upload = (u: User, fields: Record<string, string>, buf: Buffer) => {
  const r = request(app).post('/api/v1/documents').set(auth(u.token));
  for (const [k, v] of Object.entries(fields)) r.field(k, v);
  return r.attach('file', buf, 'doc.pdf');
};
const checklist = async (u: User) => (await request(app).get('/api/v1/documents/checklist').set(auth(u.token))).body;
const item = (c: { items: { id: string }[] }, id: string) => c.items.find((i) => i.id === id) as unknown as { status: string; blockedBy: string[]; required: boolean; check: { outcome: string; fields: { field: string; status: string }[] } | null };
const review = (id: string, decision: 'APPROVED' | 'REJECTED') => request(app).post(`/api/v1/admin/verifications/${id}/review`).set(auth(admin.token)).send({ decision, note: decision === 'REJECTED' ? 'Not clear enough' : undefined });
const orgStatus = async (u: User) => (await prisma.organization.findFirstOrThrow({ where: { name: u.org } })).verificationStatus;
const requestOf = (u: User, targetType: string) => prisma.verificationRequest.findFirstOrThrow({ where: { userId: u.id, targetType }, orderBy: { createdAt: 'desc' } });

async function liveJob(e: User) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Mechanic ${letters(6)}`, description: `Workshop role for the documents test. ${randomUUID()} ${randomUUID()} Apply with references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: future(30), workMode: 'REMOTE', skills: [{ skillId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  return create.body.job.id as string;
}

describe('a job seeker: the checklist and the ID document', () => {
  it('lists what to upload, marks the ID document and photo as required, and blocks the ID until the date of birth is saved', async () => {
    const w = await signUp('WORKER');
    const c = await checklist(w);
    expect(c).toMatchObject({ audience: 'WORKER', required: 2, requiredDone: 0, complete: false, enforced: true });
    expect(c.items.map((i: { id: string }) => i.id)).toEqual(expect.arrayContaining(['NATIONAL_ID', 'PHOTO', 'BIRTH_CERTIFICATE', 'CV', 'EXPERIENCE_LETTER']));
    expect(item(c, 'NATIONAL_ID')).toMatchObject({ required: true, status: 'MISSING', blockedBy: ['your date of birth'] });
    const early = await upload(w, { docType: 'NATIONAL_ID' }, makePdf([`ID ${w.name}`]));
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.body)).toMatch(/date of birth/i);
  });

  it('compares the ID with the name, date of birth and ID number that were typed', async () => {
    const w = await signUp('WORKER');
    expect((await request(app).put('/api/v1/workers/me/identity').set(auth(w.token)).send({ dateOfBirth: '1995-03-12', idType: 'KEBELE_ID', idNumber: 'KB 4412/87' })).status).toBe(200);
    expect(item(await checklist(w), 'NATIONAL_ID').blockedBy).toEqual([]);
    const ok = await upload(w, { docType: 'NATIONAL_ID' }, makePdf(['KEBELE IDENTITY CARD', `Name: ${w.name}`, 'Date of birth: 12/03/1995', 'ID No: KB4412/87']));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.check.outcome).toBe('CONSISTENT');
    expect(ok.body.check.fields.map((f: { field: string }) => f.field)).toEqual(['Your name', 'Date of birth', 'ID number']);
    expect(item(await checklist(w), 'NATIONAL_ID').status).toBe('SUBMITTED');

    const wrong = await upload(w, { docType: 'NATIONAL_ID' }, makePdf(['KEBELE IDENTITY CARD', `Name: ${w.name}`, 'Date of birth: 12/03/1995', 'ID No: ZZ9988776']));
    expect(wrong.body.check.outcome).toBe('MISMATCH');
    expect(wrong.body.check.fields.find((f: { field: string }) => f.field === 'ID number').status).toBe('NOT_FOUND');
    expect(item(await checklist(w), 'NATIONAL_ID').check?.outcome).toBe('MISMATCH'); // the newest upload replaced the waiting one
  });

  it('validates the ID details', async () => {
    const w = await signUp('WORKER');
    const put = (b: object) => request(app).put('/api/v1/workers/me/identity').set(auth(w.token)).send(b);
    expect((await put({ idType: 'LIBRARY_CARD' })).status).toBe(400);
    expect((await put({ idNumber: '12' })).status).toBe(400);
    expect((await put({ idNumber: '<script>' })).status).toBe(400);
  });

  it('keeps worker documents for workers and employer documents for employers', async () => {
    const w = await signUp('WORKER');
    const e = await signUp('EMPLOYER');
    expect((await upload(w, { docType: 'BUSINESS_LICENSE' }, makePdf(['licence']))).status).toBe(400);
    expect((await upload(e, { docType: 'NATIONAL_ID' }, makePdf(['id']))).status).toBe(400);
    expect((await request(app).get('/api/v1/documents/checklist')).status).toBe(401);
  });
});

describe('applying needs the required documents', () => {
  it('is refused until the ID document and a photo have been sent, then goes through', async () => {
    const e = await signUp('EMPLOYER');
    process.env.DOCUMENTS_REQUIRED = 'false'; // the employer's own documents are not what this test is about
    const jobId = await liveJob(e);
    expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set(auth(e.token)).send({})).status).toBe(200);
    process.env.DOCUMENTS_REQUIRED = 'true';

    const w = await signUp('WORKER');
    const none = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('DOCUMENTS_REQUIRED');
    expect(none.body.error.details.missing).toEqual(['ID document', 'Profile photo']);

    await request(app).put('/api/v1/workers/me/identity').set(auth(w.token)).send({ dateOfBirth: '1995-03-12' });
    expect((await upload(w, { docType: 'NATIONAL_ID' }, makePdf([`ID card ${w.name}`, 'Date of birth 12/03/1995']))).status).toBe(201);
    const half = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    expect(half.body.error.details.missing).toEqual(['Profile photo']);

    expect((await request(app).post('/api/v1/workers/me/photo').set(auth(w.token)).attach('file', PNG, 'me.png')).status).toBe(201);
    const c = await checklist(w);
    expect(c).toMatchObject({ requiredDone: 2, complete: true });
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
  });

  it('can be switched off for a deployment that does not want it', async () => {
    process.env.DOCUMENTS_REQUIRED = 'false';
    try {
      const e = await signUp('EMPLOYER');
      const jobId = await liveJob(e);
      expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set(auth(e.token)).send({})).status).toBe(200);
      const w = await signUp('WORKER');
      expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).status).toBe(201);
      expect((await checklist(w)).enforced).toBe(false);
    } finally { process.env.DOCUMENTS_REQUIRED = 'true'; }
  });
});

describe('an employer: documents by type of organization', () => {
  it('a small business has to send a licence and the manager\'s ID; a household only an ID', async () => {
    const e = await signUp('EMPLOYER', { type: 'SME' });
    const c = await checklist(e);
    expect(c.items.filter((i: { required: boolean }) => i.required).map((i: { id: string }) => i.id).sort()).toEqual(['BUSINESS_LICENSE', 'REPRESENTATIVE_ID']);
    expect(c.organization).toMatchObject({ type: 'SME', verificationStatus: 'UNVERIFIED' });
    const home = await signUp('EMPLOYER', { type: 'HOUSEHOLD' });
    expect((await checklist(home)).items.filter((i: { required: boolean }) => i.required).map((i: { id: string }) => i.id)).toEqual(['REPRESENTATIVE_ID']);
    expect((await upload(home, { docType: 'BUSINESS_LICENSE' }, makePdf(['x']))).status).toBe(400); // not needed for a household
  });

  it('needs the licence number and end date first, compares them, and flags an expired licence', async () => {
    const e = await signUp('EMPLOYER');
    const doc = (extra: string[] = []) => makePdf(['TRADE LICENCE', e.org!, 'Licence No: AA/2231/15', `Owner: ${e.name}`, ...extra]);
    const early = await upload(e, { docType: 'BUSINESS_LICENSE' }, doc());
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.body)).toMatch(/licence number/i);

    const put = (b: object) => request(app).put('/api/v1/employers/me/legal').set(auth(e.token)).send(b);
    expect((await put({ licenseNumber: 'AA/2231/15', licenseExpiresAt: future(200) })).status).toBe(200);
    const ok = await upload(e, { docType: 'BUSINESS_LICENSE' }, doc());
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.check.outcome).toBe('CONSISTENT');
    expect(ok.body.check.fields.map((f: { field: string; status: string }) => `${f.field}:${f.status}`)).toEqual(['Organization name:FOUND', 'Licence number:FOUND', 'Not expired:FOUND', 'Owner or manager:FOUND']);

    expect((await put({ licenseExpiresAt: '2020-01-31' })).status).toBe(200);
    const expired = await upload(e, { docType: 'BUSINESS_LICENSE' }, doc());
    expect(expired.body.check.outcome).toBe('MISMATCH');
    expect(expired.body.check.fields.find((f: { field: string }) => f.field === 'Not expired')).toMatchObject({ status: 'NOT_FOUND', note: 'expired on 2020-01-31' });

    const other = await upload(e, { docType: 'BUSINESS_LICENSE' }, makePdf(['TRADE LICENCE', 'Some Other Company PLC', 'Licence No: AA/2231/15']));
    expect(other.body.check.fields.find((f: { field: string }) => f.field === 'Organization name').status).toBe('NOT_FOUND');
  });

  it('validates a TIN (10 digits) and compares it with the certificate', async () => {
    const e = await signUp('EMPLOYER', { type: 'PRIVATE_COMPANY' });
    const put = (b: object) => request(app).put('/api/v1/employers/me/legal').set(auth(e.token)).send(b);
    expect((await put({ tin: '12345' })).status).toBe(400);
    expect((await put({ tin: 'abcdefghij' })).status).toBe(400);
    expect((await put({ tin: '0012 345 678' })).body.legal.tin).toBe('0012345678');
    const ok = await upload(e, { docType: 'TIN_CERTIFICATE' }, makePdf(['TAX IDENTIFICATION NUMBER CERTIFICATE', `Taxpayer: ${e.org}`, 'TIN: 0012345678']));
    expect(ok.body.check.outcome).toBe('CONSISTENT');
    const wrong = await upload(e, { docType: 'TIN_CERTIFICATE' }, makePdf(['TAX IDENTIFICATION NUMBER CERTIFICATE', `Taxpayer: ${e.org}`, 'TIN: 0099999999']));
    expect(wrong.body.check.outcome).toBe('MISMATCH');
    expect((await request(app).get('/api/v1/employers/me/legal').set(auth(e.token))).body.legal.tin).toBe('0012345678');
  });

  it("checks the manager's own ID against the account name", async () => {
    const e = await signUp('EMPLOYER');
    expect((await upload(e, { docType: 'REPRESENTATIVE_ID' }, makePdf(['FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA', 'KEBELE IDENTITY CARD', `Full name: ${e.name}`, 'Kebele: 05 Woreda: Adama Sub-city: Central']))).body.check.outcome).toBe('CONSISTENT');
    expect((await upload(e, { docType: 'REPRESENTATIVE_ID' }, makePdf(['FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA', 'KEBELE IDENTITY CARD', 'Full name: Nobody Else At All', 'Kebele: 05 Woreda: Adama Sub-city: Central']))).body.check.outcome).toBe('MISMATCH');
  });
});

describe('publishing needs the organization\'s documents, and verification needs the administrator', () => {
  it('refuses to publish until every required document is sent, naming what is missing', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e);
    const none = await request(app).post(`/api/v1/jobs/${jobId}/publish`).set(auth(e.token)).send({});
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('DOCUMENTS_REQUIRED');
    expect(none.body.error.details.missing).toEqual(['Business licence', 'Your ID (the person who manages the account)']);
    await request(app).put('/api/v1/employers/me/legal').set(auth(e.token)).send({ licenseNumber: 'AA/2231/15', licenseExpiresAt: future(200) });
    await upload(e, { docType: 'BUSINESS_LICENSE' }, makePdf(['TRADE LICENCE issued by the Trade and Market Development Bureau', e.org!, 'Licence No: AA/2231/15', `Owner: ${e.name}`]));
    await upload(e, { docType: 'REPRESENTATIVE_ID' }, makePdf(['FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA', 'KEBELE IDENTITY CARD', `Full name: ${e.name}`, 'Kebele: 05 Woreda: Adama Sub-city: Central']));
    expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set(auth(e.token)).send({})).status).toBe(200);
    expect(await orgStatus(e)).toBe('PENDING'); // sent, not yet verified
  });

  it('becomes verified only when an administrator has approved every required document', async () => {
    const e = await signUp('EMPLOYER');
    await request(app).put('/api/v1/employers/me/legal').set(auth(e.token)).send({ licenseNumber: 'AA/2231/15', licenseExpiresAt: future(200) });
    await upload(e, { docType: 'BUSINESS_LICENSE' }, makePdf(['TRADE LICENCE issued by the Trade and Market Development Bureau', e.org!, 'Licence No: AA/2231/15', `Owner: ${e.name}`]));
    expect(await orgStatus(e)).toBe('PENDING');
    await upload(e, { docType: 'REPRESENTATIVE_ID' }, makePdf(['FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA', 'KEBELE IDENTITY CARD', `Full name: ${e.name}`, 'Kebele: 05 Woreda: Adama Sub-city: Central']));

    // the administrator sees what the employer typed next to the comparison
    const list = await request(app).get('/api/v1/admin/verifications?kind=EMPLOYER').set(auth(admin.token));
    const row = list.body.items.find((i: { requester: { id: string }; target: string }) => i.requester.id === e.id && /Business licence/.test(i.target));
    expect(row.target).toContain('licence AA/2231/15');
    expect(row.check.outcome).toBe('CONSISTENT');

    expect((await review((await requestOf(e, 'BUSINESS_LICENSE')).id, 'APPROVED')).status).toBe(200);
    expect(await orgStatus(e)).toBe('PENDING'); // one of two
    expect((await review((await requestOf(e, 'REPRESENTATIVE_ID')).id, 'APPROVED')).status).toBe(200);
    expect(await orgStatus(e)).toBe('VERIFIED');
    const c = await checklist(e);
    expect(c.organization.verificationStatus).toBe('VERIFIED');
    expect(c.items.filter((i: { required: boolean; status: string }) => i.required).every((i: { status: string }) => i.status === 'APPROVED')).toBe(true);
    expect((await upload(e, { docType: 'BUSINESS_LICENSE' }, makePdf(['again']))).status).toBe(409); // already approved
  });

  it('a rejected document sends the organization back to fix it, and a better upload puts it back in review', async () => {
    const e = await signUp('EMPLOYER');
    await request(app).put('/api/v1/employers/me/legal').set(auth(e.token)).send({ licenseNumber: 'AA/2231/15', licenseExpiresAt: future(200) });
    await upload(e, { docType: 'BUSINESS_LICENSE' }, makePdf(['TRADE LICENCE issued by the Trade and Market Development Bureau', e.org!, 'Licence No: AA/2231/15', `Owner: ${e.name}`]));
    expect((await review((await requestOf(e, 'BUSINESS_LICENSE')).id, 'REJECTED')).status).toBe(200);
    expect(await orgStatus(e)).toBe('REJECTED');
    const c = await checklist(e);
    expect(item(c, 'BUSINESS_LICENSE').status).toBe('REJECTED');
    await upload(e, { docType: 'BUSINESS_LICENSE' }, makePdf(['TRADE LICENCE (clearer copy) issued by the Trade and Market Development Bureau', e.org!, 'Licence No: AA/2231/15', `Owner: ${e.name}`]));
    expect(await orgStatus(e)).toBe('PENDING');
  });

  it('withdrawing the only waiting document returns the organization to unverified', async () => {
    const e = await signUp('EMPLOYER', { type: 'HOUSEHOLD' });
    const r = await upload(e, { docType: 'REPRESENTATIVE_ID' }, makePdf(['FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA', 'KEBELE IDENTITY CARD', `Full name: ${e.name}`, 'Kebele: 05 Woreda: Adama Sub-city: Central']));
    expect(await orgStatus(e)).toBe('PENDING');
    expect((await request(app).delete(`/api/v1/documents/${r.body.check.id}`).set(auth(e.token))).status).toBe(204);
    expect(await orgStatus(e)).toBe('UNVERIFIED');
  });

  it("a household verifies with just the hirer's ID", async () => {
    const e = await signUp('EMPLOYER', { type: 'INDIVIDUAL' });
    await upload(e, { docType: 'REPRESENTATIVE_ID' }, makePdf(['FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA', 'KEBELE IDENTITY CARD', `Full name: ${e.name}`, 'Kebele: 05 Woreda: Adama Sub-city: Central']));
    await review((await requestOf(e, 'REPRESENTATIVE_ID')).id, 'APPROVED');
    expect(await orgStatus(e)).toBe('VERIFIED');
  });
});
