import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { extractPdfText } from '../modules/analysis/pdf';
import { renderCv, splitRuns, type CvData } from '../modules/workers/cv';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const base: CvData = {
  lang: 'en',
  name: 'Abebe Kebede',
  headline: 'Automotive mechanic',
  contact: ['+251911223344', 'abebe@example.com', 'Adama, Oromia'],
  summary: 'Mechanic with six years of experience repairing light vehicles and trucks.',
  experiences: [{ title: 'Senior mechanic', employer: 'Adama Motors', period: 'Jan 2019 - Present', description: 'Engine and brake repair for a busy garage.', verified: true }],
  education: [{ title: 'Diploma - Automotive technology', detail: 'Adama Polytechnic · 2018', verified: false }],
  skills: [{ name: 'Engine repair', years: 6, verified: true }, { name: 'Brake systems', years: null, verified: false }],
  certifications: [{ name: 'Safe workshop practice', detail: 'TVET · 2020', verified: false }],
  languages: ['Amharic', 'Afaan Oromoo', 'English'],
};

describe('CV renderer', () => {
  it('produces a real PDF containing the profile text and marks only verified items', async () => {
    const pdf = await renderCv(base);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const { text, pages } = await extractPdfText(pdf);
    expect(pages).toBe(1);
    for (const s of ['Abebe Kebede', 'Automotive mechanic', '+251911223344', 'Adama Motors', 'Jan 2019 - Present', 'Engine repair', 'Safe workshop practice', 'Afaan Oromoo']) {
      expect(text, s).toContain(s);
    }
    expect(text).toContain('[Verified]'); // the verified experience
    expect(text.match(/\[Verified\]/g)).toHaveLength(1); // nothing self-reported is marked
  });

  it('draws Amharic text with the embedded Ethiopic font, including mixed Amharic and Latin text', async () => {
    const pdf = await renderCv({
      ...base, lang: 'am', name: 'አበበ ከበደ', headline: 'መካኒክ in Adama', summary: 'ስድስት ዓመት የሥራ ልምድ ያለው መካኒክ።',
      education: [], certifications: [], experiences: [], skills: [{ name: 'የሞተር ጥገና', years: 6, verified: false }],
    });
    const { text } = await extractPdfText(pdf);
    expect(text).toContain('አበበ ከበደ');
    expect(text).toContain('መካኒክ');
    expect(text).toContain('Adama');
    expect(text).toContain('ክህሎቶች'.toUpperCase()); // Ethiopic has no case, so the heading is unchanged
    expect(text).toContain('የሞተር ጥገና');
  });

  it('handles a long CV across pages and an almost empty one', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `Role ${i}`, employer: `Employer ${i}`, period: 'Jan 2010 - Dec 2011', description: 'Did a variety of useful work. '.repeat(6), verified: false }));
    const long = await extractPdfText(await renderCv({ ...base, experiences: many }));
    expect(long.pages).toBeGreaterThan(1);
    expect(long.text).toContain('Role 39');

    const bare = await renderCv({ lang: 'en', name: 'Only Name', headline: null, contact: [], summary: null, experiences: [], education: [], skills: [], certifications: [], languages: [] });
    expect(bare.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('lays text out inside the margins, with Amharic words on one shared baseline', async () => {
    const specifier = 'pdfjs-dist/legacy/build/pdf.mjs';
    const pdfjs = (await import(/* @vite-ignore */ specifier)) as { getDocument: (o: object) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str: string; transform: number[]; width: number }[] }> }> }> } };
    const pdf = await renderCv({
      ...base, lang: 'am', name: 'አበበ ከበደ', headline: 'መካኒክ in Adama', summary: 'ስድስት ዓመት የሥራ ልምድ ያለው መካኒክ። '.repeat(8),
      experiences: [], education: [], certifications: [], skills: [],
    });
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((i) => i.str.trim());
    for (const i of items) {
      expect(i.transform[4], i.str).toBeGreaterThanOrEqual(51.9);
      expect(i.transform[4] + i.width, i.str).toBeLessThanOrEqual(595.28 - 52 + 1);
    }
    const name = items.filter((i) => ['አበበ', 'ከበደ'].includes(i.str));
    expect(name).toHaveLength(2);
    expect(name[0].transform[5]).toBeCloseTo(name[1].transform[5], 1); // both name words on one line
    const headline = items.filter((i) => ['መካኒክ', 'Adama'].includes(i.str));
    expect(headline).toHaveLength(2);
    expect(headline[0].transform[5]).toBeCloseTo(headline[1].transform[5], 1); // Ethiopic and Latin share a baseline
    // The long summary wraps onto several lines instead of running off the page.
    expect(new Set(items.filter((i) => i.str === 'ስድስት').map((i) => i.transform[5].toFixed(0))).size).toBeGreaterThan(1);
  });

  it('splits text into script runs', () => {
    expect(splitRuns('Hello አበበ 2024')).toEqual([
      { text: 'Hello ', ethiopic: false },
      { text: 'አበበ', ethiopic: true },
      { text: ' 2024', ethiopic: false },
    ]);
    expect(splitRuns('')).toEqual([]);
  });
});

// ───────── The route ─────────

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let workerToken = '';
let employerToken = '';
let workerId = '';

async function signUp(role: 'WORKER' | 'EMPLOYER') {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Test Cvuser', phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Cv ${randomUUID().slice(0, 8)}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

beforeAll(async () => {
  const w = await signUp('WORKER');
  workerToken = w.token;
  employerToken = (await signUp('EMPLOYER')).token;
  workerId = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } })).id;
  const welding = await prisma.skill.findFirstOrThrow({ where: { slug: 'welding' } });
  await prisma.workerProfile.update({ where: { id: workerId }, data: { headline: 'Welder', bio: 'Reliable welder who finishes on time.', languages: ['Amharic'] } });
  await prisma.workerSkill.create({ data: { workerId, skillId: welding.id, proficiency: 4, years: 3 } });
  await prisma.workExperience.create({ data: { workerId, title: 'Welder', employer: 'Steel Works', startDate: new Date('2020-02-01'), endDate: null, description: 'Metal fabrication.' } });
  await prisma.education.create({ data: { workerId, level: 'VOCATIONAL_CERTIFICATE', field: 'Welding', institution: 'TVET College', year: 2019 } });
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.employerProfile.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('GET /workers/me/cv.pdf', () => {
  it("returns the worker's own profile as a downloadable PDF", async () => {
    const res = await request(app).get('/api/v1/workers/me/cv.pdf').set(auth(workerToken)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toContain('no-store');
    const { text } = await extractPdfText(res.body as Buffer);
    for (const s of ['Test Cvuser', 'Welder', 'Steel Works', 'Feb 2020 - Present', 'Vocational certificate', 'TVET College', 'Amharic']) expect(text, s).toContain(s);
    expect(text).toContain('Welding'); // the skill and the field of study
    expect(await prisma.auditLog.count({ where: { action: 'worker.cv_generated' } })).toBeGreaterThanOrEqual(1);
  });

  it('supports Amharic headings and rejects unknown languages', async () => {
    const am = await request(app).get('/api/v1/workers/me/cv.pdf?lang=am').set(auth(workerToken)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(am.status).toBe(200);
    expect((await extractPdfText(am.body as Buffer)).text).toContain('የሥራ ልምድ');
    expect((await request(app).get('/api/v1/workers/me/cv.pdf?lang=xx').set(auth(workerToken))).status).toBe(400);
  });

  it('is only for signed-in workers', async () => {
    expect((await request(app).get('/api/v1/workers/me/cv.pdf')).status).toBe(401);
    expect((await request(app).get('/api/v1/workers/me/cv.pdf').set(auth(employerToken))).status).toBe(403);
  });
});
