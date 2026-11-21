import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { reviewApplicant, reviewJobPost, reviewProfile, workTimeline, type JobPostInput, type ProfileInput } from '../modules/review/rules';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const NOW = new Date('2026-06-01T00:00:00Z');
const LEVELS = ['fix', 'improve', 'good'];
const ids = (r: { findings: { id: string; level: string }[] }, level?: string) => r.findings.filter((f) => !level || f.level === level).map((f) => f.id);

const goodProfile: ProfileInput = {
  headline: 'Experienced minibus mechanic in Adama',
  bio: 'Mechanic with 6 years of work on light vehicles and trucks. I repair engines and brakes and train new apprentices.',
  yearsExperience: 6,
  skills: [{ years: 6 }, { years: 4 }, { years: null }],
  experiences: [{ title: 'Mechanic', startDate: '2020-01-01', endDate: null, description: 'Engine and brake repair.', achievements: 'Cut repair time by a third.' }],
  educationCount: 1, certifications: [{ issuer: 'TVET' }], activityCount: 0,
  languages: ['Amharic'], languageLevels: { Amharic: 'FLUENT' }, hasCv: true, hasPhoto: true,
};

describe('profile review rules', () => {
  it('finds nothing to fix in a complete profile', () => {
    const r = reviewProfile(goodProfile, NOW);
    expect(r.counts.fix).toBe(0);
    expect(r.counts.improve).toBe(0);
    expect(ids(r, 'good')).toContain('headline');
    expect(r.note).toMatch(/not by a language model/);
  });

  it('flags the essentials of an empty profile as things to fix, and lists them first', () => {
    const r = reviewProfile({ ...goodProfile, headline: null, bio: null, skills: [], experiences: [], educationCount: 0, certifications: [], hasCv: false, hasPhoto: false }, NOW);
    expect(ids(r, 'fix')).toEqual(expect.arrayContaining(['headline', 'bio', 'skills', 'background']));
    expect(r.findings[0].level).toBe('fix');
    const ranks = r.findings.map((f) => LEVELS.indexOf(f.level));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('catches contact details, shouting, vague headlines and bios without numbers', () => {
    const r = reviewProfile({ ...goodProfile, headline: 'worker', bio: 'I AM A VERY GOOD AND HARD WORKING PERSON CALL ME ON 0911223344 ANYTIME' }, NOW);
    expect(ids(r)).toEqual(expect.arrayContaining(['contact-in-text', 'headline', 'bio-caps']));
    expect(ids(r, 'fix')).toContain('contact-in-text');
    expect(ids(reviewProfile({ ...goodProfile, bio: 'A hard working mechanic who finishes jobs on time and treats customers with respect.' }, NOW))).toContain('bio-numbers');
  });

  it('compares claimed years with the jobs listed, and reports gaps without blaming', () => {
    const jobs = [
      { title: 'Welder', startDate: '2012-01-01', endDate: '2013-01-01', description: 'x', achievements: 'y' },
      { title: 'Mechanic', startDate: '2016-01-01', endDate: '2017-01-01', description: 'x', achievements: 'y' },
    ];
    const r = reviewProfile({ ...goodProfile, yearsExperience: 12, experiences: jobs }, NOW);
    expect(ids(r)).toEqual(expect.arrayContaining(['years-mismatch', 'gap-Welder']));
    const gap = r.findings.find((f) => f.id === 'gap-Welder')!;
    expect(gap.text).toMatch(/not a problem when it is explained/);
    expect(gap.level).toBe('improve'); // never "fix"
  });

  it('counts overlapping jobs once', () => {
    const t = workTimeline([
      { title: 'A', startDate: '2020-01-01', endDate: '2021-01-01' },
      { title: 'B', startDate: '2020-06-01', endDate: '2021-06-01' },
    ], NOW);
    expect(t.coveredMonths).toBe(17); // Jan 2020 to Jun 2021, not 12 + 12
    expect(t.gaps).toEqual([]);
  });
});

const goodJob: JobPostInput = {
  title: 'Experienced welder, Adama',
  description: 'Duties\nWeld steel gates and frames in our workshop.\nRequirements\nTwo years of welding. Own basic tools.\nWe offer\nA stable job, lunch and transport, working with a friendly team that values careful work.',
  salaryMin: 8000, salaryMax: 12000, deadline: '2026-07-01', skillCount: 3, requiredSkillCount: 2, hasLocation: true, schedule: 'Mon-Sat, 8:00 to 17:00', benefits: 'Lunch', minExperienceYears: 2, remote: false,
};

describe('job post review rules', () => {
  it('has nothing to fix in a clear post', () => {
    const r = reviewJobPost(goodJob);
    expect(r.counts.fix).toBe(0);
    expect(r.counts.improve).toBe(0);
  });

  it('reuses the bias and scam checks, so problems show before publishing', () => {
    const r = reviewJobPost({ ...goodJob, description: `${goodJob.description}\nWomen only. Pay a registration fee of 500 birr to apply.` });
    expect(ids(r, 'fix')).toEqual(expect.arrayContaining(['bias', 'scam-UPFRONT_FEE']));
    expect(r.findings.find((f) => f.id === 'bias')!.text.toLowerCase()).toContain('women');
  });

  it('suggests clearer titles, pay, skills, place, deadline and consistent experience', () => {
    const r = reviewJobPost({
      ...goodJob, title: 'URGENT HIRING NOW!!!', description: 'We need a person to do the work, etc. and any other duties as required, etc.',
      salaryMin: null, salaryMax: null, deadline: null, skillCount: 0, requiredSkillCount: 0, hasLocation: false, schedule: null, minExperienceYears: 5,
    });
    expect(ids(r, 'improve')).toEqual(expect.arrayContaining(['title', 'length', 'vague', 'skills', 'pay', 'location', 'deadline', 'schedule']));
    expect(ids(reviewJobPost({ ...goodJob, title: 'Junior welder trainee', minExperienceYears: 5 }), 'improve')).toContain('experience');
  });

  it('does not ask a remote job for a place or schedule', () => {
    const r = reviewJobPost({ ...goodJob, hasLocation: false, schedule: null, remote: true });
    expect(ids(r)).not.toContain('location');
    expect(ids(r)).not.toContain('schedule');
  });
});

describe('applicant review rules', () => {
  const match = {
    score: 70, confidence: 0.9, eligibility: 'eligible',
    matchedSkills: ['Welding'], missingSkills: ['Brake Systems', 'Engine Repair'],
    requiredCoverage: { required: 3, covered: 1 },
    components: { experience: { score: 0.3, note: '1 year of relevant experience (job asks for 4)' }, location: { score: 1, note: 'same zone' } },
    criteria: { met: [{ label: 'Driving licence' }], unmet: [{ label: 'Night shifts', mustHave: true }], unknown: [{ label: 'Own tools', mustHave: false }] },
  };

  it('lists strengths, gaps and interview questions from the match, and carries a fairness note', () => {
    const r = reviewApplicant({ match, coverNote: null, jobs: [], hasCv: false }, NOW);
    expect(r.strengths.join(' ')).toContain('Covers 1 of 3 required skills');
    expect(r.strengths.join(' ')).toContain('Good fit on location');
    expect(r.gaps.join(' ')).toContain('Brake Systems');
    expect(r.gaps.join(' ')).toContain('Must-have not met: Night shifts');
    expect(r.gaps).toContain('No CV is attached.');
    expect(r.questions.join(' ')).toContain('Have you worked with Brake Systems');
    expect(r.questions.join(' ')).toContain('more experience');
    expect(r.questions.length).toBeLessThanOrEqual(6);
    expect(r.note).toMatch(/not a reason to reject/);
  });

  it('asks about a long gap neutrally and handles a missing match', () => {
    const r = reviewApplicant({
      match: null, coverNote: 'I would like this job because it is close to my home and I have done similar work before.', hasCv: true,
      jobs: [{ title: 'Welder', startDate: '2012-01-01', endDate: '2013-01-01' }, { title: 'Mechanic', startDate: '2016-01-01', endDate: null }],
    }, NOW);
    expect(r.gaps).toContain('No match score is available for this application.');
    expect(r.questions.join(' ')).toContain('Ask neutrally');
    expect(r.strengths).toContain('Wrote a real cover note.');
  });
});

// ───────── The routes ─────────

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Review ${randomUUID().slice(0, 8)}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let categoryId = '';
let adamaId = '';
let skillIds: string[] = [];
beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  adamaId = (await prisma.location.findFirstOrThrow({ where: { level: 'ZONE', nameEn: 'Adama' } })).id;
  skillIds = (await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems'] } }, orderBy: { slug: 'asc' } })).map((s) => s.id);
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('review routes', () => {
  it("reviews a worker's own profile, and only a worker may ask", async () => {
    const w = await signUp('WORKER');
    const e = await signUp('EMPLOYER');
    const ok = await request(app).get('/api/v1/review/profile').set(auth(w.token));
    expect(ok.status).toBe(200);
    expect(ok.body.review.method).toBe('review-rules-1.0');
    expect(ok.body.review.findings.map((f: { id: string }) => f.id)).toEqual(expect.arrayContaining(['headline', 'bio', 'skills']));
    expect((await request(app).get('/api/v1/review/profile').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/review/profile')).status).toBe(401);
  });

  it('reviews a job draft for an employer without saving anything', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const before = await prisma.job.count({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
    const r = await request(app).post('/api/v1/review/job').set(auth(e.token)).send({
      title: 'Welder', description: 'Weld things. Send a registration fee of 300 birr. Contact us on Telegram.', skillCount: 0,
    });
    expect(r.status).toBe(200);
    expect(r.body.review.findings.map((f: { id: string }) => f.id)).toEqual(expect.arrayContaining(['scam-UPFRONT_FEE', 'skills', 'pay']));
    expect(await prisma.job.count({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } })).toBe(before);
    expect((await request(app).post('/api/v1/review/job').set(auth(w.token)).send({ title: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/v1/review/job').set(auth(e.token)).send({ skillCount: 99 })).status).toBe(400);
  });

  it('reviews an applicant for the employer who owns the job only', async () => {
    const e = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
      title: `Mechanic ${randomUUID().slice(0, 6)}`, description: `Repair vehicles in our garage. ${randomUUID()} ${randomUUID()} Reliable people only, please apply with your experience.`,
      categoryId, employmentType: 'FULL_TIME', locationId: adamaId, deadline: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      skills: skillIds.map((skillId) => ({ skillId, importance: 'REQUIRED' })),
    });
    expect(create.status).toBe(201);
    const jobId = create.body.job.id as string;
    expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set(auth(e.token)).send({})).status).toBe(200);
    const applied = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    expect(applied.status).toBe(201);
    const appId = applied.body.applicationId as string;

    const views = async () => (await prisma.workerProfile.findFirstOrThrow({ where: { userId: w.id } })).profileViews;
    const before = await views();
    const r = await request(app).get(`/api/v1/review/applications/${appId}`).set(auth(e.token));
    expect(r.status).toBe(200);
    expect(r.body.review.gaps.join(' ')).toMatch(/No sign of|None of the required skills/);
    expect(r.body.review.questions.length).toBeGreaterThan(0);
    expect(r.body.review.note).toMatch(/not a reason to reject/);
    expect(await views()).toBe(before); // a review is not a profile view

    expect((await request(app).get(`/api/v1/review/applications/${appId}`).set(auth(other.token))).status).toBe(404);
    expect((await request(app).get(`/api/v1/review/applications/${appId}`).set(auth(w.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/review/applications/not-a-uuid').set(auth(e.token))).status).toBe(404);
  });
});
