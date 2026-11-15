import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { uploadRoot } from '../modules/files/storage';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}

async function signUp(role: 'WORKER' | 'EMPLOYER', over: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      fullName: `Test ${role}`, phone: newPhone(), password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
      ...(role === 'EMPLOYER' ? { organizationName: 'TEST_ORG Profiles', organizationType: 'SME' } : {}),
      ...over,
    });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

let categoryId = '';
let skillIds: string[] = [];

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  skillIds = (await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'welding', 'brake-systems', 'panel-beating'] } } })).map((s) => s.id);
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const files = await prisma.fileAsset.findMany({ where: { ownerId: { in: ids } } });
  for (const f of files) fs.rmSync(path.join(uploadRoot, f.storagePath), { force: true });
  await prisma.verificationRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  for (const level of ['KEBELE', 'WOREDA', 'ZONE'] as const) {
    await prisma.location.deleteMany({ where: { level, nameEn: { startsWith: 'Test' } } });
  }
  await prisma.$disconnect();
});

describe('taxonomy', () => {
  it('lists categories, searches skills by name and alias, and lists regions', async () => {
    expect((await request(app).get('/api/v1/categories')).body.items.length).toBeGreaterThanOrEqual(14);
    const byName = await request(app).get('/api/v1/skills?q=weld');
    expect(byName.body.items.map((s: { nameEn: string }) => s.nameEn)).toContain('Welding');
    const byAlias = await request(app).get('/api/v1/skills?q=electrician');
    expect(byAlias.body.items.map((s: { nameEn: string }) => s.nameEn)).toContain('Electrical Wiring');
    const regions = await request(app).get('/api/v1/locations');
    expect(regions.body.items.length).toBe(14);
    expect(regions.body.items.every((l: { level: string }) => l.level === 'REGION')).toBe(true);
  });
});

describe('worker profile', () => {
  it('computes completion transparently as the profile fills in', async () => {
    const { token } = await signUp('WORKER');
    let me = await request(app).get('/api/v1/workers/me').set(auth(token));
    expect(me.body.profile.completion.pct).toBe(10); // location from registration

    const patch = await request(app).patch('/api/v1/workers/me').set(auth(token)).send({
      headline: 'Automotive technician', bio: 'Ten years repairing minibuses and trucks in Adama.',
      occupation: 'Mechanic', categoryId, yearsExperience: 10, expectedSalaryMin: 6000, expectedSalaryMax: 9000,
      preferredTypes: ['FULL_TIME', 'CONTRACT'], languages: ['Afaan Oromoo', 'Amharic'], maxTravelKm: 30,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.profile.completion.pct).toBe(60);

    for (const id of skillIds.slice(0, 3)) {
      const r = await request(app).put(`/api/v1/workers/me/skills/${id}`).set(auth(token)).send({ proficiency: 4, years: 5 });
      expect(r.status).toBe(200);
    }
    const exp = await request(app).post('/api/v1/workers/me/experience').set(auth(token)).send({ title: 'Mechanic', employer: 'Adama Garage', startDate: '2018-01-01' });
    expect(exp.status).toBe(201);
    expect(exp.body.profile.completion.pct).toBe(90);

    expect((await request(app).post('/api/v1/workers/me/photo').set(auth(token)).attach('file', PNG, 'me.png')).status).toBe(201);
    const cv = await request(app).post('/api/v1/workers/me/cv').set(auth(token)).attach('file', PDF, 'cv.pdf');
    expect(cv.body.profile.completion.pct).toBe(100);
    expect(cv.body.profile.completion.items.every((i: { done: boolean }) => i.done)).toBe(true);
  });

  it('rejects invalid input and unknown fields', async () => {
    const { token } = await signUp('WORKER');
    const bad: [string, Record<string, unknown>][] = [
      ['salary range reversed', { expectedSalaryMin: 9000, expectedSalaryMax: 1000 }],
      ['lat without lng', { lat: 9.03 }],
      ['out-of-range latitude', { lat: 123, lng: 38 }],
      ['javascript: link', { portfolioUrls: ['javascript:alert(1)'] }],
      ['too many languages', { languages: Array.from({ length: 11 }, (_, i) => `L${i}`) }],
      ['unknown category', { categoryId: '00000000-0000-4000-8000-000000000000' }],
      ['mass assignment of completionPct', { completionPct: 100 }],
      ['mass assignment of userId', { userId: '00000000-0000-4000-8000-000000000000' }],
    ];
    for (const [name, body] of bad) {
      const r = await request(app).patch('/api/v1/workers/me').set(auth(token)).send(body);
      expect(r.status, name).toBe(400);
    }
  });

  it('stores GPS only as a pair and lets the owner clear it', async () => {
    const { token } = await signUp('WORKER');
    const set = await request(app).patch('/api/v1/workers/me').set(auth(token)).send({ lat: 8.5412, lng: 39.2681 });
    expect(set.body.profile.lat).toBeCloseTo(8.5412);
    const cleared = await request(app).patch('/api/v1/workers/me').set(auth(token)).send({ lat: null, lng: null });
    expect(cleared.body.profile.lat).toBeNull();
  });

  it('never lets users mark their own skills or qualifications as verified', async () => {
    const { token, id } = await signUp('WORKER');
    await request(app).put(`/api/v1/workers/me/skills/${skillIds[0]}`).set(auth(token)).send({ proficiency: 5, source: 'VERIFIED' });
    const edu = await request(app).post('/api/v1/workers/me/education').set(auth(token)).send({ level: 'DIPLOMA', field: 'Automotive', source: 'VERIFIED' });
    expect(edu.status).toBe(201);
    const worker = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: id }, include: { skills: true, education: true } });
    expect(worker.skills[0].source).toBe('SELF_REPORTED');
    expect(worker.education[0].source).toBe('SELF_REPORTED');
    const me = await request(app).get('/api/v1/workers/me').set(auth(token));
    expect(me.body.profile.skills[0].source).toBe('SELF_REPORTED');
  });

  it('keeps verified status when a skill is edited, and rejects unknown skills', async () => {
    const { token, id } = await signUp('WORKER');
    await request(app).put(`/api/v1/workers/me/skills/${skillIds[1]}`).set(auth(token)).send({ proficiency: 3 });
    const w = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: id } });
    await prisma.workerSkill.update({ where: { workerId_skillId: { workerId: w.id, skillId: skillIds[1] } }, data: { source: 'VERIFIED' } });
    const r = await request(app).put(`/api/v1/workers/me/skills/${skillIds[1]}`).set(auth(token)).send({ proficiency: 5 });
    expect(r.body.profile.skills[0]).toMatchObject({ proficiency: 5, source: 'VERIFIED' });
    expect((await request(app).put('/api/v1/workers/me/skills/00000000-0000-4000-8000-000000000000').set(auth(token)).send({ proficiency: 3 })).status).toBe(404);
    expect((await request(app).put(`/api/v1/workers/me/skills/${skillIds[0]}`).set(auth(token)).send({ proficiency: 9 })).status).toBe(400);
  });

  it("stops one worker from editing or deleting another worker's records", async () => {
    const a = await signUp('WORKER');
    const b = await signUp('WORKER');
    const created = await request(app).post('/api/v1/workers/me/education').set(auth(a.token)).send({ level: 'BACHELOR', field: 'Engineering' });
    const eduId = created.body.profile.education[0].id;
    expect((await request(app).put(`/api/v1/workers/me/education/${eduId}`).set(auth(b.token)).send({ level: 'NONE' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/workers/me/education/${eduId}`).set(auth(b.token))).status).toBe(404);
    expect(await prisma.education.count({ where: { id: eduId } })).toBe(1);
    expect((await request(app).delete(`/api/v1/workers/me/education/${eduId}`).set(auth(a.token))).status).toBe(200);
  });

  it('validates work history dates', async () => {
    const { token } = await signUp('WORKER');
    const r = await request(app).post('/api/v1/workers/me/experience').set(auth(token)).send({ title: 'Driver', startDate: '2020-05-01', endDate: '2019-01-01' });
    expect(r.status).toBe(400);
  });

  it('only allows workers on /workers/me', async () => {
    const e = await signUp('EMPLOYER');
    expect((await request(app).get('/api/v1/workers/me').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/workers/me')).status).toBe(401);
  });
});

describe('employer view of a worker (privacy)', () => {
  it('hides contact details and exact coordinates, and respects visibility', async () => {
    const w = await signUp('WORKER', { email: 'private.person@example.com', zone: 'TestZone P', woreda: 'TestWoreda P', kebele: 'TestKebele P' });
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ headline: 'Welder', lat: 8.541234, lng: 39.268199 });
    await request(app).post('/api/v1/workers/me/cv').set(auth(w.token)).attach('file', PDF, 'cv.pdf');
    const worker = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } });
    const e = await signUp('EMPLOYER');

    const view = await request(app).get(`/api/v1/workers/${worker.id}`).set(auth(e.token));
    expect(view.status).toBe(200);
    const text = JSON.stringify(view.body);
    expect(text).not.toContain('private.person@example.com');
    expect(text).not.toContain('+251');
    expect(text).not.toContain('8.541234');
    expect(text).not.toContain('39.268199');
    expect(text).not.toContain('TestKebele P');
    expect(view.body.profile.approxLocation).toEqual({ lat: 8.54, lng: 39.27 });
    expect(view.body.profile.locationPath.map((l: { name: string }) => l.name)).toEqual(['Oromia', 'TestZone P', 'TestWoreda P']);
    expect(view.body.profile.cvUrl).toBeUndefined();
    expect(view.body.profile.lat).toBeUndefined();

    const before = (await prisma.workerProfile.findUniqueOrThrow({ where: { id: worker.id } })).profileViews;
    await request(app).get(`/api/v1/workers/${worker.id}`).set(auth(e.token));
    expect((await prisma.workerProfile.findUniqueOrThrow({ where: { id: worker.id } })).profileViews).toBe(before + 1);

    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ isVisible: false });
    expect((await request(app).get(`/api/v1/workers/${worker.id}`).set(auth(e.token))).status).toBe(404);
  });

  it('is not available to other workers or anonymous users', async () => {
    const w = await signUp('WORKER');
    const other = await signUp('WORKER');
    const worker = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } });
    expect((await request(app).get(`/api/v1/workers/${worker.id}`).set(auth(other.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/workers/${worker.id}`)).status).toBe(401);
  });
});

describe('secure uploads', () => {
  it('detects type from file contents, not the name or declared type', async () => {
    const { token } = await signUp('WORKER');
    const cases: [string, Buffer, string, string, number][] = [
      ['text renamed .pdf', Buffer.from('just some text, not a pdf'), 'cv.pdf', 'application/pdf', 415],
      ['Windows executable renamed .pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), 'cv.pdf', 'application/pdf', 415],
      ['HTML disguised as pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'cv.pdf', 'application/pdf', 415],
      ['GIF sent as a CV', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100)]), 'cv.pdf', 'application/pdf', 415], // a photo (JPEG/PNG) is now a valid CV for OCR; other image types are not
      ['PDF sent as a photo', PDF, 'me.png', 'image/png', 415],
    ];
    for (const [name, buf, filename, type, status] of cases) {
      const kind = name.includes('photo') ? 'photo' : 'cv';
      const r = await request(app).post(`/api/v1/workers/me/${kind}`).set(auth(token)).attach('file', buf, { filename, contentType: type });
      expect(r.status, name).toBe(status);
    }
  });

  it('enforces size limits and requires a file', async () => {
    const { token } = await signUp('WORKER');
    const bigPhoto = Buffer.concat([JPG, Buffer.alloc(3 * 1024 * 1024)]);
    expect((await request(app).post('/api/v1/workers/me/photo').set(auth(token)).attach('file', bigPhoto, 'big.jpg')).status).toBe(413);
    const hugePdf = Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]);
    expect((await request(app).post('/api/v1/workers/me/cv').set(auth(token)).attach('file', hugePdf, 'huge.pdf')).status).toBe(413);
    expect((await request(app).post('/api/v1/workers/me/cv').set(auth(token))).status).toBe(400);
  });

  it('stores files under random names and ignores path tricks in filenames', async () => {
    const { token, id } = await signUp('WORKER');
    const r = await request(app).post('/api/v1/workers/me/cv').set(auth(token)).attach('file', PDF, { filename: '../../evil.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    const asset = await prisma.fileAsset.findFirstOrThrow({ where: { ownerId: id, kind: 'CV' } });
    expect(asset.storagePath).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(fs.existsSync(path.join(uploadRoot, asset.storagePath))).toBe(true);
  });

  it('replaces and deletes old files from disk and database', async () => {
    const { token, id } = await signUp('WORKER');
    await request(app).post('/api/v1/workers/me/cv').set(auth(token)).attach('file', PDF, 'one.pdf');
    const first = await prisma.fileAsset.findFirstOrThrow({ where: { ownerId: id } });
    await request(app).post('/api/v1/workers/me/cv').set(auth(token)).attach('file', Buffer.concat([PDF, Buffer.from('v2')]), 'two.pdf');
    expect(fs.existsSync(path.join(uploadRoot, first.storagePath))).toBe(false);
    expect(await prisma.fileAsset.count({ where: { ownerId: id } })).toBe(1);
    await request(app).delete('/api/v1/workers/me/cv').set(auth(token));
    expect(await prisma.fileAsset.count({ where: { ownerId: id } })).toBe(0);
  });

  it('serves files only to people allowed to see them, with safe headers', async () => {
    const owner = await signUp('WORKER');
    const other = await signUp('WORKER');
    await request(app).post('/api/v1/workers/me/cv').set(auth(owner.token)).attach('file', PDF, 'cv.pdf');
    await request(app).post('/api/v1/workers/me/photo').set(auth(owner.token)).attach('file', JPG, 'p.jpg');
    const me = await request(app).get('/api/v1/workers/me').set(auth(owner.token));
    const cvUrl = me.body.profile.cvUrl as string;
    const photoUrl = me.body.profile.photoUrl as string;

    const own = await request(app).get(cvUrl).set(auth(owner.token));
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toContain('application/pdf');
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(own.headers['content-disposition']).toContain('attachment');

    expect((await request(app).get(cvUrl).set(auth(other.token))).status).toBe(403);
    expect((await request(app).get(cvUrl)).status).toBe(401);
    expect((await request(app).get(photoUrl).set(auth(other.token))).status).toBe(200);
    expect((await request(app).get('/api/v1/files/not-a-uuid').set(auth(other.token))).status).toBe(404);
  });
});

describe('employer organization', () => {
  it('reads and updates the organization profile', async () => {
    const { token } = await signUp('EMPLOYER');
    const ok = await request(app).patch('/api/v1/employers/me').set(auth(token)).send({
      description: 'We build houses.', website: 'https://example.com', address: 'Bole, Addis Ababa', roleInOrg: 'Owner',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.organization).toMatchObject({ website: 'https://example.com', verificationStatus: 'UNVERIFIED' });
    expect(ok.body.roleInOrg).toBe('Owner');
    for (const website of ['javascript:alert(1)', 'ftp://x.org', 'not a url']) {
      expect((await request(app).patch('/api/v1/employers/me').set(auth(token)).send({ website })).status, website).toBe(400);
    }
    expect((await request(app).patch('/api/v1/employers/me').set(auth(token)).send({ verificationStatus: 'VERIFIED' })).status).toBe(400);
  });

  it('keeps employer endpoints away from workers', async () => {
    const w = await signUp('WORKER');
    expect((await request(app).get('/api/v1/employers/me').set(auth(w.token))).status).toBe(403);
  });

  it('runs the verification request flow without ever self-granting the badge', async () => {
    const e = await signUp('EMPLOYER');
    const noFile = await request(app).post('/api/v1/employers/me/verification').set(auth(e.token));
    expect(noFile.status).toBe(400);
    const bad = await request(app).post('/api/v1/employers/me/verification').set(auth(e.token)).attach('file', Buffer.from('nope'), 'doc.pdf');
    expect(bad.status).toBe(415);

    const sent = await request(app).post('/api/v1/employers/me/verification').set(auth(e.token)).attach('file', PDF, 'license.pdf');
    expect(sent.status).toBe(201);
    expect(sent.body.organization.verificationStatus).toBe('PENDING');
    expect(sent.body.latestVerificationRequest.status).toBe('PENDING');
    expect((await request(app).post('/api/v1/employers/me/verification').set(auth(e.token)).attach('file', PDF, 'again.pdf')).status).toBe(409);

    // Evidence: visible to an admin, not to other users.
    const req = await prisma.verificationRequest.findFirstOrThrow({ where: { userId: e.id } });
    const adminPhone = newPhone();
    await prisma.user.create({ data: { fullName: 'Test Admin', phone: `+251${adminPhone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ phone: adminPhone, password: 'Passw0rdTest' });
    const other = await signUp('EMPLOYER');
    expect((await request(app).get(`/api/v1/files/${req.evidenceFileId}`).set(auth(adminLogin.body.accessToken))).status).toBe(200);
    expect((await request(app).get(`/api/v1/files/${req.evidenceFileId}`).set(auth(other.token))).status).toBe(403);

    const withdrawn = await request(app).delete('/api/v1/employers/me/verification').set(auth(e.token));
    expect(withdrawn.body.organization.verificationStatus).toBe('UNVERIFIED');
    expect(await prisma.fileAsset.count({ where: { id: req.evidenceFileId! } })).toBe(0);
  });
});
