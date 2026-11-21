import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { assertClean, createClamdScanner, setVirusScanner } from '../modules/files/antivirus';
import { uploadRoot } from '../modules/files/storage';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

// A harmless marker the fake daemon treats as a virus. The real EICAR string is avoided on purpose: desktop antivirus
// programs quarantine any file that contains it, including this one.
const MARKER = 'TEST-MALWARE-MARKER-12345';

type Fake = { port: number; received: Buffer[]; close: () => Promise<void> };
/** Speaks just enough of clamd's zINSTREAM protocol: reads framed chunks, answers OK or FOUND. */
function fakeClamd(mode: 'normal' | 'error' | 'silent' = 'normal'): Promise<Fake> {
  const received: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const srv = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (mode === 'silent') return;
      const cmd = 'zINSTREAM\0';
      if (buf.length < cmd.length) return;
      expect(buf.subarray(0, cmd.length).toString()).toBe(cmd);
      let pos = cmd.length;
      const parts: Buffer[] = [];
      for (;;) {
        if (buf.length < pos + 4) return; // wait for more
        const len = buf.readUInt32BE(pos);
        pos += 4;
        if (len === 0) break;
        if (buf.length < pos + len) return;
        parts.push(buf.subarray(pos, pos + len));
        pos += len;
      }
      const body = Buffer.concat(parts);
      received.push(body);
      if (mode === 'error') socket.end('INSTREAM size limit exceeded. ERROR\0');
      else socket.end(body.includes(MARKER) ? 'stream: Test-Malware.Marker FOUND\0' : 'stream: OK\0');
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) =>
    srv.listen(0, '127.0.0.1', () =>
      resolve({
        port: (srv.address() as AddressInfo).port,
        received,
        close: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); srv.close(() => r()); }),
      }),
    ),
  );
}

afterEach(() => {
  setVirusScanner(null);
  env.CLAMAV_REQUIRED = false;
});

describe('clamd client', () => {
  it('sends the stream in framed chunks and reads a clean answer', async () => {
    const f = await fakeClamd();
    const data = Buffer.alloc(200 * 1024, 7); // more than one 64 KB chunk
    expect(await createClamdScanner('127.0.0.1', f.port)(data)).toEqual({ status: 'clean' });
    expect(f.received[0].equals(data)).toBe(true); // reassembled exactly
    await f.close();
  });

  it('reports the signature when a virus is found, even at the end of a large file', async () => {
    const f = await fakeClamd();
    const data = Buffer.concat([Buffer.alloc(150 * 1024, 1), Buffer.from(MARKER)]);
    expect(await createClamdScanner('127.0.0.1', f.port)(data)).toEqual({ status: 'infected', signature: 'Test-Malware.Marker' });
    await f.close();
  });

  it('rejects on daemon errors, a refused connection and a daemon that never answers', async () => {
    const bad = await fakeClamd('error');
    await expect(createClamdScanner('127.0.0.1', bad.port)(Buffer.from('x'))).rejects.toThrow('ERROR');
    await bad.close();

    const gone = await fakeClamd();
    const port = gone.port;
    await gone.close();
    await expect(createClamdScanner('127.0.0.1', port)(Buffer.from('x'))).rejects.toThrow();

    const silent = await fakeClamd('silent');
    await expect(createClamdScanner('127.0.0.1', silent.port, 300)(Buffer.from('x'))).rejects.toThrow('timed out');
    await silent.close();
  });
});

describe('assertClean policy', () => {
  const failing = async () => { throw new Error('down'); };

  it('does nothing when scanning is not configured', async () => {
    await expect(assertClean(Buffer.from('x'), 'u', 'CV')).resolves.toBeUndefined();
  });

  it('lets uploads through when the scanner is down, unless scanning is required', async () => {
    setVirusScanner(failing);
    await expect(assertClean(Buffer.from('x'), 'u', 'CV')).resolves.toBeUndefined();
    env.CLAMAV_REQUIRED = true;
    await expect(assertClean(Buffer.from('x'), 'u', 'CV')).rejects.toMatchObject({ status: 503, code: 'SCAN_UNAVAILABLE' });
    setVirusScanner(null); // required but not configured at all is also refused
    await expect(assertClean(Buffer.from('x'), 'u', 'CV')).rejects.toBeInstanceOf(AppError);
  });
});

// ───────── Through the real upload route ─────────

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
let token = '';
let userId = '';

beforeAll(async () => {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test Av', phone: p, password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', zone: 'Adama', language: 'en' });
  expect(res.status).toBe(201);
  token = res.body.accessToken;
  userId = res.body.user.id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.$disconnect();
});

describe('uploads with scanning on', () => {
  it('accepts a clean file and blocks an infected one before it reaches the disk', async () => {
    const f = await fakeClamd();
    setVirusScanner(createClamdScanner('127.0.0.1', f.port));

    const ok = await request(app).post('/api/v1/workers/me/photo').set(auth(token)).attach('file', PNG, 'me.png');
    expect(ok.status).toBe(201);

    const filesBefore = (await fs.readdir(uploadRoot)).length;
    const assetsBefore = await prisma.fileAsset.count({ where: { ownerId: userId } });
    const infected = Buffer.concat([PNG, Buffer.from(MARKER)]);
    const bad = await request(app).post('/api/v1/workers/me/photo').set(auth(token)).attach('file', infected, 'evil.png');
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('MALWARE_DETECTED');
    expect(bad.body.error.message).not.toContain('Test-Malware'); // the signature name stays in the audit log, not in the reply
    expect((await fs.readdir(uploadRoot)).length).toBe(filesBefore);
    expect(await prisma.fileAsset.count({ where: { ownerId: userId } })).toBe(assetsBefore);

    const logged = await prisma.auditLog.findFirstOrThrow({ where: { actorId: userId, action: 'file.malware_blocked' } });
    expect(logged.meta).toMatchObject({ kind: 'PROFILE_PHOTO', signature: 'Test-Malware.Marker' });
    await f.close();
  });

  it('refuses every upload while the scanner is down and scanning is required', async () => {
    const f = await fakeClamd();
    const port = f.port;
    await f.close();
    setVirusScanner(createClamdScanner('127.0.0.1', port));
    env.CLAMAV_REQUIRED = true;
    const res = await request(app).post('/api/v1/workers/me/photo').set(auth(token)).attach('file', PNG, 'me.png');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SCAN_UNAVAILABLE');

    env.CLAMAV_REQUIRED = false; // fail-open by default
    expect((await request(app).post('/api/v1/workers/me/photo').set(auth(token)).attach('file', PNG, 'me.png')).status).toBe(201);
  });
});
