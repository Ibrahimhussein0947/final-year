import fs from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { filePathOf } from '../modules/files/storage';
import { MAX_ITEMS } from '../modules/workers/portfolio';
import { assertDecodable } from '../modules/files/safeImage';
import { makePdf } from './helpers/pdf';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
type User = { token: string; id: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${randomUUID().slice(0, 6)}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Portfolio ${randomUUID().slice(0, 6)}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG Portfolio' } } });
  await prisma.$disconnect();
});

let weldingId = '';
beforeAll(async () => {
  weldingId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'driving-heavy' } })).id;
});

const picture = (w = 400, h = 300) => {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#a0522d'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.fillRect(20, 20, w / 2, h / 2);
  return c;
};
/** A real JPEG with an extra EXIF-style block carrying a marker we can search for. */
function jpegWithSecret(secret: string): Buffer {
  const jpg = picture().toBuffer('image/jpeg', 80);
  const payload = Buffer.from(`Exif\0\0${secret}`);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([jpg.subarray(0, 2), seg, jpg.subarray(2)]);
}
const add = (u: User, buf: Buffer, fields: Record<string, string> = {}, name = 'work.jpg') => {
  const r = request(app).post('/api/v1/workers/me/portfolio').set(auth(u.token));
  for (const [k, v] of Object.entries(fields)) r.field(k, v);
  return r.attach('file', buf, name);
};

describe('portfolio pictures', () => {
  it('re-encodes the picture, so hidden location data and oversize pixels never reach an employer', async () => {
    const w = await signUp('WORKER');
    const secret = `GPS${randomUUID().replace(/-/g, '')}`;
    const original = jpegWithSecret(secret);
    expect(original.includes(Buffer.from(secret))).toBe(true);
    const r = await add(w, original, { caption: 'Wardrobe I built for a client in Adama', skillId: weldingId });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.item).toMatchObject({ caption: 'Wardrobe I built for a client in Adama', skillId: weldingId });
    const file = await prisma.fileAsset.findFirstOrThrow({ where: { ownerId: w.id, kind: 'PORTFOLIO' } });
    const stored = fs.readFileSync(filePathOf(file.storagePath));
    expect(stored.includes(Buffer.from(secret))).toBe(false); // metadata stripped
    expect(file.mime).toBe('image/jpeg');

    const big = await add(w, picture(3200, 2400).toBuffer('image/png'), {}, 'big.png');
    expect(big.status).toBe(201);
    const bigFile = await prisma.fileAsset.findFirstOrThrow({ where: { ownerId: w.id, kind: 'PORTFOLIO' }, orderBy: { createdAt: 'desc' } });
    const dims = await import('@napi-rs/canvas').then((m) => m.loadImage(fs.readFileSync(filePathOf(bigFile.storagePath))));
    expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(1600);
  });

  it('refuses things that are not pictures, bad captions, unknown skills and more than the limit', async () => {
    const w = await signUp('WORKER');
    expect((await add(w, makePdf(['not a picture']), {}, 'a.pdf')).status).toBe(415);
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('this is not really a png file at all')]);
    expect((await add(w, fake, {}, 'fake.png')).status).toBe(415); // looks like a PNG, cannot be decoded
    expect((await add(w, picture().toBuffer('image/png'), { caption: 'x'.repeat(121) })).status).toBe(400);
    expect((await add(w, picture().toBuffer('image/png'), { skillId: randomUUID() })).status).toBe(400);
    expect((await request(app).post('/api/v1/workers/me/portfolio').set(auth(w.token))).status).toBe(400); // no file
    expect(await prisma.portfolioItem.count({ where: { worker: { userId: w.id } } })).toBe(0);
    expect(await prisma.fileAsset.count({ where: { ownerId: w.id, kind: 'PORTFOLIO' } })).toBe(0); // nothing left behind

    for (let i = 0; i < MAX_ITEMS; i++) expect((await add(w, picture(100 + i, 100).toBuffer('image/png'))).status).toBe(201);
    expect((await add(w, picture().toBuffer('image/png'))).status).toBe(409);
  });

  it('can be edited and deleted by its owner only, and deleting removes the file', async () => {
    const a = await signUp('WORKER'); const b = await signUp('WORKER');
    const id = (await add(a, picture().toBuffer('image/png'), { caption: 'First' })).body.item.id as string;
    expect((await request(app).patch(`/api/v1/workers/me/portfolio/${id}`).set(auth(b.token)).send({ caption: 'hijack' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/workers/me/portfolio/${id}`).set(auth(b.token))).status).toBe(404);
    const edit = await request(app).patch(`/api/v1/workers/me/portfolio/${id}`).set(auth(a.token)).send({ caption: 'Second', skillId: null });
    expect(edit.body.item.caption).toBe('Second');
    const file = await prisma.fileAsset.findFirstOrThrow({ where: { ownerId: a.id, kind: 'PORTFOLIO' } });
    const path = filePathOf(file.storagePath);
    expect(fs.existsSync(path)).toBe(true);
    expect((await request(app).delete(`/api/v1/workers/me/portfolio/${id}`).set(auth(a.token))).body.items).toEqual([]);
    expect(fs.existsSync(path)).toBe(false);
    expect(await prisma.fileAsset.findUnique({ where: { id: file.id } })).toBeNull();
  });
});

describe('who can see the pictures', () => {
  it('lets employers open them on a visible profile, and no one else', async () => {
    const w = await signUp('WORKER'); const other = await signUp('WORKER'); const e = await signUp('EMPLOYER');
    const item = (await add(w, picture().toBuffer('image/png'), { caption: 'Chair' })).body.item as { id: string; url: string };
    const profile = await prisma.workerProfile.findFirstOrThrow({ where: { userId: w.id } });

    expect((await request(app).get(item.url).set(auth(w.token))).status).toBe(200); // the owner
    expect((await request(app).get(item.url).set(auth(e.token))).status).toBe(200); // an employer
    expect((await request(app).get(item.url).set(auth(other.token))).status).toBe(403); // another worker
    expect((await request(app).get(item.url)).status).toBe(401);

    const view = await request(app).get(`/api/v1/workers/${profile.id}`).set(auth(e.token));
    expect(view.body.profile.portfolio).toEqual([expect.objectContaining({ id: item.id, caption: 'Chair', url: item.url })]);

    // hiding the profile hides the pictures from employers, though not from the owner
    await prisma.workerProfile.update({ where: { id: profile.id }, data: { isVisible: false } });
    expect((await request(app).get(item.url).set(auth(e.token))).status).toBe(403);
    expect((await request(app).get(item.url).set(auth(w.token))).status).toBe(200);
  });
});

describe('corrupt pictures cannot crash the server', () => {
  // A PNG with a valid header and a damaged body makes the native decoder segfault when it is decoded in-process.
  const corrupt = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('this is not really a png file at all')]);
  it('is refused by the check that runs before the CV and document reader decode a picture', async () => {
    await expect(assertDecodable(corrupt)).rejects.toMatchObject({ status: 415 });
    await expect(assertDecodable(Buffer.from('%PDF-1.4 nope'))).rejects.toMatchObject({ status: 415 });
    await expect(assertDecodable(picture().toBuffer('image/png'))).resolves.toBeUndefined();
  });
  it('is kept as an unchecked CV (never declined for being unreadable), and the server keeps answering', async () => {
    const w = await signUp('WORKER');
    const r = await request(app).post('/api/v1/workers/me/cv').set(auth(w.token)).attach('file', corrupt, 'cv.png');
    expect(r.status).toBe(201);
    expect(r.body.cvCheck.outcome).toBe('UNCHECKED'); // could not be read, so not judged
    expect((await request(app).get('/api/v1/workers/me').set(auth(w.token))).status).toBe(200);
  });
});
