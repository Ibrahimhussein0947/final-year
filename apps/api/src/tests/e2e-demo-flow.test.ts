/**
 * The project's core demonstration, end to end through the real HTTP API and database:
 * worker registers and imports a CV -> employer registers, has the job text analysed and publishes ->
 * the platform recommends the worker with an explanation -> the worker gets recommended jobs and applies ->
 * the employer shortlists, chats, and hires -> both sides' analytics reflect it.
 */
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { makePdf } from './helpers/pdf';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function signUp(role: 'WORKER' | 'EMPLOYER', fullName: string) {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Demo ${randomUUID().slice(0, 6)}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string, phone: res.body.user.phone as string };
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('worker -> employer -> match -> apply -> hire', () => {
  it('runs the whole journey', async () => {
    // 1. A worker registers and imports skills from a PDF CV (always marked self-reported).
    const worker = await signUp('WORKER', 'Abebe Test Mechanic');
    const cv = makePdf([
      'Abebe Test', 'Professional Summary', 'Vehicle mechanic with six years of experience in garages in Adama.',
      'Skills', 'Engine repair, automotive diagnostics, brake systems',
      'Work Experience', 'Mechanic - Adama Garage', 'March 2019 - Present', 'Overhaul of engines and fault finding on minibuses.',
      'Education', 'TVET Certificate in Automotive Technology 2018',
    ]);
    expect((await request(app).post('/api/v1/workers/me/cv').set(auth(worker.token)).attach('file', cv, { filename: 'cv.pdf', contentType: 'application/pdf' })).status).toBe(201);
    const analysis = await request(app).post('/api/v1/workers/me/cv/analyze').set(auth(worker.token));
    expect(analysis.status, JSON.stringify(analysis.body)).toBe(200);
    const found: string[] = analysis.body.parsed.skills.map((s: any) => s.name);
    expect(found.join(' ')).toMatch(/Engine Repair/i);
    const applied = await request(app).post('/api/v1/workers/me/cv/apply').set(auth(worker.token)).send({
      skills: analysis.body.parsed.skills.map((s: any) => ({ skillId: s.skillId, proficiency: 4 })),
      experiences: [], education: [], certifications: [], yearsExperience: 6,
    });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const profileSkills = applied.body.profile.skills as { source: string; name?: string; skill?: { nameEn: string } }[];
    expect(profileSkills.length).toBeGreaterThan(0);
    expect(profileSkills.every((s) => s.source === 'SELF_REPORTED')).toBe(true);
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } });
    await request(app).patch('/api/v1/workers/me').set(auth(worker.token)).send({ categoryId: category.id, availability: 'IMMEDIATELY' });

    // 2. An employer registers; the platform analyses the job text and the employer reviews the suggestions.
    const employer = await signUp('EMPLOYER', 'Test Employer');
    const description = 'We need a vehicle mechanic for our garage in Adama. Required: engine repair and automotive diagnostics. Brake systems is an advantage. At least 3 years of experience. Full time position, apply with your references.';
    const ai = await request(app).post('/api/v1/analysis/job').set(auth(employer.token)).send({ title: 'Vehicle mechanic', description });
    expect(ai.status, JSON.stringify(ai.body)).toBe(200);
    const analysed = ai.body.analysis;
    const req = analysed.skills.filter((s: any) => s.importance === 'REQUIRED').map((s: any) => s.name).join(' ');
    expect(req).toMatch(/Engine Repair/i);
    expect(analysed.minExperienceYears?.value).toBe(3);

    const zone = await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } });
    const create = await request(app).post('/api/v1/jobs').set(auth(employer.token)).send({
      title: 'Vehicle mechanic', description, categoryId: analysed.category?.value?.id ?? category.id, employmentType: 'FULL_TIME',
      deadline: future(30), locationId: zone.id, minExperienceYears: 3, extractionReviewed: true,
      skills: analysed.skills.map((s: any) => ({ skillId: s.skillId, importance: s.importance })),
    });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const jobId = create.body.job.id as string;
    expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set(auth(employer.token)).send({})).status).toBe(200);

    // 3. The platform recommends the worker to the employer, with a readable, honest explanation.
    const rec = await request(app).get(`/api/v1/jobs/${jobId}/recommended-workers`).set(auth(employer.token));
    expect(rec.status).toBe(200);
    const hit = rec.body.items.find((i: any) => JSON.stringify(i).includes('Abebe'));
    expect(hit, 'the matching worker should be recommended').toBeTruthy();
    expect(hit.match.score).toBeGreaterThanOrEqual(60);
    expect(hit.match.explanation).toMatch(/required skill/i);
    expect(hit.match.engineVersion).toMatch(/^rules-/); // no AI service in the test: reported honestly
    expect(JSON.stringify(rec.body)).not.toContain(worker.phone); // no contact details in recommendations

    // 4. The worker sees the job among their recommendations and applies.
    const mine = await request(app).get('/api/v1/recommendations/jobs').set(auth(worker.token));
    expect(mine.status).toBe(200);
    expect(mine.body.items.some((i: any) => i.job.id === jobId)).toBe(true);
    const apply = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(worker.token)).send({});
    expect(apply.status, JSON.stringify(apply.body)).toBe(201);
    const applicationId = apply.body.applicationId as string;
    expect((await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(worker.token)).send({})).status).toBeGreaterThanOrEqual(400); // no duplicates

    // 5. The employer reviews: phone hidden, then shortlists, chats, and hires.
    const view = await request(app).get(`/api/v1/applications/${applicationId}`).set(auth(employer.token));
    expect(JSON.stringify(view.body)).not.toContain(worker.phone);
    expect((await request(app).patch(`/api/v1/applications/${applicationId}/status`).set(auth(employer.token)).send({ status: 'SHORTLISTED' })).status).toBe(200);
    expect(JSON.stringify((await request(app).get(`/api/v1/applications/${applicationId}`).set(auth(employer.token))).body)).toMatch(/09\d{8}|\+2519\d{8}/);
    const conv = (await request(app).post(`/api/v1/applications/${applicationId}/conversation`).set(auth(employer.token))).body.conversationId as string;
    expect((await request(app).post(`/api/v1/conversations/${conv}/messages`).set(auth(employer.token)).send({ body: 'Please come for an interview on Monday.' })).status).toBe(201);
    const inbox = await request(app).get('/api/v1/notifications').set(auth(worker.token));
    expect(JSON.stringify(inbox.body)).toMatch(/shortlist/i);
    expect((await request(app).patch(`/api/v1/applications/${applicationId}/status`).set(auth(employer.token)).send({ status: 'ACCEPTED' })).status).toBe(200);

    // 6. Outcomes are recorded and shown, and the match snapshot kept at the time of applying.
    const stored = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.status).toBe('ACCEPTED');
    expect((stored.matchSnapshot as { score?: number } | null)?.score).toBeGreaterThanOrEqual(60); // the score seen at the time of applying is kept
    const feedback = await prisma.recommendationFeedback.findMany({ where: { recommendation: { jobId } }, select: { action: true } });
    expect(feedback.map((f) => f.action)).toEqual(expect.arrayContaining(['APPLIED', 'SHORTLISTED', 'HIRED']));
    const wa = await request(app).get('/api/v1/analytics/worker').set(auth(worker.token));
    expect(wa.body.applications.total).toBe(1);
    const ea = await request(app).get('/api/v1/analytics/employer').set(auth(employer.token));
    expect(ea.body.funnel.hired).toBe(1);
  });
});
