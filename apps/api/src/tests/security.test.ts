import { randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { makePdf } from './helpers/pdf';

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
    fullName: `Test ${role} ${tag().slice(2, 6)}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Sec ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}

let autoId = '';
let engineId = '';
async function liveJob(e: User, title = `Sec job ${tag()}`) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title, description: `Repair vehicles. ${randomUUID()} ${randomUUID()} Please apply with your experience and references.`,
    categoryId: autoId, employmentType: 'FULL_TIME', deadline: future(30),
    locationId: (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id,
    skills: [{ skillId: engineId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}

beforeAll(async () => {
  autoId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  engineId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'engine-repair' } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('authentication tokens', () => {
  it('rejects requests without a token, with garbage, and with a tampered signature', async () => {
    const u = await signUp('WORKER');
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(auth('not-a-token'))).status).toBe(401);
    const [h, p, s] = u.token.split('.');
    const flipped = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await request(app).get('/api/v1/auth/me').set(auth(flipped))).status).toBe(401);
  });

  it('rejects alg:none, tokens signed with another secret, and expired tokens', async () => {
    const u = await signUp('WORKER');
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, role: 'ADMIN' })}.`;
    expect((await request(app).get('/api/v1/auth/me').set(auth(none))).status).toBe(401);
    const forged = jwt.sign({ role: 'ADMIN' }, 'x'.repeat(40), { subject: u.id, expiresIn: '5m' });
    expect((await request(app).get('/api/v1/auth/me').set(auth(forged))).status).toBe(401);
    const expired = jwt.sign({ role: 'WORKER' }, env.JWT_ACCESS_SECRET, { subject: u.id, expiresIn: -10 });
    expect((await request(app).get('/api/v1/auth/me').set(auth(expired))).status).toBe(401);
  });

  it('ignores the role claim inside a valid token: the role comes from the database', async () => {
    const w = await signUp('WORKER');
    const lying = jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: w.id, expiresIn: '5m' });
    expect((await request(app).get('/api/v1/admin/stats').set(auth(lying))).status).toBe(403);
  });

  it('refuses a token for an account that was suspended or removed', async () => {
    const w = await signUp('WORKER');
    await prisma.user.update({ where: { id: w.id }, data: { status: 'SUSPENDED' } });
    expect((await request(app).get('/api/v1/auth/me').set(auth(w.token))).status).toBe(401);
    await prisma.user.delete({ where: { id: w.id } });
    expect((await request(app).get('/api/v1/auth/me').set(auth(w.token))).status).toBe(401);
  });
});

describe('cookies, CSRF and brute force', () => {
  it('refresh and logout need the CSRF header', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(403);
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(403);
  });

  it('the refresh cookie is httpOnly, SameSite=Lax and limited to the auth path', async () => {
    const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
    phones.push(`+251${p.slice(1)}`);
    const res = await request(app).post('/api/v1/auth/register').send({ fullName: 'Cookie Test', phone: p, password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('et_refresh='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(JSON.stringify(res.body)).not.toContain('et_refresh');
  });

  it('locks out repeated login attempts (rate limit) and does not reveal whether the phone exists', async () => {
    const limited = createApp({ authRateLimitMax: 4 });
    const codes: number[] = [];
    const messages = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await request(limited).post('/api/v1/auth/login').send({ phone: '0911000000', password: 'WrongPassw0rd' });
      codes.push(r.status);
      if (r.status !== 429) messages.add(String(r.body?.error?.message));
    }
    expect(codes.slice(0, 4).every((c) => c === 401)).toBe(true);
    expect(codes.slice(4)).toEqual([429, 429]);
    expect(messages.size).toBe(1);
  });

  it('a wrong password and an unknown phone give the same answer', async () => {
    const u = await signUp('WORKER');
    const wrong = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: 'WrongPassw0rd' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ phone: '0999999999', password: 'WrongPassw0rd' });
    expect(wrong.status).toBe(unknown.status);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('never returns password hashes or tokens in profile responses', async () => {
    const u = await signUp('WORKER');
    const me = JSON.stringify((await request(app).get('/api/v1/auth/me').set(auth(u.token))).body);
    expect(me).not.toMatch(/passwordHash|\$2[aby]\$|refreshToken/i);
  });
});

describe('privilege escalation', () => {
  it('cannot register as admin or set internal fields at sign-up', async () => {
    const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
    phones.push(`+251${p.slice(1)}`);
    const base = { fullName: 'Sneaky', phone: p, password: 'Passw0rdTest', region: 'Oromia', zone: 'Adama', language: 'en' };
    expect((await request(app).post('/api/v1/auth/register').send({ ...base, role: 'ADMIN' })).status).toBe(400);
    const r = await request(app).post('/api/v1/auth/register').send({ ...base, role: 'WORKER', status: 'ACTIVE', isAdmin: true, verified: true });
    if (r.status === 201) {
      const row = await prisma.user.findUniqueOrThrow({ where: { id: r.body.user.id } });
      expect(row.role).toBe('WORKER');
    } else {
      expect(r.status).toBe(400);
    }
  });

  it('roles are separated on every sensitive area', async () => {
    const w = await signUp('WORKER');
    const e = await signUp('EMPLOYER');
    for (const path of ['/admin/stats', '/admin/users', '/admin/reports', '/admin/audit']) {
      expect((await request(app).get(`/api/v1${path}`)).status).toBe(401);
      expect((await request(app).get(`/api/v1${path}`).set(auth(w.token))).status).toBe(403);
      expect((await request(app).get(`/api/v1${path}`).set(auth(e.token))).status).toBe(403);
    }
    expect((await request(app).post('/api/v1/jobs').set(auth(w.token)).send({})).status).toBe(403);
    expect((await request(app).get('/api/v1/applications/mine').set(auth(e.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/recommendations/jobs').set(auth(e.token))).status).toBeGreaterThanOrEqual(403);
  });
});

describe('access to other people\'s data (IDOR)', () => {
  it('another employer cannot read, change or interview applicants of a job that is not theirs', async () => {
    const owner = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const jobId = await liveJob(owner);
    const applicationId = (await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).body.applicationId as string;

    for (const res of [
      await request(app).get(`/api/v1/applications/${applicationId}`).set(auth(other.token)),
      await request(app).get(`/api/v1/jobs/${jobId}/applications`).set(auth(other.token)),
      await request(app).patch(`/api/v1/applications/${applicationId}/status`).set(auth(other.token)).send({ status: 'SHORTLISTED' }),
      await request(app).post(`/api/v1/applications/${applicationId}/conversation`).set(auth(other.token)),
    ]) expect([403, 404]).toContain(res.status);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status).toBe('PENDING');
    // and the owner still can
    expect((await request(app).get(`/api/v1/applications/${applicationId}`).set(auth(owner.token))).status).toBe(200);
  });

  it('another worker cannot withdraw someone else\'s application or read their conversation', async () => {
    const e = await signUp('EMPLOYER');
    const w1 = await signUp('WORKER');
    const w2 = await signUp('WORKER');
    const jobId = await liveJob(e);
    const applicationId = (await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w1.token)).send({})).body.applicationId as string;
    const conv = (await request(app).post(`/api/v1/applications/${applicationId}/conversation`).set(auth(e.token))).body.conversationId as string;
    await request(app).post(`/api/v1/conversations/${conv}/messages`).set(auth(e.token)).send({ body: 'private words' });

    expect([403, 404]).toContain((await request(app).post(`/api/v1/applications/${applicationId}/withdraw`).set(auth(w2.token))).status);
    const read = await request(app).get(`/api/v1/conversations/${conv}/messages`).set(auth(w2.token));
    expect([403, 404]).toContain(read.status);
    expect(JSON.stringify(read.body)).not.toContain('private words');
    expect([403, 404]).toContain((await request(app).post(`/api/v1/conversations/${conv}/messages`).set(auth(w2.token)).send({ body: 'intrude' })).status);
  });

  it('another employer cannot edit, publish or close a job they do not own', async () => {
    const owner = await signUp('EMPLOYER');
    const other = await signUp('EMPLOYER');
    const jobId = await liveJob(owner, 'Original title');
    for (const res of [
      await request(app).patch(`/api/v1/jobs/${jobId}`).set(auth(other.token)).send({ title: 'Hijacked' }),
      await request(app).delete(`/api/v1/jobs/${jobId}`).set(auth(other.token)),
    ]) expect([403, 404]).toContain(res.status);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).title).toBe('Original title');
  });

  it('a CV is only downloadable by its owner (or an employer with an application), never by a stranger', async () => {
    const w = await signUp('WORKER');
    const stranger = await signUp('WORKER');
    const e = await signUp('EMPLOYER');
    const up = await request(app).post('/api/v1/workers/me/cv').set(auth(w.token)).attach('file', makePdf(['Mason with five years of experience']), { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const fileId = (await prisma.workerProfile.findFirstOrThrow({ where: { userId: w.id } })).cvFileId!;
    expect((await request(app).get(`/api/v1/files/${fileId}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/files/${fileId}`).set(auth(stranger.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/files/${fileId}`).set(auth(e.token))).status).toBe(403);
    const mine = await request(app).get(`/api/v1/files/${fileId}`).set(auth(w.token));
    expect(mine.status).toBe(200);
    expect(mine.headers['x-content-type-options']).toBe('nosniff');
    expect(mine.headers['content-disposition']).toMatch(/attachment/);
  });

  it('a worker\'s phone number stays hidden from an employer until shortlisting', async () => {
    const e = await signUp('EMPLOYER');
    const w = await signUp('WORKER');
    const jobId = await liveJob(e);
    const applicationId = (await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).body.applicationId as string;
    const before = JSON.stringify((await request(app).get(`/api/v1/applications/${applicationId}`).set(auth(e.token))).body);
    expect(before).not.toContain(w.phone);
    expect(before).not.toContain(w.phone.replace('+251', '0'));
    expect(JSON.stringify((await request(app).get(`/api/v1/jobs/${jobId}/applications`).set(auth(e.token))).body)).not.toContain(w.phone);
  });

  it('file ids that are not UUIDs, or point nowhere, give 404 (no path traversal)', async () => {
    const w = await signUp('WORKER');
    for (const id of ['..%2f..%2f.env', '../../.env', 'null', randomUUID()]) {
      const r = await request(app).get(`/api/v1/files/${id}`).set(auth(w.token));
      expect([404, 400]).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toMatch(/JWT_|DATABASE_URL/);
    }
  });
});

describe('malicious input', () => {
  it('SQL injection strings in search and login are treated as plain text', async () => {
    const before = await prisma.user.count();
    for (const q of ["' OR '1'='1", "'; DROP TABLE \"User\"; --", "%' UNION SELECT * FROM \"User\" --", '\\']) {
      const r = await request(app).get('/api/v1/jobs').query({ q });
      expect(r.status, q).toBe(200);
      expect(r.body.items ?? r.body.jobs ?? []).toBeInstanceOf(Array);
    }
    const login = await request(app).post('/api/v1/auth/login').send({ phone: "0911' OR '1'='1", password: "x' OR '1'='1" });
    expect([400, 401]).toContain(login.status);
    expect(await prisma.user.count()).toBe(before);
  });

  it('script text is stored as text and returned as JSON with nosniff (the web app escapes it when rendering)', async () => {
    const e = await signUp('EMPLOYER');
    const title = '<script>alert(1)</script> Mechanic';
    const jobId = await liveJob(e, title);
    const res = await request(app).get(`/api/v1/jobs/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(JSON.stringify(res.body)).toContain('alert(1)');
  });

  it('oversized and malformed bodies are rejected cleanly without stack traces', async () => {
    const big = await request(app).post('/api/v1/auth/login').send({ phone: 'a'.repeat(200_000), password: 'x' });
    expect(big.status).toBe(413);
    const bad = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"phone": ');
    expect(bad.status).toBe(400);
    for (const r of [big, bad, await request(app).get('/api/v1/no-such-route')]) {
      expect(JSON.stringify(r.body)).not.toMatch(/node_modules|at .*\.ts:\d+|PrismaClient/);
    }
  });

  it('a file with a .pdf name but other content is refused, and an executable is refused', async () => {
    const w = await signUp('WORKER');
    const fake = await request(app).post('/api/v1/workers/me/cv').set(auth(w.token)).attach('file', Buffer.from('MZ\x90\x00 this is an exe'), { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect([400, 415]).toContain(fake.status);
    const exe = await request(app).post('/api/v1/workers/me/photo').set(auth(w.token)).attach('file', Buffer.from('MZ\x90\x00'), { filename: 'me.png', contentType: 'image/png' });
    expect([400, 415]).toContain(exe.status);
  });

  it('a spreadsheet-formula job title cannot become a formula in the CSV export', async () => {
    const { csvCell } = await import('../modules/admin/routes');
    for (const bad of ['=HYPERLINK("http://evil")', '+1+1', '-2+3', '@SUM(A1)']) expect(csvCell(bad).replace(/^"/, '')).toMatch(/^'/);
  });
});

describe('transport headers', () => {
  it('sets standard security headers and does not advertise the framework', async () => {
    const r = await request(app).get('/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options'] ?? r.headers['content-security-policy']).toBeTruthy();
    expect(r.headers['strict-transport-security']).toBeTruthy();
  });

  it('CORS does not echo an unknown origin', async () => {
    const r = await request(app).get('/api/v1/jobs').set('Origin', 'https://evil.example');
    expect(r.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(r.headers['access-control-allow-origin']).not.toBe('*');
  });
});
