import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import {
  hiringPerformance, buildAutoApply, buildByCategory, buildFunnel, buildMatchQuality, buildTiming, furthestStage, quantile, weekStart, weeklySeries,
  type PerfApp, type PerfEvent,
} from '../modules/analytics/performance';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const DAY = 86_400_000;
const T0 = new Date('2026-03-02T10:00:00Z'); // a Monday
const at = (days: number) => new Date(T0.getTime() + days * DAY);
let n = 0;
function app(over: Omit<Partial<PerfApp>, 'events'> & { events?: [PerfEvent['to'], number][] } = {}): PerfApp {
  const { events, ...rest } = over;
  return {
    id: `a${n++}`, createdAt: T0, status: 'PENDING', autoApplied: false, score: null, category: 'Welding', jobId: 'job1', jobPublishedAt: null,
    events: (events ?? []).map(([to, d]) => ({ to, at: at(d) })), ...rest,
  };
}
const many = (count: number, make: (i: number) => PerfApp) => Array.from({ length: count }, (_, i) => make(i));

describe('quantile', () => {
  it('interpolates and handles empty input', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 10], 0.75)).toBe(4);
    expect(quantile([10, 1, 3], 0.5)).toBe(3); // unsorted input
  });
});

describe('funnel', () => {
  it('uses the furthest stage ever reached, so a later rejection still counts as progress', () => {
    expect(furthestStage(app({ status: 'REJECTED', events: [['UNDER_REVIEW', 1], ['SHORTLISTED', 2], ['REJECTED', 5]] }))).toBe(2);
    expect(furthestStage(app({ status: 'WITHDRAWN', events: [['WITHDRAWN', 1]] }))).toBe(0);
    expect(furthestStage(app({ status: 'ACCEPTED' }))).toBe(4); // current status counts even without history
    expect(furthestStage(app({ status: 'PENDING' }))).toBe(0);
  });

  it('counts each stage cumulatively and reports drop-off between stages', () => {
    const apps = [
      app({ status: 'PENDING' }),
      app({ status: 'PENDING' }),
      app({ status: 'UNDER_REVIEW', events: [['UNDER_REVIEW', 1]] }),
      app({ status: 'REJECTED', events: [['UNDER_REVIEW', 1], ['REJECTED', 2]] }),
      app({ status: 'SHORTLISTED', events: [['UNDER_REVIEW', 1], ['SHORTLISTED', 2]] }),
      app({ status: 'INTERVIEW_SCHEDULED', events: [['SHORTLISTED', 1], ['INTERVIEW_SCHEDULED', 2]] }),
      app({ status: 'ACCEPTED', events: [['SHORTLISTED', 1], ['INTERVIEW_SCHEDULED', 2], ['ACCEPTED', 3]] }),
      app({ status: 'WITHDRAWN', events: [['WITHDRAWN', 1]] }),
    ];
    const f = buildFunnel(apps);
    expect(f.stages.map((s) => [s.stage, s.applications])).toEqual([['Applied', 8], ['Reviewed', 5], ['Shortlisted', 3], ['Interview', 2], ['Hired', 1]]);
    expect(f.stages[0]).toMatchObject({ pctOfApplied: 100, pctOfPrevious: null });
    expect(f.stages[1]).toMatchObject({ pctOfApplied: 62.5, pctOfPrevious: 62.5 });
    expect(f.stages[2]).toMatchObject({ pctOfApplied: 37.5, pctOfPrevious: 60 });
    expect(f.stages[4]).toMatchObject({ pctOfApplied: 12.5, pctOfPrevious: 50 });
    expect(f.current).toEqual({ open: 5, hired: 1, rejected: 1, withdrawn: 1 });
    // never increases from one stage to the next
    f.stages.reduce((prev, s) => { expect(s.applications).toBeLessThanOrEqual(prev); return s.applications; }, Infinity);
  });

  it('copes with no applications', () => {
    const f = buildFunnel([]);
    expect(f.stages.every((s) => s.applications === 0 && s.pctOfApplied === null)).toBe(true);
  });
});

describe('timing', () => {
  const now = at(30);

  it('measures first response and time to hire, hiding groups under five', () => {
    const few = [app({ status: 'ACCEPTED', events: [['UNDER_REVIEW', 2], ['ACCEPTED', 6]] })];
    const t = buildTiming(few, now);
    expect(t.firstResponse).toEqual({ n: 1, medianDays: null, p75Days: null });
    expect(t.applicationToHire.medianDays).toBeNull();

    const apps = many(5, (i) => app({ status: 'ACCEPTED', events: [['UNDER_REVIEW', i + 1], ['ACCEPTED', 10 + i]] }));
    const full = buildTiming(apps, now);
    expect(full.firstResponse).toEqual({ n: 5, medianDays: 3, p75Days: 4 }); // 1,2,3,4,5
    expect(full.applicationToHire).toEqual({ n: 5, medianDays: 12, p75Days: 13 }); // 10..14
  });

  it('ignores a withdrawal as an employer response and a PENDING event', () => {
    const apps = many(5, () => app({ status: 'WITHDRAWN', events: [['PENDING', 0], ['WITHDRAWN', 1]] }));
    expect(buildTiming(apps, now).firstResponse.n).toBe(0);
  });

  it('measures time to fill from publishing to the first hire of each job', () => {
    const published = at(-4);
    const apps = [
      // job A has two hires: only the first counts (day 6 - published day -4 = 10 days)
      ...many(5, (i) => app({ jobId: `J${i}`, jobPublishedAt: published, status: 'ACCEPTED', events: [['ACCEPTED', 6]] })),
      app({ jobId: 'J0', jobPublishedAt: published, status: 'ACCEPTED', events: [['ACCEPTED', 20]] }),
    ];
    const t = buildTiming(apps, now).jobTimeToFill;
    expect(t).toEqual({ n: 5, medianDays: 10, p75Days: 10 });
  });

  it('counts applications nobody answered after a week', () => {
    const young = app({ createdAt: at(28) }); // 2 days old: not counted
    const old = [
      ...many(3, () => app({ status: 'PENDING' })),
      ...many(2, () => app({ status: 'UNDER_REVIEW' })),
    ];
    const t = buildTiming([young, ...old], now).unansweredAfter7Days;
    expect(t).toEqual({ applications: 3, outOf: 5, pct: 60 });
    expect(buildTiming(old.slice(0, 2), now).unansweredAfter7Days).toEqual({ applications: null, outOf: 2, pct: null });
  });
});

describe('by category and match quality', () => {
  it('suppresses small categories and ranks the rest by volume', () => {
    const apps = [
      ...many(6, (i) => app({ category: 'Welding', status: i < 3 ? 'ACCEPTED' : 'REJECTED', events: i < 3 ? [['ACCEPTED', 4]] : [] })),
      ...many(2, () => app({ category: 'Cooking', status: 'ACCEPTED', events: [['ACCEPTED', 1]] })),
    ];
    const rows = buildByCategory(apps);
    expect(rows[0]).toEqual({ category: 'Welding', applications: 6, hired: 3, hireRatePct: 50, medianDaysToHire: null }); // only 3 hires: time hidden
    expect(rows[1]).toEqual({ category: 'Cooking', applications: null, hired: null, hireRatePct: null, medianDaysToHire: null });
  });

  it('compares scores of hired and rejected people and the hire rate per score band', () => {
    const apps = [
      ...many(5, () => app({ score: 90, status: 'ACCEPTED' })),
      ...many(5, () => app({ score: 50, status: 'REJECTED' })),
      ...many(5, (i) => app({ score: 85, status: i === 0 ? 'ACCEPTED' : 'REJECTED' })),
      app({ score: null, status: 'ACCEPTED' }), // no snapshot: ignored
      app({ score: 70, status: 'PENDING' }), // undecided: ignored
    ];
    const q = buildMatchQuality(apps);
    expect(q.decidedWithScore).toBe(15);
    expect(q.averageScoreHired).toBe(89.2); // (5*90 + 85) / 6
    expect(q.averageScoreRejected).toBe(65.6); // (5*50 + 4*85) / 9
  });

  it('reports hire rate by band with the small bands hidden', () => {
    const apps = [
      ...many(6, (i) => app({ score: 90, status: i < 3 ? 'ACCEPTED' : 'REJECTED' })),
      ...many(2, () => app({ score: 20, status: 'REJECTED' })),
    ];
    const bands = buildMatchQuality(apps).byScoreBand;
    expect(bands.find((b) => b.band === '80 to 100')).toEqual({ band: '80 to 100', decided: 6, hiredPct: 50 });
    expect(bands.find((b) => b.band === 'Below 60')).toEqual({ band: 'Below 60', decided: null, hiredPct: null });
    expect(bands.map((b) => b.band)).toEqual(['Below 60', '60 to 79', '80 to 100']);
  });

  it('compares automatic and manual applications', () => {
    const apps = [
      ...many(5, (i) => app({ autoApplied: true, status: i === 0 ? 'ACCEPTED' : 'REJECTED' })),
      ...many(5, () => app({ autoApplied: false, status: 'ACCEPTED' })),
    ];
    expect(buildAutoApply(apps)).toEqual({ shareOfApplicationsPct: 50, auto: { decided: 5, hiredPct: 20 }, manual: { decided: 5, hiredPct: 100 } });
  });
});

describe('weekly series', () => {
  it('buckets by Monday-start weeks, oldest first, and ignores dates outside the range', () => {
    expect(weekStart(new Date('2026-03-08T23:59:00Z')).toISOString().slice(0, 10)).toBe('2026-03-02'); // Sunday belongs to the week of the Monday before
    expect(weekStart(new Date('2026-03-09T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-03-09');
    const now = new Date('2026-03-18T12:00:00Z'); // Wednesday of the week starting 03-16
    const series = weeklySeries(
      [new Date('2026-03-16T00:00:00Z'), new Date('2026-03-17T09:00:00Z'), new Date('2026-03-09T09:00:00Z'), new Date('2026-02-20T09:00:00Z'), new Date('2026-03-25T09:00:00Z')],
      3, now,
    );
    expect(series).toEqual([
      { weekStart: '2026-03-02', count: 0 },
      { weekStart: '2026-03-09', count: 1 },
      { weekStart: '2026-03-16', count: 2 },
    ]); // 02-20 is too old and 03-25 is in the future
  });
});

// ───────── The route ─────────

const app_ = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
let adminToken = '';
let workerToken = '';

async function signUp(role: 'WORKER' | 'EMPLOYER') {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app_).post('/api/v1/auth/register').send({
    fullName: 'Test Perf', phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Perf ${randomUUID().slice(0, 8)}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}
beforeAll(async () => {
  workerToken = await signUp('WORKER');
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  await prisma.user.create({ data: { fullName: 'Test Admin', phone: `+251${p.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  adminToken = (await request(app_).post('/api/v1/auth/login').send({ phone: p, password: 'Passw0rdTest' })).body.accessToken;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.employerProfile.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('hiringPerformance with real rows', () => {
  it('reads applications, status history and match snapshots from the database', async () => {
    const now = new Date();
    const ago = (d: number) => new Date(now.getTime() - d * DAY);
    const employerToken = await signUp('EMPLOYER');
    const me = (await request(app_).get('/api/v1/auth/me').set(auth(employerToken))).body.user;
    const org = await prisma.organization.findFirstOrThrow({ where: { id: me.organization.id } });
    await prisma.organization.update({ where: { id: org.id }, data: { name: `TEST_ORG PerfData ${randomUUID().slice(0, 8)}` } });
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } });
    const job = await prisma.job.create({
      data: {
        organizationId: org.id, postedById: me.id, title: 'Perf job', description: `Perf ${randomUUID()}`, categoryId: category.id, employmentType: 'FULL_TIME',
        languages: [], status: 'ACTIVE', publishedAt: ago(20), descriptionHash: randomUUID(),
      },
    });

    // [final status, score, auto-applied, [status change, days after applying][]]
    type Spec = [ApplicationStatusLike, number | null, boolean, [ApplicationStatusLike, number][]];
    const specs: Spec[] = [
      ['ACCEPTED', 90, false, [['UNDER_REVIEW', 1], ['SHORTLISTED', 2], ['INTERVIEW_SCHEDULED', 3], ['ACCEPTED', 5]]],
      ['REJECTED', 40, false, [['UNDER_REVIEW', 2], ['REJECTED', 4]]],
      ['SHORTLISTED', 75, false, [['UNDER_REVIEW', 1], ['SHORTLISTED', 3]]],
      ['PENDING', 60, false, []],
      ['WITHDRAWN', null, true, [['WITHDRAWN', 1]]],
      ['UNDER_REVIEW', 55, false, [['UNDER_REVIEW', 4]]],
      ['SHORTLISTED', 70, false, [['UNDER_REVIEW', 2], ['SHORTLISTED', 4]]],
      ['UNDER_REVIEW', 65, false, [['UNDER_REVIEW', 3]]],
    ];
    for (const [status, score, autoApplied, events] of specs) {
      const w = await signUp('WORKER');
      const wp = await prisma.workerProfile.findFirstOrThrow({ where: { user: { id: (await request(app_).get('/api/v1/auth/me').set(auth(w))).body.user.id } } });
      const created = ago(15);
      const row = await prisma.application.create({
        data: { jobId: job.id, workerId: wp.id, status, autoApplied, createdAt: created, ...(score === null ? {} : { matchSnapshot: { score } }) },
      });
      await prisma.applicationStatusHistory.createMany({
        data: [
          { applicationId: row.id, fromStatus: null, toStatus: 'PENDING' as const, createdAt: created },
          ...events.map(([to, d]) => ({ applicationId: row.id, fromStatus: null, toStatus: to, createdAt: new Date(created.getTime() + d * DAY) })),
        ],
      });
    }

    const scope = { job: { organizationId: org.id } };
    const r = await hiringPerformance(90, now, scope);
    expect(r.applicationsInWindow).toBe(8);
    // reached at least: applied 8; reviewed 6 (all but the pending and the withdrawn); shortlisted 3; interview 1; hired 1
    expect(r.funnel.stages.map((s) => s.applications)).toEqual([8, 6, 3, 1, 1]);
    expect(r.funnel.stages[2]).toMatchObject({ pctOfApplied: 37.5, pctOfPrevious: 50 });
    expect(r.funnel.current).toEqual({ open: 5, hired: 1, rejected: 1, withdrawn: 1 });
    // first answers in days: 1, 2, 1, (none for pending and withdrawn), 4, 2, 3 -> sorted 1,1,2,2,3,4
    expect(r.timing.firstResponse).toMatchObject({ n: 6, medianDays: 2, p75Days: 2.8 });
    expect(r.timing.applicationToHire).toMatchObject({ n: 1, medianDays: null }); // one hire: hidden
    // all eight are older than a week and one is still pending; the group is big enough to show
    expect(r.timing.unansweredAfter7Days).toEqual({ applications: 1, outOf: 8, pct: 12.5 });
    expect(r.byCategory).toEqual([{ category: category.nameEn, applications: 8, hired: 1, hireRatePct: 12.5, medianDaysToHire: null }]);
    expect(r.matchQuality.decidedWithScore).toBe(2);
    expect(r.matchQuality.averageScoreHired).toBeNull();
    expect(r.autoApply.shareOfApplicationsPct).toBe(12.5);
    // created 15 days ago: inside the last four weekly buckets whatever day of the week it is today
    expect(r.growth.applications.slice(-4).reduce((s, w) => s + w.count, 0)).toBeGreaterThanOrEqual(8);

    await prisma.job.deleteMany({ where: { id: job.id } }); // applications and history go with the job
  });
});

type ApplicationStatusLike = PerfApp['status'];

describe('GET /admin/analytics/performance', () => {
  it('is for administrators only', async () => {
    expect((await request(app_).get('/api/v1/admin/analytics/performance')).status).toBe(401);
    expect((await request(app_).get('/api/v1/admin/analytics/performance').set(auth(workerToken))).status).toBe(403);
  });

  it('returns the full report, with weekly growth that includes the users just created', async () => {
    const res = await request(app_).get('/api/v1/admin/analytics/performance').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ windowDays: 90, truncated: false });
    expect(res.body.funnel.stages.map((s: { stage: string }) => s.stage)).toEqual(['Applied', 'Reviewed', 'Shortlisted', 'Interview', 'Hired']);
    expect(Object.keys(res.body.timing)).toEqual(['firstResponse', 'applicationToHire', 'jobTimeToFill', 'unansweredAfter7Days']);
    expect(res.body.growth.newWorkers).toHaveLength(12);
    const thisWeek = res.body.growth.newWorkers.at(-1);
    expect(thisWeek.count).toBeGreaterThanOrEqual(1);
    expect(thisWeek.weekStart).toBe(weekStart(new Date()).toISOString().slice(0, 10));
    expect(res.body.caveats.length).toBeGreaterThan(2);
  });

  it('accepts only the supported windows', async () => {
    for (const d of [30, 90, 365]) {
      expect((await request(app_).get(`/api/v1/admin/analytics/performance?days=${d}`).set(auth(adminToken))).body.windowDays).toBe(d);
    }
    expect((await request(app_).get('/api/v1/admin/analytics/performance?days=7').set(auth(adminToken))).status).toBe(400);
    expect((await request(app_).get('/api/v1/admin/analytics/performance?days=abc').set(auth(adminToken))).status).toBe(400);
  });
});
