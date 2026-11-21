import { randomInt, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { env } from '../config/env';
import { createTelegramClient, noTelegram, setTelegram, type SendOutcome, type TelegramClient } from '../integrations/telegram';
import { prisma } from '../lib/prisma';
import { sha256 } from '../lib/security';
import { notify } from '../modules/notifications/service';
import { telegramTextFor } from '../modules/notifications/telegram';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

const SECRET = 'test-webhook-secret-123456';
const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
type User = { token: string; id: string };

async function worker(locale: 'en' | 'am' | 'om' = 'en'): Promise<User> {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test Tg', phone: p, password: 'Passw0rdTest', role: 'WORKER', region: 'Oromia', zone: 'Adama', language: locale });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

type Sent = { chatId: string; text: string };
function fakeTelegram(outcome: () => SendOutcome = () => 'sent'): { client: TelegramClient; sent: Sent[] } {
  const sent: Sent[] = [];
  return { sent, client: { configured: () => true, sendMessage: async (chatId, text) => { sent.push({ chatId, text }); return outcome(); } } };
}
const update = (chatId: number | string, text: string, type = 'private') => ({ update_id: 1, message: { message_id: 1, text, chat: { id: chatId, type } } });
const hook = (body: unknown, secret: string | null = SECRET) => {
  const r = request(app).post('/api/v1/telegram/webhook');
  return (secret === null ? r : r.set('X-Telegram-Bot-Api-Secret-Token', secret)).send(body as object);
};
const newChat = () => 1_000_000_000 + randomInt(0, 900_000_000);

function enable(fake: TelegramClient) {
  env.TELEGRAM_BOT_USERNAME = 'EthioTestBot';
  env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  env.publicUrl = 'https://jobs.test.example';
  setTelegram(fake);
}
afterEach(() => {
  env.TELEGRAM_BOT_USERNAME = undefined;
  env.TELEGRAM_WEBHOOK_SECRET = undefined;
  env.publicUrl = null;
  setTelegram(noTelegram);
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.$disconnect();
});

/** Links a fresh worker through the real flow and returns the chat id. */
async function linked(fake: ReturnType<typeof fakeTelegram>, locale: 'en' | 'am' | 'om' = 'en') {
  const w = await worker(locale);
  const link = await request(app).post('/api/v1/notifications/telegram/link').set(auth(w.token));
  expect(link.status).toBe(200);
  const chat = newChat();
  await hook(update(chat, `/start ${new URL(link.body.url).searchParams.get('start')}`));
  fake.sent.length = 0;
  return { w, chat: String(chat) };
}

// ───────── The Bot API client ─────────

describe('Telegram client', () => {
  function api(status: number, body: unknown) {
    const calls: { url: string; body: any }[] = [];
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        calls.push({ url: req.url ?? '', body: JSON.parse(raw || '{}') });
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      });
    });
    return new Promise<{ base: string; calls: typeof calls; close: () => Promise<void> }>((resolve) =>
      srv.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, calls, close: () => new Promise((r) => srv.close(() => r())) })),
    );
  }
  const send = async (status: number, body: unknown) => {
    const s = await api(status, body);
    const outcome = await createTelegramClient('123456:ABC-token-value-xyz', fetch, s.base).sendMessage('42', 'hello');
    await s.close();
    return { outcome, calls: s.calls };
  };

  it('posts sendMessage with the chat id and no link preview', async () => {
    const { outcome, calls } = await send(200, { ok: true });
    expect(outcome).toBe('sent');
    expect(calls[0].url).toBe('/bot123456:ABC-token-value-xyz/sendMessage');
    expect(calls[0].body).toEqual({ chat_id: '42', text: 'hello', disable_web_page_preview: true });
  });

  it('tells a blocked or missing chat apart from a temporary failure', async () => {
    expect((await send(403, { ok: false, description: 'Forbidden: bot was blocked by the user' })).outcome).toBe('blocked');
    expect((await send(400, { ok: false, description: 'Bad Request: chat not found' })).outcome).toBe('blocked');
    expect((await send(400, { ok: false, description: 'Bad Request: message is too long' })).outcome).toBe('failed');
    expect((await send(500, {})).outcome).toBe('failed');
  });

  it('never throws when the network is down', async () => {
    expect(await createTelegramClient('123456:ABC-token-value-xyz', fetch, 'http://127.0.0.1:1').sendMessage('42', 'x')).toBe('failed');
  });
});

describe('alert text', () => {
  it('is generic: never carries job titles, names or other text written by users', () => {
    env.publicUrl = 'https://jobs.test.example';
    const id = randomUUID();
    const t = telegramTextFor('job.recommended', { jobId: id, jobTitle: 'Send 500 birr to 0911 NOW', organizationName: 'Evil Ltd', score: 87.4 })!;
    expect(t).toContain('87% match');
    expect(t).toContain(`https://jobs.test.example/jobs/${id}`);
    expect(t).not.toMatch(/Send 500|0911|Evil/);
    expect(telegramTextFor('job.recommended', { jobId: 'http://evil.example', score: 'abc' })).not.toContain('evil');
    expect(telegramTextFor('message.new', {})).toBeNull();
    expect(telegramTextFor('application.status', { status: 'UNDER_REVIEW' })).toBeNull();
    expect(telegramTextFor('interview.reminder', { audience: 'employer' })).toBeNull();
    env.publicUrl = null;
    expect(telegramTextFor('job.recommended', { score: 90 })).not.toContain('http');
  });
});

// ───────── Linking ─────────

describe('connecting a Telegram account', () => {
  it('is unavailable until the server is configured', async () => {
    const w = await worker();
    expect((await request(app).post('/api/v1/notifications/telegram/link').set(auth(w.token))).status).toBe(503);
    const s = await request(app).get('/api/v1/notifications/settings').set(auth(w.token));
    expect(s.body).toMatchObject({ telegramConfigured: false, telegramLinked: false, notifyTelegram: false });
    expect((await hook(update(1, '/start x'))).status).toBe(404); // webhook is off without a secret
  });

  it('links through a one-time code, in the user language, and never exposes the chat id', async () => {
    const f = fakeTelegram();
    enable(f.client);
    const w = await worker('am');
    expect((await request(app).post('/api/v1/notifications/telegram/link')).status).toBe(401);

    const link = await request(app).post('/api/v1/notifications/telegram/link').set(auth(w.token));
    expect(link.status).toBe(200);
    const url = new URL(link.body.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://t.me/EthioTestBot');
    const code = url.searchParams.get('start')!;
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: w.id } });
    expect(row.telegramLinkHash).toBe(sha256(code)); // only a hash is stored
    expect(JSON.stringify(row)).not.toContain(code);

    const chat = newChat();
    expect((await hook(update(chat, `/start ${code}`))).status).toBe(200);
    expect(f.sent).toEqual([{ chatId: String(chat), text: expect.stringContaining('ተገናኝቷል') }]); // Amharic confirmation

    const settings = await request(app).get('/api/v1/notifications/settings').set(auth(w.token));
    expect(settings.body).toMatchObject({ telegramConfigured: true, telegramLinked: true, notifyTelegram: true });
    expect(JSON.stringify(settings.body)).not.toContain(String(chat));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: w.id } });
    expect(after).toMatchObject({ telegramChatId: String(chat), telegramLinkHash: null, notifyTelegram: true });
    expect(await prisma.auditLog.count({ where: { actorId: w.id, action: 'telegram.linked' } })).toBe(1);
  });

  it('rejects a reused, expired, wrong or foreign code without linking anything', async () => {
    const f = fakeTelegram();
    enable(f.client);
    const w = await worker();
    const code = new URL((await request(app).post('/api/v1/notifications/telegram/link').set(auth(w.token))).body.url).searchParams.get('start')!;
    expect((await hook(update(newChat(), `/start ${code}`))).status).toBe(200);
    f.sent.length = 0;

    const intruder = newChat();
    await hook(update(intruder, `/start ${code}`)); // single use
    await hook(update(intruder, '/start not-a-real-code'));
    expect(f.sent).toHaveLength(2);
    expect(f.sent.every((m) => m.text.includes('no longer valid'))).toBe(true);
    expect(await prisma.user.count({ where: { telegramChatId: String(intruder) } })).toBe(0);

    const w2 = await worker();
    const code2 = new URL((await request(app).post('/api/v1/notifications/telegram/link').set(auth(w2.token))).body.url).searchParams.get('start')!;
    await prisma.user.update({ where: { id: w2.id }, data: { telegramLinkExpiresAt: new Date(Date.now() - 1000) } });
    f.sent.length = 0;
    await hook(update(intruder, `/start ${code2}`));
    expect(f.sent[0].text).toContain('no longer valid');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w2.id } })).telegramChatId).toBeNull();
  });

  it('does not let one chat be attached to two accounts', async () => {
    const f = fakeTelegram();
    enable(f.client);
    const first = await linked(f);
    const w2 = await worker();
    const code = new URL((await request(app).post('/api/v1/notifications/telegram/link').set(auth(w2.token))).body.url).searchParams.get('start')!;
    await hook(update(first.chat, `/start ${code}`));
    expect(f.sent[0].text).toContain('already connected');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w2.id } })).telegramChatId).toBeNull();
  });

  it('checks the webhook secret and ignores groups and odd updates', async () => {
    const f = fakeTelegram();
    enable(f.client);
    expect((await hook(update(1, '/help'), null)).status).toBe(401);
    expect((await hook(update(1, '/help'), 'wrong-secret-value-123456')).status).toBe(401);
    expect(f.sent).toHaveLength(0);
    await hook(update(-100123, '/help', 'supergroup'));
    await hook({ edited_message: { text: '/help' } });
    await hook({ message: { chat: { id: 5, type: 'private' } } }); // no text
    await hook('garbage');
    expect(f.sent).toHaveLength(0);
    expect((await hook(update(7, '/help'))).status).toBe(200);
    expect(f.sent).toHaveLength(1); // a stranger just gets the help text
    expect(f.sent[0].text).toContain('Connect Telegram');
  });

  it('disconnects from the website and with /stop', async () => {
    const f = fakeTelegram();
    enable(f.client);
    const a = await linked(f);
    expect((await request(app).delete('/api/v1/notifications/telegram').set(auth(a.w.token))).status).toBe(204);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: a.w.id } })).toMatchObject({ telegramChatId: null, notifyTelegram: false });

    const b = await linked(f);
    await hook(update(b.chat, '/stop'));
    expect(f.sent[0].text).toContain('alerts are off');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: b.w.id } })).toMatchObject({ telegramChatId: null, notifyTelegram: false });
  });
});

// ───────── Sending alerts ─────────

describe('Telegram alerts', () => {
  it('reach a linked, opted-in worker with generic text', async () => {
    const f = fakeTelegram();
    enable(f.client);
    const { w, chat } = await linked(f);
    await notify(w.id, 'job.recommended', { jobId: randomUUID(), jobTitle: 'Click http://evil.example', score: 91 });
    expect(f.sent).toEqual([{ chatId: chat, text: expect.stringContaining('91% match') }]);
    expect(f.sent[0].text).not.toContain('evil');
    await notify(w.id, 'message.new', {}); // not an alert type
    await notify(w.id, 'application.status', { status: 'UNDER_REVIEW' });
    expect(f.sent).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: w.id } })).toBe(3); // the in-app copy is always kept
  });

  it('respect the opt-out switch, and need a linked chat to be switched on', async () => {
    const f = fakeTelegram();
    enable(f.client);
    const lone = await worker();
    expect((await request(app).patch('/api/v1/notifications/settings').set(auth(lone.token)).send({ notifyTelegram: true })).status).toBe(400);

    const { w } = await linked(f);
    const off = await request(app).patch('/api/v1/notifications/settings').set(auth(w.token)).send({ notifyTelegram: false });
    expect(off.body.notifyTelegram).toBe(false);
    await notify(w.id, 'offer.made', {});
    expect(f.sent).toHaveLength(0);
    await request(app).patch('/api/v1/notifications/settings').set(auth(w.token)).send({ notifyTelegram: true });
    await notify(w.id, 'offer.made', {});
    expect(f.sent).toHaveLength(1);
  });

  it('are capped at ten a day', async () => {
    const f = fakeTelegram();
    enable(f.client);
    const { w } = await linked(f);
    for (let i = 0; i < 14; i++) await notify(w.id, 'job.recommended', { score: 80 });
    expect(f.sent).toHaveLength(10);
    expect(await prisma.auditLog.count({ where: { actorId: w.id, action: 'telegram.sent' } })).toBe(10);
  });

  it('unlink the chat when the person has blocked the bot, and do not count failed sends', async () => {
    let outcome: SendOutcome = 'failed';
    const f = fakeTelegram(() => outcome);
    enable(f.client);
    const { w } = await linked(f);
    await notify(w.id, 'offer.made', {}); // temporary failure: stays linked, not counted
    expect(await prisma.user.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({ notifyTelegram: true });
    expect(await prisma.auditLog.count({ where: { actorId: w.id, action: 'telegram.sent' } })).toBe(0);
    outcome = 'blocked';
    await notify(w.id, 'offer.made', {});
    expect(await prisma.user.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({ telegramChatId: null, notifyTelegram: false });
  });

  it('are not sent to suspended accounts or when Telegram is not configured', async () => {
    const f = fakeTelegram();
    enable(f.client);
    const { w } = await linked(f);
    await prisma.user.update({ where: { id: w.id }, data: { status: 'SUSPENDED' } });
    await notify(w.id, 'offer.made', {});
    expect(f.sent).toHaveLength(0);
    await prisma.user.update({ where: { id: w.id }, data: { status: 'ACTIVE' } });
    setTelegram(noTelegram);
    await notify(w.id, 'offer.made', {});
    expect(f.sent).toHaveLength(0);
  });
});
