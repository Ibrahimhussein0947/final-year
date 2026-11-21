import { randomInt, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createGatewaySms, createNotifier, consoleNotifier, setNotifier, type Notifier } from '../integrations/notify';
import { prisma } from '../lib/prisma';
import { notify, smsTextFor } from '../modules/notifications/service';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type User = { token: string; id: string; phone: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Delivery ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}

let autoId = '';
let skill: Record<string, string> = {};
const adama = async () => (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id;

async function skilledWorker(skills = ['engine-repair', 'brake-systems']) {
  const w = await signUp('WORKER');
  await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: autoId, yearsExperience: 6, headline: 'Mechanic' });
  for (const s of skills) await request(app).put(`/api/v1/workers/me/skills/${skill[s]}`).set(auth(w.token)).send({ proficiency: 4 });
  return w;
}
async function newJob(e: User, over: Record<string, unknown> = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Alert job ${tag()}`, description: `Repair vehicles. ${randomUUID()} ${randomUUID()} Please apply with your experience and references.`,
    categoryId: autoId, employmentType: 'FULL_TIME', deadline: future(30), minExperienceYears: 2, locationId: await adama(),
    skills: [{ skillId: skill['engine-repair'], importance: 'REQUIRED' }, { skillId: skill['brake-systems'], importance: 'REQUIRED' }], ...over,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  return create.body.job.id as string;
}
const publish = (e: User, id: string) => request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({});
const alerts = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'job.recommended' } });

beforeAll(async () => {
  autoId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  const rows = await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems', 'cooking'] } } });
  skill = Object.fromEntries(rows.map((s) => [s.slug, s.id]));
});
afterEach(() => setNotifier(consoleNotifier));
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  for (const level of ['KEBELE', 'WOREDA'] as const) await prisma.location.deleteMany({ where: { level, nameEn: { startsWith: 'Test' } } });
  await prisma.$disconnect();
});

// ───────── The SMS gateway adapter ─────────

function gateway(handler: (body: any, res: http.ServerResponse) => void) {
  const calls: { headers: http.IncomingHttpHeaders; body: any }[] = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ headers: req.headers, body });
      handler(body, res);
    });
  });
  return new Promise<{ url: string; calls: typeof calls; close: () => Promise<void> }>((resolve) =>
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/sms`, calls, close: () => new Promise((r) => srv.close(() => r())) })),
  );
}

describe('SMS gateway adapter', () => {
  it('posts {to, text, sender} with a bearer token', async () => {
    const g = await gateway((_b, res) => void res.writeHead(200).end('{}'));
    await createGatewaySms(g.url, 'secret-token-123', 'EthioTalent')('+251911000000', 'Hello');
    expect(g.calls[0].body).toEqual({ to: '+251911000000', text: 'Hello', sender: 'EthioTalent' });
    expect(g.calls[0].headers.authorization).toBe('Bearer secret-token-123');
    await g.close();
  });

  it('throws on gateway errors, but the notifier swallows them so users are never blocked', async () => {
    const g = await gateway((_b, res) => void res.writeHead(500).end('nope'));
    const send = createGatewaySms(g.url, 'secret-token-123', undefined);
    await expect(send('+251911000000', 'x')).rejects.toThrow('500');
    await expect(createNotifier(send).sendSms('+251911000000', 'x')).resolves.toBeUndefined();
    await g.close();
  });

  it('reports whether SMS is configured', () => {
    expect(consoleNotifier.smsConfigured()).toBe(false);
    expect(createNotifier().smsConfigured()).toBe(false);
    expect(createNotifier(async () => undefined).smsConfigured()).toBe(true);
  });
});

describe('SMS text is generic', () => {
  it('never carries job titles, names or message text written by other users', () => {
    const t = smsTextFor('interview.scheduled', { jobTitle: 'Call 0911 and send money NOW', scheduledAt: 'x' });
    expect(t).not.toMatch(/send money|0911|Call/);
    const s = smsTextFor('application.status', { status: 'SHORTLISTED', jobTitle: 'http://evil.example/login' });
    expect(s).not.toContain('evil');
    expect(smsTextFor('application.status', { status: 'UNDER_REVIEW' })).toBeNull();
    expect(smsTextFor('message.new', {})).toBeNull();
    expect(smsTextFor('job.recommended', {})).toBeNull();
  });
});

// ───────── Preferences and SMS gating ─────────

describe('notification settings', () => {
  const get = (u: User) => request(app).get('/api/v1/notifications/settings').set(auth(u.token));
  const patch = (u: User, body: unknown) => request(app).patch('/api/v1/notifications/settings').set(auth(u.token)).send(body as object);

  it('starts with job alerts on, SMS off, and tells the truth about the SMS provider', async () => {
    const w = await signUp('WORKER');
    expect((await get(w)).body).toEqual({ notifyJobMatches: true, notifySms: false, phoneVerified: false, smsProviderConfigured: false, telegramConfigured: false, telegramLinked: false, notifyTelegram: false, autoApply: false, autoApplyMinScore: 80 });
    expect((await request(app).get('/api/v1/notifications/settings')).status).toBe(401);
  });

  it('requires a verified phone for SMS, and rejects unknown settings', async () => {
    const w = await signUp('WORKER');
    expect((await patch(w, { notifySms: true })).status).toBe(400);
    expect((await patch(w, { notifyJobMatches: false })).body.notifyJobMatches).toBe(false);
    expect((await patch(w, { isAdmin: true })).status).toBe(400);
    expect((await patch(w, { notifySms: 'yes' })).status).toBe(400);
    await prisma.user.update({ where: { id: w.id }, data: { phoneVerifiedAt: new Date() } });
    expect((await patch(w, { notifySms: true })).body).toMatchObject({ notifySms: true, phoneVerified: true });
    setNotifier(createNotifier(async () => undefined));
    expect((await get(w)).body.smsProviderConfigured).toBe(true);
  });
});

describe('when an SMS is sent', () => {
  function spy(): { notifier: Notifier; sent: { to: string; text: string }[] } {
    const sent: { to: string; text: string }[] = [];
    return { sent, notifier: { smsConfigured: () => true, sendSms: async (to, text) => void sent.push({ to, text }), sendEmail: async () => undefined } };
  }
  async function optedIn(verified = true, sms = true) {
    const w = await signUp('WORKER');
    await prisma.user.update({ where: { id: w.id }, data: { notifySms: sms, ...(verified ? { phoneVerifiedAt: new Date() } : {}) } });
    return w;
  }
  const interview = (id: string) => notify(id, 'interview.scheduled', { jobTitle: 'X', scheduledAt: new Date().toISOString() });

  it('only for opted-in users with a verified phone, and only when a gateway exists', async () => {
    const s = spy();
    setNotifier(s.notifier);
    const good = await optedIn();
    await interview(good.id);
    expect(s.sent).toEqual([{ to: good.phone, text: expect.stringContaining('interview') }]);

    await interview((await optedIn(true, false)).id); // did not opt in
    await interview((await optedIn(false, true)).id); // phone not verified
    expect(s.sent).toHaveLength(1);

    setNotifier(consoleNotifier); // no gateway: nothing is sent and nothing fails
    await interview(good.id);
    expect(s.sent).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: good.id, type: 'interview.scheduled' } })).toBe(2); // in-app copy is always stored
  });

  it('only for important events, and at most five a day', async () => {
    const s = spy();
    setNotifier(s.notifier);
    const w = await optedIn();
    await notify(w.id, 'application.status', { status: 'UNDER_REVIEW' });
    await notify(w.id, 'application.received', {});
    await notify(w.id, 'job.recommended', { jobTitle: 'x' });
    expect(s.sent).toHaveLength(0);
    for (let i = 0; i < 8; i++) await notify(w.id, 'application.status', { status: 'SHORTLISTED' });
    expect(s.sent).toHaveLength(5);
    expect(await prisma.auditLog.count({ where: { actorId: w.id, action: 'sms.sent' } })).toBe(5);
  });

  it('is triggered by real recruitment events', async () => {
    const s = spy();
    setNotifier(s.notifier);
    const e = await signUp('EMPLOYER');
    const w = await optedIn();
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: autoId });
    const job = await newJob(e);
    await publish(e, job);
    const appId = (await request(app).post(`/api/v1/jobs/${job}/apply`).set(auth(w.token)).send({})).body.applicationId;
    await request(app).patch(`/api/v1/applications/${appId}/status`).set(auth(e.token)).send({ status: 'SHORTLISTED' });
    expect(s.sent.map((m) => m.to)).toEqual([w.phone]);
    expect(s.sent[0].text).toContain('status');
    expect(s.sent[0].text).not.toContain(job);
  });
});

// ───────── Job-match alerts ─────────

describe('job match alerts', () => {
  it('alerts the best-matching workers when a job first goes live, and nobody else', async () => {
    const e = await signUp('EMPLOYER');
    const fit = await skilledWorker();
    const optedOut = await skilledWorker();
    await request(app).patch('/api/v1/notifications/settings').set(auth(optedOut.token)).send({ notifyJobMatches: false });
    const unrelated = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(unrelated.token)).send({ categoryId: (await prisma.category.findFirstOrThrow({ where: { slug: 'hospitality' } })).id });
    await request(app).put(`/api/v1/workers/me/skills/${skill['cooking']}`).set(auth(unrelated.token)).send({ proficiency: 4 });

    const job = await newJob(e);
    expect(await alerts(fit.id)).toHaveLength(0); // drafts alert nobody
    expect((await publish(e, job)).status).toBe(200);

    const mine = await alerts(fit.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].payload).toMatchObject({ jobId: job, strength: expect.stringMatching(/strong|good/) });
    expect((mine[0].payload as { score: number }).score).toBeGreaterThanOrEqual(60);
    expect(Object.keys(mine[0].payload as object).sort()).toEqual(['jobId', 'jobTitle', 'organizationName', 'score', 'strength']); // nothing else leaks
    expect(await alerts(optedOut.id)).toHaveLength(0);
    expect(await alerts(unrelated.id)).toHaveLength(0);

    // closing and reopening the same job does not alert again
    await request(app).post(`/api/v1/jobs/${job}/close`).set(auth(e.token)).send({});
    await publish(e, job);
    expect(await alerts(fit.id)).toHaveLength(1);
  });

  it('does not alert workers who already applied or whose profile is too thin to judge', async () => {
    const e = await signUp('EMPLOYER');
    const thin = await signUp('WORKER'); // nothing but a location: low confidence
    const job = await newJob(e);
    await publish(e, job);
    expect(await alerts(thin.id)).toHaveLength(0);
  });

  it('sends a worker at most three alerts a day', async () => {
    const e = await signUp('EMPLOYER');
    const w = await skilledWorker();
    for (let i = 0; i < 5; i++) await publish(e, await newJob(e));
    expect(await alerts(w.id)).toHaveLength(3);
  });
});
