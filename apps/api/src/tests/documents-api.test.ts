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
const newPhone = () => {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
};
type User = { token: string; id: string; name: string };

async function worker(fullName: string): Promise<User> {
  const res = await request(app).post('/api/v1/auth/register').send({ fullName, phone: newPhone(), password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, name: fullName };
}
let admin: User;
beforeAll(async () => {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: 'Test Admin Docs', phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' });
  admin = { token: login.body.accessToken, id: u.id, name: 'Test Admin Docs' };
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { OR: [{ phone: { in: phones } }, { fullName: 'Test Admin Docs' }] } });
  await prisma.organization.deleteMany({ where: { name: 'TEST_ORG Docs' } });
  await prisma.$disconnect();
});

const unique = () => randomUUID().replace(/[^a-z]/g, '').slice(0, 8) || 'abcdefgh';
const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz'[randomInt(0, 26)]).join('');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const identity = (u: User, body: object) => request(app).put('/api/v1/workers/me/identity').set(auth(u.token)).send(body);
const upload = (u: User, fields: Record<string, string>, buf: Buffer, name = 'doc.pdf') => {
  const r = request(app).post('/api/v1/workers/me/documents').set(auth(u.token));
  for (const [k, v] of Object.entries(fields)) r.field(k, v);
  return r.attach('file', buf, name);
};
const birth = (...lines: string[]) => makePdf(['REPUBLIC BIRTH CERTIFICATE', 'This is to certify the birth recorded below.', ...lines]);

/** A worker with distinctive names so a match cannot happen by accident. */
async function person() {
  const first = cap(letters(7)); const father = cap(letters(8)); const grand = cap(letters(6));
  const u = await worker(`${first} ${father}`);
  return { u, first, father, grand };
}

describe('identity details', () => {
  it('saves father name and birth date, privately, and rejects bad values', async () => {
    const { u, father } = await person();
    const ok = await identity(u, { fatherName: father, grandfatherName: null, dateOfBirth: '1995-03-12' });
    expect(ok.status).toBe(200);
    expect(ok.body.identity).toMatchObject({ fatherName: father, dateOfBirth: '1995-03-12', verified: false });
    expect((await request(app).get('/api/v1/workers/me/identity').set(auth(u.token))).body.identity.fatherName).toBe(father);
    expect((await identity(u, { dateOfBirth: '1995-02-31' })).status).toBe(400); // no such day
    expect((await identity(u, { dateOfBirth: new Date().toISOString().slice(0, 10) })).status).toBe(400); // newborn cannot work
    expect((await identity(u, { dateOfBirth: '1890-01-01' })).status).toBe(400);
    expect((await identity(u, { fatherName: 'X1<script>' })).status).toBe(400);
    expect((await identity(u, { fatherName: '' })).body.identity.fatherName).toBeNull(); // blank clears
    // never part of what employers see
    const profile = await request(app).get('/api/v1/workers/me').set(auth(u.token));
    expect(JSON.stringify(profile.body)).not.toContain('1995-03-12');
  });

  it('is for workers only', async () => {
    const e = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test Emp Docs', phone: newPhone(), password: 'Passw0rdTest', role: 'EMPLOYER', region: 'Oromia', zone: 'Adama', language: 'en', organizationName: 'TEST_ORG Docs', organizationType: 'SME' });
    expect((await request(app).get('/api/v1/workers/me/identity').set(auth(e.body.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/v1/workers/me/identity')).status).toBe(401);
  });
});

describe('birth certificate check', () => {
  it('asks for the details first', async () => {
    const { u } = await person();
    const r = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth('anything at all in this document, long enough to read'));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/father/i);
  });

  it('is consistent when the name, father and birth date are all on the document', async () => {
    const { u, first, father } = await person();
    await identity(u, { fatherName: father, dateOfBirth: '1995-03-12' });
    const r = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth(`Name of child: ${first.toUpperCase()} ${father.toUpperCase()}`, `Father: ${father.toUpperCase()} ${cap(letters(5))}`, 'Date of birth: 12/03/1995', 'Place of birth: Adama'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.check.outcome).toBe('CONSISTENT');
    expect(r.body.check.fields.map((f: { field: string; status: string }) => `${f.field}:${f.status}`)).toEqual(['Your name:FOUND', "Father's name:FOUND", 'Date of birth:FOUND']);
    expect(r.body.check.requestStatus).toBe('PENDING'); // never verified by the machine alone
    expect(JSON.stringify(r.body)).not.toMatch(/flags|EDITING|DUPLICATE/); // the warning signs are for administrators
    expect((await request(app).get('/api/v1/workers/me/identity').set(auth(u.token))).body.identity.verified).toBe(false);
  });

  it('reads a date written in the Ethiopian calendar', async () => {
    const { u, first, father } = await person();
    await identity(u, { fatherName: father, dateOfBirth: '1995-03-12' });
    // 3 Megabit 1987 in the Ethiopian calendar is 12 March 1995
    const r = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth(`Child: ${first} ${father}`, `Father: ${father}`, 'Date of birth: 3 Megabit 1987 E.C.'));
    expect(r.body.check.outcome).toBe('CONSISTENT');
    expect(r.body.check.fields.find((f: { field: string }) => f.field === 'Date of birth').note).toMatch(/Ethiopian/);
  });

  it('reports a mismatch when the father or the date differ, naming what was not found', async () => {
    const { u, first, father } = await person();
    await identity(u, { fatherName: father, dateOfBirth: '1995-03-12' });
    const wrongFather = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth(`Child: ${first} ${father}`, 'Father: Zzyzx Qqqqqq', 'Date of birth: 12/03/1995'));
    expect(wrongFather.body.check.outcome).toBe('MISMATCH');
    expect(wrongFather.body.check.fields.find((f: { field: string }) => f.field === "Father's name")).toMatchObject({ status: 'NOT_FOUND' });
    // the result shows what the document itself says, so the difference is visible
    expect(wrongFather.body.check.fields.find((f: { field: string }) => f.field === 'Date of birth').read).toBe('12/03/1995');
    expect(wrongFather.body.check.fields.find((f: { field: string }) => f.field === "Father's name").read).toMatch(/Father: Zzyzx Qqqqqq|Child/);
    const wrongDate = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth(`Child: ${first} ${father}`, `Father: ${father}`, 'Date of birth: 14/05/1990'));
    expect(wrongDate.body.check.outcome).toBe('MISMATCH');
    expect(wrongDate.body.check.fields.find((f: { field: string }) => f.field === 'Date of birth').note).toMatch(/none equals/);
  });

  it('says it cannot tell when nothing can be read, instead of guessing', async () => {
    const { u, father } = await person();
    await identity(u, { fatherName: father, dateOfBirth: '1995-03-12' });
    const r = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, makePdf([]));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.check.outcome).toBe('UNREADABLE');
    expect(r.body.check.requestStatus).toBe('PENDING'); // still goes to a person
  }, 60_000);

  it('a second upload replaces the one waiting for review', async () => {
    const { u, first, father } = await person();
    await identity(u, { fatherName: father, dateOfBirth: '1995-03-12' });
    const bad = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth(`Child: ${first}`, 'Father: Nobody Known', 'Date of birth: 01/01/2000'));
    const good = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth(`Child: ${first} ${father}`, `Father: ${father}`, 'Date of birth: 12/03/1995'));
    expect(good.body.check.outcome).toBe('CONSISTENT');
    const list = await request(app).get('/api/v1/workers/me/documents').set(auth(u.token));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(good.body.check.id);
    expect(await prisma.documentCheck.count({ where: { id: bad.body.check.id } })).toBe(0);
    expect(await prisma.verificationRequest.count({ where: { userId: u.id, kind: 'IDENTITY', status: 'PENDING' } })).toBe(1);
  });

  it('refuses files that are not PDF, JPG or PNG', async () => {
    const { u, father } = await person();
    await identity(u, { fatherName: father, dateOfBirth: '1995-03-12' });
    const r = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, Buffer.from('just some text pretending to be a certificate'), 'cert.pdf');
    expect(r.status).toBe(415);
    expect(await prisma.documentCheck.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe('a photographed certificate', () => {
  it('is read from the picture and compared like a typed one', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const { u, first, father } = await person();
    await identity(u, { fatherName: father, dateOfBirth: '1995-03-12' });
    const lines = ['BIRTH CERTIFICATE', `Name of child: ${first} ${father}`, `Name of father: ${father}`, 'Date of birth: 12/03/1995', 'Place of birth: Adama'];
    const canvas = createCanvas(1400, 700);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1400, 700);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 52px sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, 60, 100 + i * 120));
    const r = await upload(u, { docType: 'BIRTH_CERTIFICATE' }, canvas.toBuffer('image/png'), 'photo.png');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // OCR can misread a digit (1995 as 1993); that must send the document to a person, never call it a mismatch
    expect(['CONSISTENT', 'PARTIAL'], JSON.stringify(r.body.check)).toContain(r.body.check.outcome);
    expect(r.body.check.fields.filter((f: { field: string; status: string }) => f.field !== 'Date of birth').every((f: { status: string }) => f.status === 'FOUND')).toBe(true);
    // a picture with no software marks and a normal size raises no warning signs
    const row = await prisma.documentCheck.findUniqueOrThrow({ where: { id: r.body.check.id } });
    expect(row.ocrConfidence).toBeGreaterThan(60);
  }, 120_000);
});

describe('administrator review sees the comparison and the warning signs', () => {
  it('flags a file that another account uploaded, and an edited-looking PDF, to administrators only', async () => {
    const a = await person();
    const b = await person();
    for (const p of [a, b]) await identity(p.u, { fatherName: p.father, dateOfBirth: '1995-03-12' });
    const shared = birth(`Child: ${a.first} ${a.father}`, `Father: ${a.father}`, 'Date of birth: 12/03/1995');
    await upload(a.u, { docType: 'BIRTH_CERTIFICATE' }, shared);
    await upload(b.u, { docType: 'BIRTH_CERTIFICATE' }, shared); // the same bytes from someone else
    const listed = await request(app).get('/api/v1/admin/verifications?kind=IDENTITY').set(auth(admin.token));
    const forB = listed.body.items.find((i: { requester: { id: string } }) => i.requester.id === b.u.id);
    expect(forB.target).toMatch(/Birth certificate/);
    expect(forB.target).toContain(b.father);
    expect(forB.check.flags.map((f: { code: string }) => f.code)).toContain('DUPLICATE_OTHER_ACCOUNT');
    expect(forB.check.fields.length).toBeGreaterThan(0);

    const c = await person();
    await identity(c.u, { fatherName: c.father, dateOfBirth: '1995-03-12' });
    const edited = Buffer.concat([birth(`Child: ${c.first} ${c.father}`, `Father: ${c.father}`, 'Date of birth: 12/03/1995'), Buffer.from('\n%Producer (Microsoft Word 2016) Adobe Photoshop 25\n', 'latin1')]);
    await upload(c.u, { docType: 'BIRTH_CERTIFICATE' }, edited);
    const again = await request(app).get('/api/v1/admin/verifications?kind=IDENTITY').set(auth(admin.token));
    const forC = again.body.items.find((i: { requester: { id: string } }) => i.requester.id === c.u.id);
    expect(forC.check.flags.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(['EDITING_SOFTWARE', 'MADE_ON_COMPUTER']));
  });

  it('only an administrator approval marks identity verified, and editing the details afterwards withdraws it', async () => {
    const { u, first, father } = await person();
    await identity(u, { fatherName: father, dateOfBirth: '1995-03-12' });
    await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth(`Child: ${first} ${father}`, `Father: ${father}`, 'Date of birth: 12/03/1995'));
    const req = await prisma.verificationRequest.findFirstOrThrow({ where: { userId: u.id, kind: 'IDENTITY' } });
    const review = await request(app).post(`/api/v1/admin/verifications/${req.id}/review`).set(auth(admin.token)).send({ decision: 'APPROVED' });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect((await request(app).get('/api/v1/workers/me/identity').set(auth(u.token))).body.identity.verified).toBe(true);
    expect((await request(app).get('/api/v1/workers/me/documents').set(auth(u.token))).body.items[0].requestStatus).toBe('APPROVED');
    // verified identity cannot be replaced by uploading again
    expect((await upload(u, { docType: 'BIRTH_CERTIFICATE' }, birth(`Child: ${first} ${father}`))).status).toBe(409);
    // changing a detail means the administrator's check no longer applies
    await identity(u, { dateOfBirth: '1996-01-01' });
    expect((await request(app).get('/api/v1/workers/me/identity').set(auth(u.token))).body.identity.verified).toBe(false);
  });
});

describe('education certificate check', () => {
  const addEducation = async (u: User, body: object) => {
    const r = await request(app).post('/api/v1/workers/me/education').set(auth(u.token)).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return (r.body.profile.education as { id: string }[]).at(-1)!.id;
  };

  it('compares the name, school, year and level with the entry on the profile', async () => {
    const { u, first, father } = await person();
    const school = cap(letters(9));
    const id = await addEducation(u, { level: 'DIPLOMA', institution: `${school} University`, year: 2021, field: 'Accounting' });
    const r = await upload(u, { docType: 'EDUCATION_CERTIFICATE', educationId: id }, makePdf([`${school} University`, 'This certifies that', `${first} ${father}`, 'has completed the Advanced Diploma in Accounting', 'Graduation: July 2021']));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.check.outcome).toBe('CONSISTENT');
    expect(r.body.check.fields.map((f: { field: string }) => f.field)).toEqual(['Your name', 'Institution', 'Year', 'Level']);
    // approval by an administrator is what marks the entry verified
    const req = await prisma.verificationRequest.findFirstOrThrow({ where: { userId: u.id, kind: 'QUALIFICATION', targetId: id } });
    expect((await request(app).post(`/api/v1/admin/verifications/${req.id}/review`).set(auth(admin.token)).send({ decision: 'APPROVED' })).status).toBe(200);
    expect((await prisma.education.findUniqueOrThrow({ where: { id } })).source).toBe('VERIFIED');
  });

  it('is partial when the name matches but the school is not on the document, and mismatched for a different person', async () => {
    const { u, first, father } = await person();
    const id = await addEducation(u, { level: 'BACHELOR', institution: `${cap(letters(9))} University`, year: 2019 });
    const partial = await upload(u, { docType: 'EDUCATION_CERTIFICATE', educationId: id }, makePdf(['Some Other College', `Awarded to ${first} ${father}`, 'Bachelor of Science', 'Year 2019']));
    expect(partial.body.check.outcome).toBe('PARTIAL');
    expect(partial.body.check.fields.find((f: { field: string }) => f.field === 'Institution').status).toBe('NOT_FOUND');
    const someoneElse = await upload(u, { docType: 'EDUCATION_CERTIFICATE', educationId: id }, makePdf(['Some Other College', `Awarded to ${cap(letters(6))} ${cap(letters(7))}`, 'Bachelor of Science', 'Year 2019']));
    expect(someoneElse.body.check.outcome).toBe('MISMATCH');
  });

  it('needs an education entry of the worker, not someone else\'s', async () => {
    const a = await person();
    const b = await person();
    const idB = await addEducation(b.u, { level: 'DIPLOMA', institution: 'Test College', year: 2020 });
    const doc = makePdf([`${a.first} ${a.father}`, 'Diploma certificate of completion for the course']);
    expect((await upload(a.u, { docType: 'EDUCATION_CERTIFICATE' }, doc)).status).toBe(400);
    expect((await upload(a.u, { docType: 'EDUCATION_CERTIFICATE', educationId: idB }, doc)).status).toBe(404);
  });

  it('can be withdrawn while waiting, but not after review', async () => {
    const { u, first, father } = await person();
    const id = await addEducation(u, { level: 'DIPLOMA', institution: 'Test College', year: 2020 });
    const r = await upload(u, { docType: 'EDUCATION_CERTIFICATE', educationId: id }, makePdf([`${first} ${father}`, 'Test College diploma 2020 certificate of completion']));
    expect((await request(app).delete(`/api/v1/workers/me/documents/${r.body.check.id}`).set(auth(u.token))).status).toBe(204);
    expect((await request(app).get('/api/v1/workers/me/documents').set(auth(u.token))).body.items).toHaveLength(0);
    expect(await prisma.fileAsset.count({ where: { ownerId: u.id, kind: 'VERIFICATION_EVIDENCE' } })).toBe(0);
  });
});
