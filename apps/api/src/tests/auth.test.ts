import { randomInt } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { errorHandler } from '../middleware/common';
import { requireAuth, requireRole } from '../middleware/auth';
import { codeForStep, stepAt } from '../lib/totp';

// Safety guard: never run destructive cleanup against a non-test database.
if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const CSRF = { 'X-CSRF-Protection': '1' };
const createdPhones: string[] = [];

/** Unique valid Ethiopian mobile in local format, e.g. 0912345678 */
function newPhone() {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  createdPhones.push(`+251${p.slice(1)}`);
  return p;
}

const workerBody = (over: Record<string, unknown> = {}) => ({
  fullName: 'Test Worker',
  phone: newPhone(),
  password: 'Passw0rdTest',
  role: 'WORKER',
  region: 'Oromia',
  language: 'en',
  ...over,
});

async function registerWorker(over: Record<string, unknown> = {}) {
  const body = workerBody(over);
  const res = await request(app).post('/api/v1/auth/register').send(body);
  expect(res.status).toBe(201);
  return { body, res };
}

const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('et_refresh='));

afterAll(async () => {
  // Test database only: this file refuses to run against anything else (see guard below).
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: { in: createdPhones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  for (const level of ['KEBELE', 'WOREDA', 'ZONE'] as const) {
    await prisma.location.deleteMany({ where: { level, nameEn: { startsWith: 'Test' } } });
  }
  await prisma.$disconnect();
});

describe('registration', () => {
  it('registers a worker, normalizes phone, creates profile and location chain, sets httpOnly cookie', async () => {
    const { body, res } = await registerWorker({ zone: 'TestZone A', woreda: 'TestWoreda A', kebele: 'TestKebele A' });
    expect(res.body.user.role).toBe('WORKER');
    expect(res.body.user.phone).toBe(`+251${String(body.phone).slice(1)}`);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = cookieOf(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const profile = await prisma.workerProfile.findFirst({
      where: { userId: res.body.user.id },
      include: { location: { include: { parent: { include: { parent: { include: { parent: true } } } } } } },
    });
    expect(profile?.location?.level).toBe('KEBELE');
    expect(profile?.location?.parent?.parent?.parent?.nameEn).toBe('Oromia');
  });

  it('stores only a hash of the password', async () => {
    const { res } = await registerWorker();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(user.passwordHash).not.toContain('Passw0rdTest');
    expect(await bcrypt.compare('Passw0rdTest', user.passwordHash)).toBe(true);
  });

  it('registers an employer with an organization', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(workerBody({ role: 'EMPLOYER', organizationName: 'TEST_ORG Builders', organizationType: 'CONSTRUCTION' }));
    expect(res.status).toBe(201);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.body.user.organization.name).toBe('TEST_ORG Builders');
    expect(me.body.user.organization.verificationStatus).toBe('UNVERIFIED');
  });

  it('requires organization details for employers', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(workerBody({ role: 'EMPLOYER' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.organizationName).toBeTruthy();
  });

  it('refuses to self-register as ADMIN or TRAINER', async () => {
    for (const role of ['ADMIN', 'TRAINER']) {
      const res = await request(app).post('/api/v1/auth/register').send(workerBody({ role }));
      expect(res.status).toBe(400);
    }
  });

  it('rejects duplicate phone numbers (even in another format)', async () => {
    const { body } = await registerWorker();
    const again = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...body, phone: `+251${String(body.phone).slice(1)}` });
    expect(again.status).toBe(409);
  });

  it.each([
    ['weak password (no digit)', { password: 'onlyletters' }],
    ['short password', { password: 'a1' }],
    ['over-long password', { password: `a1${'x'.repeat(80)}` }],
    ['bad phone', { phone: '12345' }],
    ['bad email', { email: 'not-an-email' }],
    ['unknown region', { region: 'Atlantis' }],
  ])('rejects %s', async (_name, over) => {
    const res = await request(app).post('/api/v1/auth/register').send(workerBody(over));
    expect(res.status).toBe(400);
  });

  it('writes an audit log entry', async () => {
    const { res } = await registerWorker();
    const log = await prisma.auditLog.findFirst({ where: { actorId: res.body.user.id, action: 'auth.register' } });
    expect(log).toBeTruthy();
  });
});

describe('login', () => {
  it('logs in with local or international phone format', async () => {
    const { body } = await registerWorker();
    for (const phone of [body.phone, `+251${String(body.phone).slice(1)}`]) {
      const res = await request(app).post('/api/v1/auth/login').send({ phone, password: body.password });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
    }
  });

  it('gives the same error for a wrong password and an unknown phone', async () => {
    const { body } = await registerWorker();
    const wrong = await request(app).post('/api/v1/auth/login').send({ phone: body.phone, password: 'WrongPass123' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ phone: newPhone(), password: 'WrongPass123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('blocks suspended accounts at login and for already-issued tokens', async () => {
    const { body, res } = await registerWorker();
    await prisma.user.update({ where: { id: res.body.user.id }, data: { status: 'SUSPENDED' } });
    const login = await request(app).post('/api/v1/auth/login').send({ phone: body.phone, password: body.password });
    expect(login.status).toBe(401);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(401);
  });

  it('rate-limits repeated attempts', async () => {
    const limited = createApp({ authRateLimitMax: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(limited).post('/api/v1/auth/login').send({ phone: '0911000000', password: 'x' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses[4]).toBe(429);
  });
});

describe('access tokens and /me', () => {
  it('requires a valid bearer token', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('rejects tokens signed with another secret, expired tokens, and alg=none', async () => {
    const { res } = await registerWorker();
    const id = res.body.user.id;
    const forged = jwt.sign({ role: 'ADMIN' }, 'x'.repeat(40), { subject: id });
    const expired = jwt.sign({ role: 'WORKER' }, env.JWT_ACCESS_SECRET, { subject: id, expiresIn: -10 });
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: id, role: 'ADMIN' }),
    ).toString('base64url')}.`;
    for (const t of [forged, expired, none]) {
      const r = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${t}`);
      expect(r.status).toBe(401);
    }
  });

  it('uses the role from the database, not from the token claim', async () => {
    const { res } = await registerWorker();
    const escalated = jwt.sign({ role: 'ADMIN' }, env.JWT_ACCESS_SECRET, { subject: res.body.user.id, expiresIn: '5m' });
    const probe = express();
    probe.get('/admin-only', requireAuth, requireRole('ADMIN'), (_req, r) => void r.json({ ok: true }));
    probe.use(errorHandler);
    const r = await request(probe).get('/admin-only').set('Authorization', `Bearer ${escalated}`);
    expect(r.status).toBe(403);
  });
});

describe('role-based access control', () => {
  it('allows only the listed roles', async () => {
    const probe = express();
    probe.get('/admin-only', requireAuth, requireRole('ADMIN'), (_req, r) => void r.json({ ok: true }));
    probe.get('/employer-or-admin', requireAuth, requireRole('EMPLOYER', 'ADMIN'), (_req, r) => void r.json({ ok: true }));
    probe.use(errorHandler);

    const { res: w } = await registerWorker();
    const adminPhone = newPhone();
    const admin = await prisma.user.create({
      data: { fullName: 'Test Admin', phone: `+251${adminPhone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' },
    });
    const login = await request(app).post('/api/v1/auth/login').send({ phone: adminPhone, password: 'Passw0rdTest' });
    expect(login.body.user.id).toBe(admin.id);

    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    expect((await request(probe).get('/admin-only')).status).toBe(401);
    expect((await request(probe).get('/admin-only').set(auth(w.body.accessToken))).status).toBe(403);
    expect((await request(probe).get('/admin-only').set(auth(login.body.accessToken))).status).toBe(200);
    expect((await request(probe).get('/employer-or-admin').set(auth(w.body.accessToken))).status).toBe(403);
    expect((await request(probe).get('/employer-or-admin').set(auth(login.body.accessToken))).status).toBe(200);
  });
});

describe('refresh tokens', () => {
  it('rotates the refresh token and detects reuse', async () => {
    const { res } = await registerWorker();
    const first = cookieOf(res)!;

    const r1 = await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', first);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const second = cookieOf(r1)!;
    expect(second).not.toBe(first);

    // The old token was rotated away: reusing it is treated as theft and kills every session.
    const reuse = await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', first);
    expect(reuse.status).toBe(401);
    const afterTheft = await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', second);
    expect(afterTheft.status).toBe(401);
  });

  it('requires the CSRF header', async () => {
    const { res } = await registerWorker();
    const r = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieOf(res)!);
    expect(r.status).toBe(403);
  });

  it('fails without a cookie', async () => {
    expect((await request(app).post('/api/v1/auth/refresh').set(CSRF)).status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const { res } = await registerWorker();
    const cookie = cookieOf(res)!;
    expect((await request(app).post('/api/v1/auth/logout').set(CSRF).set('Cookie', cookie)).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', cookie)).status).toBe(401);
  });
});

describe('phone and email verification', () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('verifies a phone with the right code and rejects wrong codes', async () => {
    const { res } = await registerWorker();
    const token = res.body.accessToken;
    const req = await request(app).post('/api/v1/auth/verify/request').set(auth(token)).send({ kind: 'PHONE' });
    expect(req.status).toBe(200);
    expect(req.body.devCode).toMatch(/^\d{6}$/);

    const wrong = req.body.devCode === '000000' ? '111111' : '000000';
    expect((await request(app).post('/api/v1/auth/verify/confirm').set(auth(token)).send({ kind: 'PHONE', code: wrong })).status).toBe(400);

    const ok = await request(app).post('/api/v1/auth/verify/confirm').set(auth(token)).send({ kind: 'PHONE', code: req.body.devCode });
    expect(ok.status).toBe(200);
    expect(ok.body.user.phoneVerified).toBe(true);
  });

  it('never stores the code in plain text and locks after too many wrong attempts', async () => {
    const { res } = await registerWorker();
    const token = res.body.accessToken;
    const req = await request(app).post('/api/v1/auth/verify/request').set(auth(token)).send({ kind: 'PHONE' });
    const stored = await prisma.otpCode.findFirstOrThrow({ where: { userId: res.body.user.id } });
    expect(stored.codeHash).not.toContain(req.body.devCode);

    const wrong = req.body.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/verify/confirm').set(auth(token)).send({ kind: 'PHONE', code: wrong });
    }
    const locked = await request(app).post('/api/v1/auth/verify/confirm').set(auth(token)).send({ kind: 'PHONE', code: req.body.devCode });
    expect(locked.status).toBe(429);
  });

  it('throttles repeated code requests', async () => {
    const { res } = await registerWorker();
    const token = res.body.accessToken;
    expect((await request(app).post('/api/v1/auth/verify/request').set(auth(token)).send({ kind: 'PHONE' })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/verify/request').set(auth(token)).send({ kind: 'PHONE' })).status).toBe(429);
  });

  it('requires an email on file for email verification', async () => {
    const { res } = await registerWorker();
    const r = await request(app).post('/api/v1/auth/verify/request').set(auth(res.body.accessToken)).send({ kind: 'EMAIL' });
    expect(r.status).toBe(400);
  });
});

describe('platform basics', () => {
  it('reports health and hides framework details', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns JSON 404 and handles malformed JSON', async () => {
    expect((await request(app).get('/nope')).status).toBe(404);
    const bad = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(bad.status).toBe(400);
  });
});

describe('password reset and change', () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('resets the password with a code, signs out old sessions and accepts the new password', async () => {
    const { body, res } = await registerWorker();
    const forgot = await request(app).post('/api/v1/auth/password/forgot').send({ phone: body.phone });
    expect(forgot.status).toBe(200);
    expect(forgot.body.devCode).toMatch(/^\d{6}$/);

    const wrong = forgot.body.devCode === '000000' ? '111111' : '000000';
    expect((await request(app).post('/api/v1/auth/password/reset').send({ phone: body.phone, code: wrong, newPassword: 'BrandNew123' })).status).toBe(400);
    const ok = await request(app).post('/api/v1/auth/password/reset').send({ phone: body.phone, code: forgot.body.devCode, newPassword: 'BrandNew123' });
    expect(ok.status).toBe(200);

    // old cookie session is revoked, old password no longer works, new one does
    const cookie = cookieOf(res)!.split(';')[0];
    expect((await request(app).post('/api/v1/auth/refresh').set(CSRF).set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ phone: body.phone, password: body.password })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ phone: body.phone, password: 'BrandNew123' })).status).toBe(200);
    // the code is single use
    expect((await request(app).post('/api/v1/auth/password/reset').send({ phone: body.phone, code: forgot.body.devCode, newPassword: 'Another123' })).status).toBe(400);
  });

  it('answers the same for an unknown phone (no account discovery)', async () => {
    const r = await request(app).post('/api/v1/auth/password/forgot').send({ phone: newPhone() });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ sent: true });
  });

  it('locks a reset code after too many wrong guesses', async () => {
    const { body } = await registerWorker();
    const forgot = await request(app).post('/api/v1/auth/password/forgot').send({ phone: body.phone });
    const wrong = forgot.body.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/password/reset').send({ phone: body.phone, code: wrong, newPassword: 'BrandNew123' });
    }
    const locked = await request(app).post('/api/v1/auth/password/reset').send({ phone: body.phone, code: forgot.body.devCode, newPassword: 'BrandNew123' });
    expect(locked.status).toBe(429);
  });

  it('changes the password for a signed-in user only with the right current password', async () => {
    const { body, res } = await registerWorker();
    const token = res.body.accessToken;
    expect((await request(app).post('/api/v1/auth/password/change').send({ currentPassword: body.password, newPassword: 'BrandNew123' })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/password/change').set(auth(token)).send({ currentPassword: 'wrong-one-1', newPassword: 'BrandNew123' })).status).toBe(400);
    const ok = await request(app).post('/api/v1/auth/password/change').set(auth(token)).send({ currentPassword: body.password, newPassword: 'BrandNew123' });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect((await request(app).post('/api/v1/auth/login').send({ phone: body.phone, password: 'BrandNew123' })).status).toBe(200);
  });
});

describe('administrator two-factor login and forced password change', () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  async function makeAdmin(extra: Record<string, unknown> = {}) {
    const phone = newPhone();
    const full = `+251${phone.slice(1)}`;
    await prisma.user.create({ data: { phone: full, passwordHash: await bcrypt.hash('AdminPass123', 4), fullName: 'T Admin', role: 'ADMIN', phoneVerifiedAt: new Date(), ...extra } });
    const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'AdminPass123' });
    return { phone, login };
  }

  it('turns on 2FA, then needs a fresh code to log in and refuses a reused one', async () => {
    const { phone, login } = await makeAdmin();
    const token = login.body.accessToken;
    const setup = await request(app).post('/api/v1/auth/2fa/setup').set(auth(token));
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

    expect((await request(app).post('/api/v1/auth/2fa/enable').set(auth(token)).send({ code: '000000' })).status).toBe(400);
    const step = stepAt();
    const enable = await request(app).post('/api/v1/auth/2fa/enable').set(auth(token)).send({ code: codeForStep(setup.body.secret, step) });
    expect(enable.status).toBe(200);
    expect(enable.body.user.twoFactorEnabled).toBe(true);

    const noCode = await request(app).post('/api/v1/auth/login').send({ phone, password: 'AdminPass123' });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('TWO_FACTOR_REQUIRED');
    // the code used to enable is spent; the next time step is accepted (drift window)
    const reused = await request(app).post('/api/v1/auth/login').send({ phone, password: 'AdminPass123', totpCode: codeForStep(setup.body.secret, step) });
    expect(reused.status).toBe(401);
    const ok = await request(app).post('/api/v1/auth/login').send({ phone, password: 'AdminPass123', totpCode: codeForStep(setup.body.secret, step + 1) });
    expect(ok.status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ phone, password: 'wrong-pass-1', totpCode: codeForStep(setup.body.secret, step + 1) })).status).toBe(401);
  });

  it('is only available to administrators', async () => {
    const { res } = await registerWorker();
    expect((await request(app).post('/api/v1/auth/2fa/setup').set(auth(res.body.accessToken))).status).toBe(403);
  });

  it('blocks everything except the account endpoints until a temporary password is replaced', async () => {
    const { login } = await makeAdmin({ mustChangePassword: true });
    const token = login.body.accessToken;
    expect(login.body.user.mustChangePassword).toBe(true);
    const blocked = await request(app).get('/api/v1/admin/overview').set(auth(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await request(app).get('/api/v1/auth/me').set(auth(token))).status).toBe(200);

    const changed = await request(app).post('/api/v1/auth/password/change').set(auth(token)).send({ currentPassword: 'AdminPass123', newPassword: 'ChosenByMe123' });
    expect(changed.status).toBe(200);
    expect((await request(app).get('/api/v1/admin/overview').set(auth(changed.body.accessToken))).status).not.toBe(403);
  });
});

describe('data export and account deletion', () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('exports your own data without secrets', async () => {
    const { body, res } = await registerWorker();
    const r = await request(app).get('/api/v1/auth/me/export').set(auth(res.body.accessToken));
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment/);
    expect(r.body.account.fullName).toBe('Test Worker');
    expect(r.body.workerProfile).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|totpSecret|codeHash|tokenHash/);
    expect((await request(app).get('/api/v1/auth/me/export')).status).toBe(401);
    void body;
  });

  it('deletes by anonymising: wrong password refused, then data gone, login impossible, phone reusable', async () => {
    const { body, res } = await registerWorker({ email: `del${Date.now()}@example.com` });
    const token = res.body.accessToken;
    const bad = await request(app).post('/api/v1/auth/me/delete').set(auth(token)).send({ password: 'not-my-password-1' });
    expect(bad.status).toBe(400);

    const ok = await request(app).post('/api/v1/auth/me/delete').set(auth(token)).send({ password: body.password });
    expect(ok.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(row.status).toBe('DELETED');
    expect(row.fullName).toBe('Deleted user');
    expect(row.email).toBeNull();
    expect(row.phone).not.toContain(String(body.phone).slice(1));
    expect(await prisma.workerProfile.count({ where: { userId: row.id } })).toBe(0);

    expect((await request(app).post('/api/v1/auth/login').send({ phone: body.phone, password: body.password })).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(auth(token))).status).toBe(401);
    // the number can be used to register again
    const again = await request(app).post('/api/v1/auth/register').send({ ...body, fullName: 'Back Again' });
    expect(again.status).toBe(201);
  });

  it('does not let an administrator delete themselves here', async () => {
    const phone = newPhone();
    await prisma.user.create({ data: { phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('AdminPass123', 4), fullName: 'T Admin', role: 'ADMIN' } });
    const login = await request(app).post('/api/v1/auth/login').send({ phone, password: 'AdminPass123' });
    expect((await request(app).post('/api/v1/auth/me/delete').set(auth(login.body.accessToken)).send({ password: 'AdminPass123' })).status).toBe(403);
  });
});
