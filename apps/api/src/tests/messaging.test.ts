import { randomInt, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { attachRealtime, closeRealtime } from '../realtime';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const app = createApp();
const server = http.createServer(app);
let url = '';
const phones: string[] = [];
const sockets: Socket[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type User = { token: string; id: string; phone: string };

async function signUp(role: 'WORKER' | 'EMPLOYER'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role} ${tag().slice(2, 6)}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Msg ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id, phone: res.body.user.phone };
}

let autoId = '';
let engineId = '';
async function liveJob(e: User) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Chat job ${tag()}`, description: `Repair vehicles. ${randomUUID()} ${randomUUID()} Please apply with your experience and references.`,
    categoryId: autoId, employmentType: 'FULL_TIME', deadline: future(30),
    locationId: (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id,
    skills: [{ skillId: engineId, importance: 'REQUIRED' }],
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  expect((await request(app).post(`/api/v1/jobs/${create.body.job.id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return create.body.job.id as string;
}
async function scenario() {
  const e = await signUp('EMPLOYER');
  const w = await signUp('WORKER');
  const jobId = await liveJob(e);
  const applicationId = (await request(app).post(`/api/v1/jobs/${jobId}/apply`).set(auth(w.token)).send({})).body.applicationId as string;
  const open = (u: User) => request(app).post(`/api/v1/applications/${applicationId}/conversation`).set(auth(u.token));
  const conversationId = (await open(e)).body.conversationId as string;
  return { e, w, jobId, applicationId, conversationId, open };
}
const send = (u: User, conv: string, body: unknown) => request(app).post(`/api/v1/conversations/${conv}/messages`).set(auth(u.token)).send({ body } as object);
const messages = (u: User, conv: string, qs = '') => request(app).get(`/api/v1/conversations/${conv}/messages${qs}`).set(auth(u.token));

function listen(token: string | undefined): Promise<{ socket: Socket; events: { name: string; data: any }[] }> {
  return new Promise((resolve, reject) => {
    const socket = connect(url, { auth: token === undefined ? {} : { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket);
    const events: { name: string; data: any }[] = [];
    socket.onAny((name, data) => events.push({ name, data }));
    socket.on('connect', () => resolve({ socket, events }));
    socket.on('connect_error', (err) => reject(err));
  });
}

beforeAll(async () => {
  autoId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  engineId = (await prisma.skill.findFirstOrThrow({ where: { slug: 'engine-repair' } })).id;
  attachRealtime(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  while (sockets.length) sockets.pop()!.close();
});
afterAll(async () => {
  await closeRealtime();
  await new Promise((r) => server.close(r));
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  for (const level of ['KEBELE', 'WOREDA'] as const) await prisma.location.deleteMany({ where: { level, nameEn: { startsWith: 'Test' } } });
  await prisma.$disconnect();
});

describe('who can talk to whom', () => {
  it('opens one conversation per application for the two parties only', async () => {
    const s = await scenario();
    const again = await s.open(s.w);
    expect(again.status).toBe(201);
    expect(again.body.conversationId).toBe(s.conversationId); // same conversation for both sides, no duplicates
    expect(await prisma.conversation.count({ where: { applicationId: s.applicationId } })).toBe(1);
    expect(await prisma.conversationParticipant.count({ where: { conversationId: s.conversationId } })).toBe(2);

    const strangerEmployer = await signUp('EMPLOYER');
    const strangerWorker = await signUp('WORKER');
    expect((await s.open(strangerEmployer)).status).toBe(404);
    expect((await s.open(strangerWorker)).status).toBe(404);
    expect((await request(app).post(`/api/v1/applications/${s.applicationId}/conversation`)).status).toBe(401);
    expect((await request(app).post('/api/v1/applications/not-a-uuid/conversation').set(auth(s.e.token))).status).toBe(404);
  });

  it('keeps conversations private from everyone else', async () => {
    const s = await scenario();
    await send(s.e, s.conversationId, 'Hello, can we talk about the job?');
    const intruders = [await signUp('WORKER'), await signUp('EMPLOYER')];
    for (const u of intruders) {
      expect((await messages(u, s.conversationId)).status).toBe(404);
      expect((await send(u, s.conversationId, 'hi')).status).toBe(404);
      expect((await request(app).post(`/api/v1/conversations/${s.conversationId}/read`).set(auth(u.token))).status).toBe(404);
      expect((await request(app).get('/api/v1/conversations').set(auth(u.token))).body.items).toEqual([]);
    }
  });

  it('lets a colleague at the employer join the conversation', async () => {
    const s = await scenario();
    const ep = await prisma.employerProfile.findUniqueOrThrow({ where: { userId: s.e.id } });
    const colleague = await signUp('EMPLOYER');
    await prisma.employerProfile.update({ where: { userId: colleague.id }, data: { organizationId: ep.organizationId } });
    const joined = await s.open(colleague);
    expect(joined.body.conversationId).toBe(s.conversationId);
    await send(s.w, s.conversationId, 'Thank you for considering me.');
    expect((await messages(colleague, s.conversationId)).body.messages).toHaveLength(1);
  });
});

describe('sending and reading', () => {
  it('delivers messages with sender names, unread counts and previews, and never exposes contact details', async () => {
    const s = await scenario();
    const sent = await send(s.e, s.conversationId, 'Can you start on Monday?');
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ mine: true, body: 'Can you start on Monday?', readAt: null });

    const workerList = (await request(app).get('/api/v1/conversations').set(auth(s.w.token))).body.items;
    expect(workerList).toHaveLength(1);
    expect(workerList[0]).toMatchObject({ unread: 1, readOnly: false, with: { role: 'EMPLOYER' } });
    expect(workerList[0].lastMessage).toMatchObject({ preview: 'Can you start on Monday?', mine: false });
    expect(workerList[0].job.title).toContain('Chat job');
    const employerList = (await request(app).get('/api/v1/conversations').set(auth(s.e.token))).body.items;
    expect(employerList[0]).toMatchObject({ unread: 0, with: { role: 'WORKER' } });
    expect((await request(app).get('/api/v1/conversations/unread-count').set(auth(s.w.token))).body.unread).toBe(1);

    const everything = JSON.stringify([workerList, employerList, (await messages(s.w, s.conversationId)).body]);
    expect(everything).not.toContain(s.w.phone);
    expect(everything).not.toContain(s.e.phone);
    expect(everything).not.toContain('passwordHash');
  });

  it('marks messages read, clears the unread count and the matching notification', async () => {
    const s = await scenario();
    await send(s.e, s.conversationId, 'First');
    await send(s.e, s.conversationId, 'Second');
    expect((await request(app).get('/api/v1/conversations/unread-count').set(auth(s.w.token))).body.unread).toBe(2);
    const read = await request(app).post(`/api/v1/conversations/${s.conversationId}/read`).set(auth(s.w.token));
    expect(read.body.marked).toBe(2);
    expect((await request(app).get('/api/v1/conversations/unread-count').set(auth(s.w.token))).body.unread).toBe(0);
    const seen = (await messages(s.e, s.conversationId)).body.messages;
    expect(seen.every((m: { readAt: string | null }) => m.readAt !== null)).toBe(true);
    expect(await prisma.notification.count({ where: { userId: s.w.id, type: 'message.new', readAt: null } })).toBe(0);
    // reading your own sent messages does nothing
    expect((await request(app).post(`/api/v1/conversations/${s.conversationId}/read`).set(auth(s.e.token))).body.marked).toBe(0);
  });

  it('shows the latest messages first in pages, oldest first inside a page', async () => {
    const s = await scenario();
    for (let i = 1; i <= 5; i++) { await send(s.e, s.conversationId, `message ${i}`); await sleep(5); }
    const page1 = (await messages(s.w, s.conversationId, '?limit=2')).body;
    expect(page1.messages.map((m: { body: string }) => m.body)).toEqual(['message 4', 'message 5']);
    expect(page1.hasMore).toBe(true);
    const before = encodeURIComponent(page1.messages[0].createdAt);
    const page2 = (await messages(s.w, s.conversationId, `?limit=2&before=${before}`)).body;
    expect(page2.messages.map((m: { body: string }) => m.body)).toEqual(['message 2', 'message 3']);
    const page3 = (await messages(s.w, s.conversationId, `?limit=2&before=${encodeURIComponent(page2.messages[0].createdAt)}`)).body;
    expect(page3.messages.map((m: { body: string }) => m.body)).toEqual(['message 1']);
    expect(page3.hasMore).toBe(false);
    expect((await messages(s.w, s.conversationId, '?limit=0')).status).toBe(400);
    expect((await messages(s.w, s.conversationId, '?before=garbage')).status).toBe(400);
  });

  it('validates message content', async () => {
    const s = await scenario();
    for (const body of ['', '   \n  ', 'x'.repeat(2001)]) expect((await send(s.e, s.conversationId, body)).status, JSON.stringify(body.slice(0, 10))).toBe(400);
    expect((await request(app).post(`/api/v1/conversations/${s.conversationId}/messages`).set(auth(s.e.token)).send({ body: 'ok', extra: 1 })).status).toBe(400);
    expect((await request(app).post(`/api/v1/conversations/${s.conversationId}/messages`).set(auth(s.e.token)).send({})).status).toBe(400);
    // control characters are removed; markup is stored as plain text, untouched (the UI escapes it)
    const r = await send(s.e, s.conversationId, 'Hi\u0000 there\u0007 <script>alert(1)</script>');
    expect(r.body.message.body).toBe('Hi there <script>alert(1)</script>');
  });

  it('collapses unread message notifications into one per conversation, without the message text', async () => {
    const s = await scenario();
    await send(s.e, s.conversationId, 'a secret detail about salary');
    await send(s.e, s.conversationId, 'another one');
    await send(s.e, s.conversationId, 'and a third');
    const list = (await request(app).get('/api/v1/notifications').set(auth(s.w.token))).body.items.filter((n: { type: string }) => n.type === 'message.new');
    expect(list).toHaveLength(1);
    expect(list[0].payload.count).toBe(3);
    expect(JSON.stringify(list[0])).not.toContain('secret');
  });
});

describe('when the application ends', () => {
  it('keeps the conversation readable but closed after a rejection or withdrawal', async () => {
    const s = await scenario();
    await send(s.w, s.conversationId, 'I am very interested.');
    await request(app).patch(`/api/v1/applications/${s.applicationId}/status`).set(auth(s.e.token)).send({ status: 'REJECTED' });
    const closed = await send(s.e, s.conversationId, 'Sorry.');
    expect(closed.status).toBe(409);
    expect((await send(s.w, s.conversationId, 'Please reconsider')).status).toBe(409);
    const read = (await messages(s.w, s.conversationId)).body;
    expect(read.readOnly).toBe(true);
    expect(read.messages).toHaveLength(1);
    expect((await request(app).get('/api/v1/conversations').set(auth(s.w.token))).body.items[0].readOnly).toBe(true);
    expect((await request(app).post(`/api/v1/conversations/${s.conversationId}/read`).set(auth(s.e.token))).status).toBe(200); // reading still works
  });

  it('does not open a new conversation for an application that has already ended', async () => {
    const s = await scenario(); // scenario() already opened one; use a second application that never had a conversation
    const w2 = await signUp('WORKER');
    const job2 = await liveJob(s.e);
    const app2 = (await request(app).post(`/api/v1/jobs/${job2}/apply`).set(auth(w2.token)).send({})).body.applicationId;
    await request(app).post(`/api/v1/applications/${app2}/withdraw`).set(auth(w2.token));
    expect((await request(app).post(`/api/v1/applications/${app2}/conversation`).set(auth(s.e.token))).status).toBe(409);
  });
});

describe('real-time delivery (Socket.IO)', () => {
  it('rejects connections without a valid token or for suspended accounts', async () => {
    const u = await signUp('WORKER');
    await expect(listen(undefined)).rejects.toThrow('unauthorized');
    await expect(listen('garbage')).rejects.toThrow('unauthorized');
    await expect(listen(jwt.sign({ role: 'WORKER' }, 'x'.repeat(40), { subject: u.id }))).rejects.toThrow('unauthorized');
    await prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
    await expect(listen(u.token)).rejects.toThrow('unauthorized');
  });

  it('pushes new messages only to the other participant', async () => {
    const s = await scenario();
    const outsider = await signUp('WORKER');
    const [worker, employer, other] = await Promise.all([listen(s.w.token), listen(s.e.token), listen(outsider.token)]);
    await send(s.e, s.conversationId, 'Live message');
    await sleep(300);
    const got = worker.events.filter((e) => e.name === 'message:new');
    expect(got).toHaveLength(1);
    expect(got[0].data).toMatchObject({ conversationId: s.conversationId, message: { body: 'Live message', mine: false } });
    expect(employer.events.filter((e) => e.name === 'message:new')).toHaveLength(0); // the sender is not echoed
    expect(other.events).toHaveLength(0); // an unrelated user hears nothing
  });

  it('pushes read receipts and in-app notifications', async () => {
    const s = await scenario();
    const employer = await listen(s.e.token);
    const worker = await listen(s.w.token);
    await send(s.e, s.conversationId, 'ping');
    await request(app).post(`/api/v1/conversations/${s.conversationId}/read`).set(auth(s.w.token));
    await sleep(300);
    expect(employer.events.some((e) => e.name === 'message:read' && e.data.conversationId === s.conversationId)).toBe(true);
    const note = worker.events.find((e) => e.name === 'notification:new' && e.data.type === 'message.new');
    expect(note?.data.payload).toMatchObject({ conversationId: s.conversationId, count: 1 });

    // application activity is pushed to the employer too
    const w2 = await signUp('WORKER');
    await request(app).post(`/api/v1/jobs/${s.jobId}/apply`).set(auth(w2.token)).send({});
    await sleep(300);
    expect(employer.events.some((e) => e.name === 'notification:new' && e.data.type === 'application.received')).toBe(true);
  });

  it('disconnects a session when its access token expires', async () => {
    const u = await signUp('WORKER');
    const short = jwt.sign({ role: 'WORKER' }, env.JWT_ACCESS_SECRET, { subject: u.id, expiresIn: 2 });
    const { socket } = await listen(short);
    const closed = new Promise<string>((resolve) => socket.on('disconnect', (reason) => resolve(reason)));
    const reason = await Promise.race([closed, sleep(6000).then(() => 'still connected')]);
    expect(reason).not.toBe('still connected');
  }, 15_000);
});
