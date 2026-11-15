import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { uploadRoot } from '../modules/files/storage';
import { createCanvas } from '@napi-rs/canvas';
import { makePdf } from './helpers/pdf';
import { scannedPdf } from './helpers/scannedPdf';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function signUp(role: 'WORKER' | 'EMPLOYER') {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Analysis ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

let autoId = '';
let skill: Record<string, string> = {};

beforeAll(async () => {
  autoId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  const rows = await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems', 'welding'] } } });
  skill = Object.fromEntries(rows.map((s) => [s.slug, s.id]));
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  for (const f of await prisma.fileAsset.findMany({ where: { ownerId: { in: ids } } })) fs.rmSync(path.join(uploadRoot, f.storagePath), { force: true });
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('job description analysis API', () => {
  const AD = 'We need a mechanic with engine repair experience. Brake repair is required. Welding is an advantage. At least 2 years of experience. Full-time. Salary 5,000 - 8,000 ETB per month.';
  const analyze = (token: string | null, body: unknown) => {
    const r = request(app).post('/api/v1/analysis/job');
    return (token ? r.set(auth(token)) : r).send(body as object);
  };

  it('suggests skills from the real taxonomy with importance, evidence and the other fields', async () => {
    const e = await signUp('EMPLOYER');
    const res = await analyze(e.token, { title: 'Minibus mechanic', description: AD });
    expect(res.status).toBe(200);
    const a = res.body.analysis;
    const by = Object.fromEntries(a.skills.map((s: { name: string; skillId: string; importance: string }) => [s.name, s]));
    expect(by['Engine Repair'].skillId).toBe(skill['engine-repair']);
    expect(by['Engine Repair'].importance).toBe('REQUIRED');
    expect(by['Brake Systems'].importance).toBe('REQUIRED');
    expect(by['Welding'].importance).toBe('PREFERRED');
    expect(by['Brake Systems'].evidence).toContain('Brake repair');
    expect(a.minExperienceYears.value).toBe(2);
    expect(a.employmentType.value).toBe('FULL_TIME');
    expect(a.salary.value).toEqual({ min: 5000, max: 8000 });
    expect(a.category.value.id).toBe(autoId);
    expect(a.method).toBe('rules-1.0');
    expect(await prisma.auditLog.count({ where: { actorId: e.id, action: 'analysis.job' } })).toBe(1);
  });

  it('saves nothing: analysing a description does not create or change a job', async () => {
    const e = await signUp('EMPLOYER');
    const before = await prisma.job.count({ where: { postedById: e.id } });
    await analyze(e.token, { description: AD });
    expect(await prisma.job.count({ where: { postedById: e.id } })).toBe(before);
  });

  it('is for employers only and validates input', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    expect((await analyze(null, { description: AD })).status).toBe(401);
    expect((await analyze(w.token, { description: AD })).status).toBe(403);
    expect((await analyze(e.token, { description: 'too short' })).status).toBe(400);
    expect((await analyze(e.token, { description: AD, status: 'ACTIVE' })).status).toBe(400);
    expect((await analyze(e.token, {})).status).toBe(400);
    expect((await analyze(e.token, { description: 'x'.repeat(10_001) })).status).toBe(400);
  });

  it('records that the employer reviewed the suggestions when a job is saved', async () => {
    const e = await signUp('EMPLOYER');
    const loc = (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;
    const base = {
      title: `Reviewed ${tag()}`, description: `${AD} ${randomUUID()} ${randomUUID()}`, categoryId: autoId, employmentType: 'FULL_TIME', locationId: loc,
      deadline: future(30), skills: [{ skillId: skill['engine-repair'], importance: 'REQUIRED' }],
    };
    const reviewed = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({ ...base, extractionReviewed: true });
    const plain = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({ ...base, title: `Plain ${tag()}` });
    expect(reviewed.status).toBe(201);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: reviewed.body.job.id } })).extractionApprovedAt).not.toBeNull();
    expect((await prisma.job.findUniqueOrThrow({ where: { id: plain.body.job.id } })).extractionApprovedAt).toBeNull();
    const upd = await request(app).patch(`/api/v1/jobs/${plain.body.job.id}`).set(auth(e.token)).send({ extractionReviewed: true });
    expect(upd.status).toBe(200);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: plain.body.job.id } })).extractionApprovedAt).not.toBeNull();
  });
});

describe('CV analysis API', () => {
  const CV_LINES = [
    'Abebe Kebede', 'Summary', 'Mechanic with ten years of experience repairing minibuses.',
    'Work Experience', 'Senior Mechanic - Adama Auto Garage', '2018 - Present', 'Mechanic at Hawassa Transport', 'Jan 2012 - Dec 2017',
    'Education', 'Diploma in Automotive Technology', 'Adama TVET College, 2011',
    'Skills', 'Engine repair, Brake repair, MIG welding',
    'Certifications', 'Certificate in Defensive Driving, 2015',
    'Languages', 'Amharic, English',
  ];
  const upload = (token: string, buf: Buffer) => request(app).post('/api/v1/workers/me/cv').set(auth(token)).attach('file', buf, 'cv.pdf');
  const analyze = (token: string) => request(app).post('/api/v1/workers/me/cv/analyze').set(auth(token));
  const apply = (token: string, body: unknown) => request(app).post('/api/v1/workers/me/cv/apply').set(auth(token)).send(body as object);

  it('asks for a CV first, and explains scanned or unreadable files', async () => {
    const w = await signUp('WORKER');
    const none = await analyze(w.token);
    expect(none.status).toBe(400);
    expect(none.body.error.message).toContain('Upload your CV');

    await upload(w.token, makePdf([])); // a valid PDF with no text, like a scan
    const scanned = await analyze(w.token);
    expect(scanned.status).toBe(422);
    expect(scanned.body.error.code).toBe('NO_TEXT');
    expect(scanned.body.error.message).toContain('picture'); // OCR was tried and found nothing
  });

  it('reads a real CV PDF into a reviewable draft without saving anything', async () => {
    const w = await signUp('WORKER');
    expect((await upload(w.token, makePdf(CV_LINES))).status).toBe(201);
    const res = await analyze(w.token);
    expect(res.status).toBe(200);
    const p = res.body.parsed;
    expect(res.body.pages).toBe(1);
    expect(p.skills.map((s: { name: string }) => s.name).sort()).toEqual(['Brake Systems', 'Engine Repair', 'Welding']);
    expect(p.skills.every((s: { alreadyOnProfile: boolean }) => !s.alreadyOnProfile)).toBe(true);
    expect(p.experiences).toHaveLength(2);
    expect(p.experiences[0]).toMatchObject({ title: 'Senior Mechanic', employer: 'Adama Auto Garage', startDate: '2018-01-01', endDate: null });
    expect(p.education[0]).toMatchObject({ level: 'DIPLOMA', field: 'Automotive Technology', year: 2011 });
    expect(p.certifications[0].name).toBe('Certificate in Defensive Driving');
    expect(p.languages).toEqual(['Amharic', 'English']);
    expect(p.estimatedYearsExperience).toBeGreaterThan(10);
    // analysing alone must not touch the profile
    const profile = (await request(app).get('/api/v1/workers/me').set(auth(w.token))).body.profile;
    expect(profile.skills).toHaveLength(0);
    expect(profile.experiences).toHaveLength(0);
  });

  it('saves only what the worker approved, as self-reported, and skips duplicates on a second import', async () => {
    const w = await signUp('WORKER');
    await upload(w.token, makePdf(CV_LINES));
    const draft = (await analyze(w.token)).body.parsed;

    const body = {
      // the worker keeps two skills and drops welding; edits one job title; keeps the education; skips the certificate
      skills: draft.skills.filter((s: { name: string }) => s.name !== 'Welding').map((s: { skillId: string }) => ({ skillId: s.skillId, proficiency: 4 })),
      experiences: [{ ...draft.experiences[0], title: 'Lead Mechanic', employer: draft.experiences[0].employer }],
      education: [draft.education[0]],
      certifications: [],
      yearsExperience: 12,
      bio: 'Mechanic with ten years of experience.',
    };
    const first = await apply(w.token, body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.added).toEqual({ skills: 2, experiences: 1, education: 1, certifications: 0 });
    const prof = first.body.profile;
    expect(prof.skills.map((s: { name: string }) => s.name).sort()).toEqual(['Brake Systems', 'Engine Repair']);
    expect(prof.skills.every((s: { source: string }) => s.source === 'SELF_REPORTED')).toBe(true);
    expect(prof.education[0].source).toBe('SELF_REPORTED');
    expect(prof.experiences[0].title).toBe('Lead Mechanic'); // the edited value was saved, not the extracted one
    expect(prof.yearsExperience).toBe(12);
    expect(prof.bio).toBe('Mechanic with ten years of experience.');

    // the analysis now shows what is already on the profile
    const again = (await analyze(w.token)).body.parsed;
    expect(again.skills.filter((s: { alreadyOnProfile: boolean }) => s.alreadyOnProfile)).toHaveLength(2);

    // importing the same things again adds nothing and never overwrites an existing biography
    const second = await apply(w.token, { ...body, bio: 'A different biography that must not replace the first.' });
    expect(second.body.added).toEqual({ skills: 0, experiences: 0, education: 0, certifications: 0 });
    expect(second.body.skipped).toEqual({ skills: 2, experiences: 1, education: 1, certifications: 0 });
    expect(second.body.profile.bio).toBe('Mechanic with ten years of experience.');
    expect(await prisma.auditLog.count({ where: { actorId: w.id, action: 'cv.applied' } })).toBe(2);
  });

  it('validates what is saved and is for workers only', async () => {
    const w = await signUp('WORKER');
    const e = await signUp('EMPLOYER');
    expect((await apply(e.token, {})).status).toBe(403);
    expect((await request(app).post('/api/v1/workers/me/cv/apply').send({})).status).toBe(401);
    expect((await analyze(e.token)).status).toBe(403);
    const bad: [string, unknown][] = [
      ['unknown skill', { skills: [{ skillId: '00000000-0000-4000-8000-000000000000', proficiency: 3 }] }],
      ['bad proficiency', { skills: [{ skillId: skill['welding'], proficiency: 9 }] }],
      ['bad education level', { education: [{ level: 'WIZARD' }] }],
      ['experience dates reversed', { experiences: [{ title: 'Driver', startDate: '2020-01-01', endDate: '2019-01-01' }] }],
      ['too many certificates', { certifications: Array.from({ length: 21 }, (_, i) => ({ name: `Cert ${i}` })) }],
      ['extra field', { source: 'VERIFIED' }],
      ['verified source smuggled in', { skills: [{ skillId: skill['welding'], proficiency: 3, source: 'VERIFIED' }] }],
    ];
    for (const [name, payload] of bad) {
      const r = await apply(w.token, payload);
      expect([400, 404], name).toContain(r.status);
    }
    expect((await request(app).get('/api/v1/workers/me').set(auth(w.token))).body.profile.skills).toHaveLength(0);
  });
});

describe('OCR for photos and scans of a CV', () => {
  const LINES = ['Skills', 'Engine Repair, Brake Systems, Welding', 'Work Experience', 'Senior Mechanic, Adama Auto Garage', 'January 2018 - Present'];

  /** Draw the lines as black text on white, like a photographed or scanned page. */
  function pageImage(type: 'image/png' | 'image/jpeg') {
    const c = createCanvas(1400, 260 + LINES.length * 90);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.font = '44px sans-serif';
    LINES.forEach((l, i) => g.fillText(l, 60, 120 + i * 90));
    return type === 'image/png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg');
  }

  const send = (token: string, buf: Buffer, name: string) => request(app).post('/api/v1/workers/me/cv').set(auth(token)).attach('file', buf, name);
  const analyze = (token: string) => request(app).post('/api/v1/workers/me/cv/analyze').set(auth(token));
  const skillNames = (res: request.Response) => res.body.parsed.skills.map((x: { name: string }) => x.name).sort();

  it('reads a photo of a CV (PNG) and flags that the text came from OCR', async () => {
    const w = await signUp('WORKER');
    expect((await send(w.token, pageImage('image/png'), 'cv.png')).status).toBe(201);
    const res = await analyze(w.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ocr.used).toBe(true);
    expect(skillNames(res)).toEqual(['Brake Systems', 'Engine Repair', 'Welding']);
    expect(res.body.parsed.experiences[0]).toMatchObject({ title: 'Senior Mechanic' });
  }, 60_000);

  it('reads a scanned, image-only PDF', async () => {
    const w = await signUp('WORKER');
    const jpeg = pageImage('image/jpeg');
    const img = createCanvas(1, 1); void img;
    // the JPEG above is 1400 wide; its height follows the line count
    const height = 260 + LINES.length * 90;
    expect((await send(w.token, scannedPdf(jpeg, 1400, height), 'scan.pdf')).status).toBe(201);
    const res = await analyze(w.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ocr.used).toBe(true);
    expect(skillNames(res)).toEqual(['Brake Systems', 'Engine Repair', 'Welding']);
  }, 90_000);

  it('does not use OCR for a normal text PDF', async () => {
    const w = await signUp('WORKER');
    await send(w.token, makePdf(['Skills', 'Engine Repair, Brake Systems, Welding', 'Work Experience', 'Senior Mechanic, Adama Auto Garage', 'January 2018 - Present']), 'cv.pdf');
    const res = await analyze(w.token);
    expect(res.status).toBe(200);
    expect(res.body.ocr.used).toBe(false);
  });

  it('says so when a picture has no readable text', async () => {
    const w = await signUp('WORKER');
    const c = createCanvas(600, 300);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 600, 300);
    await send(w.token, c.toBuffer('image/png'), 'blank.png');
    const res = await analyze(w.token);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_TEXT');
  }, 60_000);
});
