import { randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const phone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
let adminId = '';
let adminToken = '';
let workerToken = '';
let regionId = '';
const made: string[] = [];

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { fullName: 'Test Admin Places', phone: `+251${phone.slice(1)}`, passwordHash: await bcrypt.hash('Passw0rdTest', 4), role: 'ADMIN' } });
  adminId = admin.id;
  adminToken = (await request(app).post('/api/v1/auth/login').send({ phone, password: 'Passw0rdTest' })).body.accessToken;
  const wPhone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  const w = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test Worker Places', phone: wPhone, password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  workerToken = w.body.accessToken;
  regionId = (await prisma.location.findFirstOrThrow({ where: { level: 'REGION', nameEn: 'Oromia' } })).id;
});

afterAll(async () => {
  // children first: the parent link is not cascading
  for (const level of ['KEBELE', 'WOREDA', 'ZONE'] as const) await prisma.location.deleteMany({ where: { id: { in: made }, level } });
  await prisma.user.deleteMany({ where: { OR: [{ id: adminId }, { fullName: 'Test Worker Places' }] } });
  await prisma.$disconnect();
});

describe('admin places', () => {
  it('adds a zone, a woreda and a kebele, each level following from its parent', async () => {
    const zone = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: regionId, nameEn: `${tag()} zone` });
    expect(zone.status).toBe(201);
    expect(zone.body.location.level).toBe('ZONE');
    made.push(zone.body.location.id);
    const woreda = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: zone.body.location.id, nameEn: `${tag()} woreda`, nameAm: 'ወረዳ' });
    expect(woreda.body.location).toMatchObject({ level: 'WOREDA', nameAm: 'ወረዳ', nameOm: null });
    made.push(woreda.body.location.id);
    const kebele = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: woreda.body.location.id, nameEn: `${tag()} kebele` });
    expect(kebele.body.location.level).toBe('KEBELE');
    made.push(kebele.body.location.id);
    // the public list shows the new kebele under its woreda, with the Amharic label of the woreda in the zone list
    const list = await request(app).get(`/api/v1/locations?parentId=${zone.body.location.id}`);
    expect(list.body.items[0]).toMatchObject({ level: 'WOREDA', nameAm: 'ወረዳ' });
  });

  it('refuses a place inside a kebele, a duplicate name, an unknown parent and non-admins', async () => {
    const zone = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: regionId, nameEn: `${tag()} zone` });
    made.push(zone.body.location.id);
    const dup = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: regionId, nameEn: zone.body.location.nameEn });
    expect(dup.status).toBe(409);
    const woreda = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: zone.body.location.id, nameEn: `${tag()} w` });
    made.push(woreda.body.location.id);
    const kebele = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: woreda.body.location.id, nameEn: `${tag()} k` });
    made.push(kebele.body.location.id);
    const inside = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: kebele.body.location.id, nameEn: 'nope' });
    expect(inside.status).toBe(400);
    const unknown = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: randomUUID(), nameEn: 'nope' });
    expect(unknown.status).toBe(400);
    const worker = await request(app).post('/api/v1/admin/locations').set(auth(workerToken)).send({ parentId: regionId, nameEn: 'nope' });
    expect(worker.status).toBe(403);
  });

  it('edits the Amharic and Afaan Oromoo labels and rejects an empty change or a name clash', async () => {
    const a = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: regionId, nameEn: `${tag()} a` });
    const b = await request(app).post('/api/v1/admin/locations').set(auth(adminToken)).send({ parentId: regionId, nameEn: `${tag()} b` });
    made.push(a.body.location.id, b.body.location.id);
    const ok = await request(app).patch(`/api/v1/admin/locations/${a.body.location.id}`).set(auth(adminToken)).send({ nameAm: 'አ', nameOm: 'A' });
    expect(ok.body.location).toMatchObject({ nameAm: 'አ', nameOm: 'A' });
    const cleared = await request(app).patch(`/api/v1/admin/locations/${a.body.location.id}`).set(auth(adminToken)).send({ nameAm: '' });
    expect(cleared.body.location.nameAm).toBeNull();
    expect((await request(app).patch(`/api/v1/admin/locations/${a.body.location.id}`).set(auth(adminToken)).send({})).status).toBe(400);
    const clash = await request(app).patch(`/api/v1/admin/locations/${a.body.location.id}`).set(auth(adminToken)).send({ nameEn: b.body.location.nameEn });
    expect(clash.status).toBe(409);
    expect((await request(app).patch(`/api/v1/admin/locations/${randomUUID()}`).set(auth(adminToken)).send({ nameAm: 'x' })).status).toBe(404);
  });
});
