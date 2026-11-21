import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { databaseStore, DEFAULT_SETTINGS, memoryStore, useSettingsStore } from '../modules/admin/settings';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

// An in-memory settings store: these tests switch maintenance mode and registration on and off, which must never touch
// the shared test database that other test files are using at the same time.
const app = createApp({ settings: memoryStore() });
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
type User = { token: string; id: string; phone: string };

function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  return p;
}
async function signUp(role: 'WORKER' | 'EMPLOYER', region = 'Oromia'): Promise<User> {
  const phone = newPhone();
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag().slice(2, 6)}`, phone, password: 'Passw0rdTest', role, region, language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Manage ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}
async function makeAdmin(): Promise<User> {
  const phone = newPhone();
  const u = await prisma.user.create({ data: { fullName: `Test Admin ${tag().slice(2, 6)}`, phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' });
  return { token: login.body.accessToken, id: u.id, phone: u.phone };
}

let admin: User;
let categoryId = '';
let skillIds: string[] = [];
const get = (u: User, p: string) => request(app).get(`/api/v1/admin${p}`).set(auth(u.token));
const post = (u: User, p: string, body: unknown = {}) => request(app).post(`/api/v1/admin${p}`).set(auth(u.token)).send(body as object);
const patch = (u: User, p: string, body: unknown) => request(app).patch(`/api/v1/admin${p}`).set(auth(u.token)).send(body as object);
const setSettings = (body: unknown) => patch(admin, '/settings', body);

async function liveJob(e: User, title: string) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title, description: `Repair vehicles in our garage. ${randomUUID()} ${randomUUID()} Please apply with your experience and references.`,
    categoryId, employmentType: 'FULL_TIME', deadline: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    locationId: (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id,
    skills: skillIds.map((skillId) => ({ skillId, importance: 'REQUIRED' })),
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const id = create.body.job.id as string;
  expect((await request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return id;
}

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  skillIds = (await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems'] } }, orderBy: { slug: 'asc' } })).map((s) => s.id);
  admin = await makeAdmin();
});
afterAll(async () => {
  const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.announcement.deleteMany({ where: { title: { startsWith: 'ZQ ' } } });
  await prisma.platformSetting.deleteMany({ where: { value: { equals: 'zq maintenance text' } } });
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('access', () => {
  it('keeps every new admin endpoint away from everyone but administrators', async () => {
    const w = await signUp('WORKER');
    const id = randomUUID();
    const calls: [string, string][] = [
      ['get', '/announcements'], ['post', '/announcements'], ['get', `/users/${id}`], ['post', `/users/${id}/force-password-reset`],
      ['get', '/jobs'], ['post', `/jobs/${id}/close`], ['get', '/applications'], ['get', '/settings'], ['patch', '/settings'], ['get', '/health'],
    ];
    for (const [method, path] of calls) {
      const r = await (request(app) as never as Record<string, (u: string) => request.Test>)[method](`/api/v1/admin${path}`).set(auth(w.token)).send({});
      expect(r.status, `${method} ${path}`).toBe(403);
      const anon = await (request(app) as never as Record<string, (u: string) => request.Test>)[method](`/api/v1/admin${path}`).send({});
      expect(anon.status, `anon ${method} ${path}`).toBe(401);
    }
    expect((await request(app).get('/api/v1/announcements/active')).status).toBe(401);
  });
});

describe('platform settings', () => {
  it('reads and changes settings, validates them, and logs the change', async () => {
    expect((await get(admin, '/settings')).body.settings).toEqual(DEFAULT_SETTINGS);
    expect((await setSettings({})).status).toBe(400);
    expect((await setSettings({ dailyApplicationLimit: 0 })).status).toBe(400);
    expect((await setSettings({ dailyApplicationLimit: 500 })).status).toBe(400);
    expect((await setSettings({ secretKey: 'x' })).status).toBe(400); // unknown keys are refused
    const ok = await setSettings({ maintenanceMessage: 'Back at noon.', dailyApplicationLimit: 40 });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ maintenanceMessage: 'Back at noon.', dailyApplicationLimit: 40 });
    const log = await prisma.auditLog.findFirst({ where: { action: 'admin.settings_changed', actorId: admin.id }, orderBy: { createdAt: 'desc' } });
    expect(log?.meta).toMatchObject({ changed: expect.arrayContaining(['maintenanceMessage', 'dailyApplicationLimit']) });
    await setSettings({ maintenanceMessage: '', dailyApplicationLimit: 30 });
  });

  it('maintenance mode blocks the site but not sign-in, the admin area or the status check', async () => {
    const w = await signUp('WORKER');
    await setSettings({ maintenanceEnabled: true, maintenanceMessage: 'Upgrading the database.' });
    try {
      const blocked = await request(app).get('/api/v1/jobs').set(auth(w.token));
      expect(blocked.status).toBe(503);
      expect(blocked.body.error).toMatchObject({ code: 'MAINTENANCE', message: 'Upgrading the database.' });
      expect(blocked.headers['retry-after']).toBe('300');
      expect((await request(app).get('/health')).status).toBe(200);
      expect((await request(app).post('/api/v1/auth/login').send({ phone: admin.phone, password: 'Passw0rdTest' })).status).toBe(200);
      expect((await get(admin, '/stats')).status).toBe(200);
      const status = await request(app).get('/api/v1/site/status');
      expect(status.body.maintenance).toEqual({ message: 'Upgrading the database.' });
    } finally {
      await setSettings({ maintenanceEnabled: false, maintenanceMessage: '' });
    }
    expect((await request(app).get('/api/v1/jobs').set(auth(w.token))).status).toBe(200);
    expect((await request(app).get('/api/v1/site/status')).body.maintenance).toBeNull();
  });

  it('can close registration and lower the daily application limit', async () => {
    await setSettings({ registrationOpen: false });
    try {
      const closed = await request(app).post('/api/v1/auth/register').send({ fullName: 'Late Comer', phone: newPhone(), password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', language: 'en' });
      expect(closed.status).toBe(403);
      expect(closed.body.error.code).toBe('REGISTRATION_CLOSED');
      expect((await request(app).get('/api/v1/site/status')).body.registrationOpen).toBe(false);
    } finally {
      await setSettings({ registrationOpen: true });
    }

    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const j1 = await liveJob(e, `Limit one ${tag()}`);
    const j2 = await liveJob(e, `Limit two ${tag()}`);
    await setSettings({ dailyApplicationLimit: 1 });
    try {
      expect((await request(app).post(`/api/v1/jobs/${j1}/apply`).set(auth(w.token)).send({})).status).toBe(201);
      const second = await request(app).post(`/api/v1/jobs/${j2}/apply`).set(auth(w.token)).send({});
      expect(second.status).toBe(429);
    } finally {
      await setSettings({ dailyApplicationLimit: 30 });
    }
    expect((await request(app).post(`/api/v1/jobs/${j2}/apply`).set(auth(w.token)).send({})).status).toBe(201);
  });

  it('keeps settings in the database store, and ignores a malformed stored value', async () => {
    const prev = databaseStore;
    useSettingsStore(prev);
    try {
      await databaseStore.write({ maintenanceMessage: 'zq maintenance text' }, admin.id);
      expect((await databaseStore.read()).maintenanceMessage).toBe('zq maintenance text');
      await prisma.platformSetting.upsert({ where: { key: 'registrationOpen' }, update: { value: 'nonsense' }, create: { key: 'registrationOpen', value: 'nonsense' } });
      expect((await databaseStore.read()).registrationOpen).toBe(true); // falls back to the default
    } finally {
      await prisma.platformSetting.deleteMany({ where: { key: { in: ['registrationOpen', 'maintenanceMessage'] } } });
      useSettingsStore(memoryStore());
    }
  });
});

describe('announcements', () => {
  it('shows an announcement only to its audience and region, and can notify them', async () => {
    const oromiaWorker = await signUp('WORKER', 'Oromia');
    const amharaWorker = await signUp('WORKER', 'Amhara');
    const oromiaEmployer = await signUp('EMPLOYER', 'Oromia');
    const oromia = await prisma.location.findFirstOrThrow({ where: { level: 'REGION', nameEn: 'Oromia' } });

    const bad = await post(admin, '/announcements', { title: 'ZQ bad', body: 'x'.repeat(3), regionId: randomUUID() });
    expect(bad.status).toBe(400);
    const adama = await prisma.location.findFirstOrThrow({ where: { level: 'ZONE', nameEn: 'Adama' } });
    expect((await post(admin, '/announcements', { title: 'ZQ zone', body: 'not a region', regionId: adama.id })).status).toBe(400);
    expect((await post(admin, '/announcements', { title: 'ZQ order', body: 'ends before it starts', startsAt: '2030-01-02', endsAt: '2030-01-01' })).status).toBe(400);
    expect((await post(admin, '/announcements', { title: 'ZQ later', body: 'future with notify', startsAt: '2031-01-01', notify: true })).status).toBe(400);

    const created = await post(admin, '/announcements', { title: 'ZQ Oromia workers', body: 'A job fair takes place in Adama next week.', audience: 'WORKERS', regionId: oromia.id, notify: true });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.announcement.id as string;
    expect(created.body.announcement.notifiedCount).toBeGreaterThanOrEqual(1);

    const seen = async (u: User) => ((await request(app).get('/api/v1/announcements/active').set(auth(u.token))).body.items as { id: string; title: string }[]).map((a) => a.id);
    expect(await seen(oromiaWorker)).toContain(id);
    expect(await seen(amharaWorker)).not.toContain(id); // other region
    expect(await seen(oromiaEmployer)).not.toContain(id); // other audience
    expect(await prisma.notification.count({ where: { userId: oromiaWorker.id, type: 'announcement' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: amharaWorker.id, type: 'announcement' } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: oromiaEmployer.id, type: 'announcement' } })).toBe(0);

    const edited = await patch(admin, `/announcements/${id}`, { title: 'ZQ Oromia workers (edited)' });
    expect(edited.status).toBe(200);
    expect((await get(admin, '/announcements')).body.items.find((a: { id: string }) => a.id === id)).toMatchObject({ status: 'active', region: 'Oromia', audience: 'WORKERS' });

    expect((await post(admin, `/announcements/${id}/withdraw`)).status).toBe(200);
    expect(await seen(oromiaWorker)).not.toContain(id);
    expect((await get(admin, '/announcements')).body.items.find((a: { id: string }) => a.id === id).status).toBe('withdrawn');
    expect((await post(admin, `/announcements/${randomUUID()}/withdraw`)).status).toBe(404);
  });

  it('hides scheduled and ended announcements, and shows an everyone notice to every role', async () => {
    const w = await signUp('WORKER');
    const e = await signUp('EMPLOYER');
    const everyone = await post(admin, '/announcements', { title: 'ZQ everyone', body: 'Maintenance on Sunday.' });
    const later = await post(admin, '/announcements', { title: 'ZQ scheduled', body: 'Starts next year.', startsAt: new Date(Date.now() + 365 * 86_400_000).toISOString() });
    const ended = await post(admin, '/announcements', { title: 'ZQ ended', body: 'Already over.', startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), endsAt: new Date(Date.now() - 86_400_000).toISOString() });
    for (const r of [everyone, later, ended]) expect(r.status, JSON.stringify(r.body)).toBe(201);
    for (const u of [w, e, admin]) {
      const ids = ((await request(app).get('/api/v1/announcements/active').set(auth(u.token))).body.items as { id: string }[]).map((a) => a.id);
      expect(ids).toContain(everyone.body.announcement.id);
      expect(ids).not.toContain(later.body.announcement.id);
      expect(ids).not.toContain(ended.body.announcement.id);
    }
    const list = (await get(admin, '/announcements')).body.items as { id: string; status: string }[];
    expect(list.find((a) => a.id === later.body.announcement.id)?.status).toBe('scheduled');
    expect(list.find((a) => a.id === ended.body.announcement.id)?.status).toBe('ended');
  });
});

describe('one user', () => {
  it("shows a worker's detail without secrets", async () => {
    const w = await signUp('WORKER');
    const r = await get(admin, `/users/${w.id}`);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: w.id, role: 'WORKER', status: 'ACTIVE', phoneVerified: false, mustChangePassword: false });
    expect(r.body.worker).toMatchObject({ skills: 0, applications: 0 });
    expect(r.body.activeSessions).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|totpSecret|tokenHash/);
    const e = await signUp('EMPLOYER');
    const er = await get(admin, `/users/${e.id}`);
    expect(er.body.employer.organization.name).toMatch(/^TEST_ORG/);
    expect((await get(admin, `/users/${randomUUID()}`)).status).toBe(404);
    expect((await get(admin, '/users/not-a-uuid')).status).toBe(404);
  });

  it('forces a password reset, which ends every session and is logged with its reason', async () => {
    const w = await signUp('WORKER');
    expect((await post(admin, `/users/${w.id}/force-password-reset`, {})).status).toBe(400); // a reason is required
    const out = await post(admin, `/users/${w.id}/force-password-reset`, { reason: 'Reported account takeover' });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ mustChangePassword: true });
    expect(out.body.sessionsEnded).toBeGreaterThanOrEqual(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.id } })).mustChangePassword).toBe(true);
    expect(await prisma.refreshToken.count({ where: { userId: w.id, revokedAt: null } })).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { action: 'admin.user_password_reset_forced', entityId: w.id } });
    expect(log?.meta).toMatchObject({ reason: 'Reported account takeover' });
  });

  it('marks a phone as verified or not, needs an e-mail address for e-mail, and protects administrators and yourself', async () => {
    const w = await signUp('WORKER');
    const on = await post(admin, `/users/${w.id}/contact-verification`, { kind: 'PHONE', verified: true, reason: 'Checked in person' });
    expect(on.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.id } })).phoneVerifiedAt).not.toBeNull();
    await post(admin, `/users/${w.id}/contact-verification`, { kind: 'PHONE', verified: false, reason: 'Number was reassigned' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.id } })).phoneVerifiedAt).toBeNull();
    expect((await post(admin, `/users/${w.id}/contact-verification`, { kind: 'EMAIL', verified: true, reason: 'Checked in person' })).status).toBe(400);

    const other = await makeAdmin();
    expect((await post(admin, `/users/${other.id}/force-password-reset`, { reason: 'test reason' })).status).toBe(403);
    expect((await post(admin, `/users/${admin.id}/force-password-reset`, { reason: 'test reason' })).status).toBe(403);
    await prisma.user.update({ where: { id: w.id }, data: { status: 'DELETED' } });
    expect((await post(admin, `/users/${w.id}/force-password-reset`, { reason: 'test reason' })).status).toBe(409);
  });
});

describe('jobs and applications', () => {
  it('lists jobs with flags, filters them, closes with a reason and features only live jobs', async () => {
    const e = await signUp('EMPLOYER');
    const title = `Manage ${tag()}`;
    const jobId = await liveJob(e, title);

    const found = await get(admin, `/jobs?q=${title}`);
    expect(found.status).toBe(200);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]).toMatchObject({ id: jobId, status: 'ACTIVE', applications: 0, featured: false, flags: [] });
    expect(found.body.problems).toEqual({ expired: expect.any(Number), noApplicants: expect.any(Number), held: expect.any(Number) });

    // An old job nobody applied to, then one past its deadline.
    await prisma.job.update({ where: { id: jobId }, data: { createdAt: new Date(Date.now() - 10 * 86_400_000) } });
    expect((await get(admin, `/jobs?q=${title}&flag=noApplicants`)).body.items[0].flags).toContain('noApplicants');
    await prisma.job.update({ where: { id: jobId }, data: { deadline: new Date(Date.now() - 3600_000) } });
    const expired = await get(admin, `/jobs?q=${title}&flag=expired`);
    expect(expired.body.items[0].flags).toContain('expired');
    expect((await get(admin, `/jobs?q=${title}&flag=held`)).body.items).toHaveLength(0);
    expect((await get(admin, '/jobs?status=NOPE')).status).toBe(400);

    expect((await post(admin, `/jobs/${jobId}/feature`, { featured: true })).status).toBe(200);
    expect((await get(admin, `/jobs?q=${title}`)).body.items[0].featured).toBe(true);

    expect((await post(admin, `/jobs/${jobId}/close`, {})).status).toBe(400);
    const closed = await post(admin, `/jobs/${jobId}/close`, { reason: 'Deadline passed, employer unreachable' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', from: 'ACTIVE' });
    const after = (await prisma.job.findUniqueOrThrow({ where: { id: jobId } }));
    expect(after.status).toBe('CLOSED');
    expect(after.featuredAt).toBeNull(); // closing also un-features
    expect((await post(admin, `/jobs/${jobId}/close`, { reason: 'again please' })).status).toBe(409);
    expect((await post(admin, `/jobs/${jobId}/feature`, { featured: true })).status).toBe(409);
    expect((await post(admin, `/jobs/${randomUUID()}/close`, { reason: 'no such job' })).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'admin.job_closed', entityId: jobId } })).toBe(1);
  });

  it('lists applications with filters', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const title = `Apps ${tag()}`;
    const jobId = await liveJob(e, title);
    const applied = await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({});
    expect(applied.status).toBe(201);

    const all = await get(admin, `/applications?jobId=${jobId}`);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(1);
    expect(all.body.items[0]).toMatchObject({ id: applied.body.applicationId, status: 'PENDING', job: { id: jobId, title }, worker: { userId: w.id } });
    expect((await get(admin, `/applications?jobId=${jobId}&status=ACCEPTED`)).body.items).toHaveLength(0);
    expect((await get(admin, `/applications?q=${title}`)).body.total).toBe(1);
    expect((await get(admin, '/applications?status=BOGUS')).status).toBe(400);
    expect((await request(app).get(`/api/v1/jobs/${jobId}`)).status).toBe(200);
  });
});

describe('health', () => {
  it('reports the database, the AI service, channels, queues and runtime', async () => {
    const r = await get(admin, '/health');
    expect(r.status).toBe(200);
    expect(r.body.database.ok).toBe(true);
    expect(typeof r.body.aiService.configured).toBe('boolean');
    if (!r.body.aiService.configured) expect(r.body.aiService.reachable).toBeNull(); // not asked when not configured
    expect(Object.keys(r.body.channels).sort()).toEqual(['antivirus', 'email', 'sms', 'telegram']);
    expect(r.body.queues).toEqual({ expired: expect.any(Number), noApplicants: expect.any(Number), held: expect.any(Number), pendingVerifications: expect.any(Number), openReports: expect.any(Number) });
    expect(r.body.runtime.node).toMatch(/^v\d+/);
  });
});
