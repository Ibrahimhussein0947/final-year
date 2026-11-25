import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const PASSWORD = 'Passw0rdTest';
const digits = String(randomInt(0, 100_000_000)).padStart(8, '0');
const phone = `09${digits}`;
const email = `email-login-${digits}@example.com`;

afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: `+251${phone.slice(1)}` } });
  await prisma.$disconnect();
});

describe('sign in with email or phone', () => {
  it('accepts either, in any letter case for the email, and rejects wrong passwords', async () => {
    await prisma.user.create({ data: { fullName: 'Email Login', phone: `+251${phone.slice(1)}`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN' } });
    const byPhone = await request(app).post('/api/v1/auth/login').send({ phone, password: PASSWORD });
    const byEmail = await request(app).post('/api/v1/auth/login').send({ phone: email.toUpperCase(), password: PASSWORD });
    expect(byPhone.status).toBe(200);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.user.id).toBe(byPhone.body.user.id);
    expect((await request(app).post('/api/v1/auth/login').send({ phone: email, password: 'wrong-Password1' })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ phone: 'nobody@example.com', password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ phone: 'not-valid', password: PASSWORD })).status).toBe(400);
  });
});
