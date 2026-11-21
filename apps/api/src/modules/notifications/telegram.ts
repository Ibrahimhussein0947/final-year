import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { telegram } from '../../integrations/telegram';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { badRequest, AppError } from '../../lib/errors';
import { sha256 } from '../../lib/security';

/**
 * Telegram alerts.
 *
 * Linking: the signed-in user asks for a link, we store only a hash of a one-time code (valid 15 minutes) and give back
 * https://t.me/<bot>?start=<code>. When they press Start, Telegram calls our webhook with "/start <code>", and the chat is
 * attached to that account. The chat id is never taken from anything the user types into our site, so nobody can attach
 * somebody else's Telegram.
 *
 * Alerts: like SMS, the text is generic and never contains job titles, names or messages written by other users (they could
 * be used to push phishing through our bot). At most 10 a day per person. A chat that blocked the bot is unlinked.
 */

const LINK_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_PER_DAY = 10;

export const telegramEnabled = () => telegram.configured() && !!env.TELEGRAM_BOT_USERNAME;

type Locale = 'en' | 'am' | 'om';
// Amharic and Afaan Oromoo wording are drafts that need native-speaker review, like the rest of the interface.
const SAY: Record<string, Record<Locale, string>> = {
  connected: {
    en: 'EthioTalent AI: your Telegram is connected. You will get short alerts here. Send /stop to turn them off.',
    am: 'EthioTalent AI: ቴሌግራምዎ ተገናኝቷል። እዚህ አጫጭር ማሳወቂያዎችን ያገኛሉ። ለማቆም /stop ይላኩ።',
    om: 'EthioTalent AI: Telegraamni kee wal-qabateera. Beeksisni gabaabaan asitti siif ergama. Dhaabuuf /stop ergi.',
  },
  stopped: {
    en: 'EthioTalent AI: Telegram alerts are off. You can connect again any time from your notification settings.',
    am: 'EthioTalent AI: የቴሌግራም ማሳወቂያዎች ጠፍተዋል። በማሳወቂያ ቅንብሮችዎ ውስጥ በማንኛውም ጊዜ እንደገና ማገናኘት ይችላሉ።',
    om: 'EthioTalent AI: Beeksisni Telegraam dhaabateera. Yeroo kamiyyuu qindaa’ina beeksisaa keessaan deebi’ee wal-qabsiisuu dandeessa.',
  },
  badCode: {
    en: 'EthioTalent AI: this link is no longer valid. Open your notification settings on the website and press "Connect Telegram" again.',
    am: 'EthioTalent AI: ይህ አገናኝ ጊዜው አልፏል። በድረ-ገጹ የማሳወቂያ ቅንብሮች ውስጥ "ቴሌግራም አገናኝ" ን እንደገና ይጫኑ።',
    om: 'EthioTalent AI: Hidhaan kun hin hojjetu. Marsariitii irratti qindaa’ina beeksisaa keessaa “Telegraam wal-qabsiisi” irra deebi’ii cuqaasi.',
  },
  taken: {
    en: 'EthioTalent AI: this Telegram chat is already connected to another account. Send /stop there first.',
    am: 'EthioTalent AI: ይህ የቴሌግራም ውይይት ከሌላ መለያ ጋር ተገናኝቷል። መጀመሪያ በዚያ /stop ይላኩ።',
    om: 'EthioTalent AI: Haasaan Telegraam kun akkaawuntii biraa waliin wal-qabateera. Dursa achitti /stop ergi.',
  },
  help: {
    en: 'EthioTalent AI job alerts. To connect: sign in on the website, open your notification settings and press "Connect Telegram". Send /stop to turn alerts off.',
    am: 'EthioTalent AI የሥራ ማሳወቂያዎች። ለማገናኘት፦ በድረ-ገጹ ይግቡ፣ የማሳወቂያ ቅንብሮችን ይክፈቱ እና "ቴሌግራም አገናኝ" ን ይጫኑ። ለማቆም /stop ይላኩ።',
    om: 'Beeksisa hojii EthioTalent AI. Wal-qabsiisuuf: marsariitii seeni, qindaa’ina beeksisaa bani, “Telegraam wal-qabsiisi” cuqaasi. Dhaabuuf /stop ergi.',
  },
};
const say = (key: keyof typeof SAY, locale: string | null | undefined) => SAY[key][(['en', 'am', 'om'] as const).find((l) => l === locale) ?? 'en'];

// ───────────── Linking ─────────────

export async function startLink(userId: string) {
  if (!telegramEnabled()) throw new AppError(503, 'TELEGRAM_OFF', 'Telegram alerts are not set up on this server');
  const code = randomBytes(24).toString('base64url'); // 32 characters: fits Telegram's 64-character start parameter
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await prisma.user.update({ where: { id: userId }, data: { telegramLinkHash: sha256(code), telegramLinkExpiresAt: expiresAt } });
  return { url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${code}`, expiresAt };
}

export async function unlinkTelegram(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { telegramChatId: null, telegramLinkedAt: null, notifyTelegram: false, telegramLinkHash: null, telegramLinkExpiresAt: null },
  });
}

// ───────────── The webhook ─────────────

const updateSchema = z.object({
  message: z.object({
    text: z.string().max(4096).optional(),
    chat: z.object({ id: z.union([z.number(), z.string()]), type: z.string() }),
  }).optional(),
});

/** Handles one update from Telegram. Never throws: Telegram retries on errors, and a bad update must not loop. */
export async function handleUpdate(raw: unknown): Promise<void> {
  const parsed = updateSchema.safeParse(raw);
  const msg = parsed.success ? parsed.data.message : undefined;
  if (!msg || msg.chat.type !== 'private' || !msg.text) return; // groups, channels and non-text updates are ignored
  const chatId = String(msg.chat.id);
  const [command, arg] = msg.text.trim().split(/\s+/, 2);
  const cmd = command.toLowerCase().replace(/@\w+$/, ''); // "/start@MyBot" in some clients
  const reply = (text: string) => telegram.sendMessage(chatId, text);

  try {
    if (cmd === '/start' && arg) {
      const user = await prisma.user.findFirst({
        where: { telegramLinkHash: sha256(arg), telegramLinkExpiresAt: { gt: new Date() }, status: 'ACTIVE' },
        select: { id: true, locale: true },
      });
      if (!user) return void (await reply(say('badCode', null)));
      const holder = await prisma.user.findUnique({ where: { telegramChatId: chatId }, select: { id: true } });
      if (holder && holder.id !== user.id) return void (await reply(say('taken', user.locale)));
      await prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: chatId, telegramLinkedAt: new Date(), notifyTelegram: true, telegramLinkHash: null, telegramLinkExpiresAt: null },
      });
      await prisma.auditLog.create({ data: { actorId: user.id, action: 'telegram.linked', entityType: 'User', entityId: user.id } });
      await reply(say('connected', user.locale));
    } else if (cmd === '/stop') {
      const user = await prisma.user.findUnique({ where: { telegramChatId: chatId }, select: { id: true, locale: true } });
      if (user) {
        await unlinkTelegram(user.id);
        await prisma.auditLog.create({ data: { actorId: user.id, action: 'telegram.unlinked', entityType: 'User', entityId: user.id } });
      }
      await reply(say('stopped', user?.locale));
    } else if (cmd === '/start' || cmd === '/help') {
      const user = await prisma.user.findUnique({ where: { telegramChatId: chatId }, select: { locale: true } });
      await reply(say('help', user?.locale));
    }
  } catch (err) {
    logger.error({ err: String(err) }, 'telegram update failed');
  }
}

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function telegramWebhookRouter() {
  const router = Router();
  router.post('/webhook', async (req, res) => {
    const secret = env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || !telegram.configured()) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    const sent = req.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!sameSecret(sent, secret)) return void res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid secret' } });
    await handleUpdate(req.body);
    res.json({ ok: true });
  });
  return router;
}

// ───────────── Sending alerts ─────────────

/**
 * Generic alert text. Only numbers and our own enums are used, never text another user wrote. The link goes to our own site.
 */
export function telegramTextFor(type: string, payload: Record<string, unknown>): string | null {
  const base = env.publicUrl;
  const link = (path = '') => (base ? `\n${base}${path}` : '');
  const id = typeof payload.jobId === 'string' && /^[0-9a-f-]{36}$/i.test(payload.jobId) ? payload.jobId : null;
  switch (type) {
    case 'job.recommended': {
      const score = Number(payload.score);
      return `EthioTalent AI: a new job matches your profile${Number.isFinite(score) ? ` (${Math.round(score)}% match)` : ''}.${link(id ? `/jobs/${id}` : '')}`;
    }
    case 'search.match':
    case 'job.matches':
      return `EthioTalent AI: a new job matches one of your saved searches.${link(id ? `/jobs/${id}` : '/jobs')}`;
    case 'job.invitation':
      return `EthioTalent AI: an employer invited you to apply for a job. Open the app to see it.${link()}`;
    case 'interview.reminder':
      return payload.audience === 'worker' ? `EthioTalent AI: you have an interview coming up. Open the app for the time and place.${link()}` : null;
    case 'interview.scheduled':
      return `EthioTalent AI: an interview has been scheduled for you. Open the app for the details.${link()}`;
    case 'offer.made':
      return `EthioTalent AI: you have a job offer. Open the app to read it and answer.${link()}`;
    case 'application.status':
      return ['SHORTLISTED', 'ACCEPTED', 'REJECTED'].includes(String(payload.status))
        ? `EthioTalent AI: the status of one of your applications has changed. Open the app to see it.${link()}`
        : null;
    default:
      return null;
  }
}

export async function sendTelegramIfAllowed(userId: string, text: string) {
  if (!telegram.configured()) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true, notifyTelegram: true, status: true } });
  if (!user || user.status !== 'ACTIVE' || !user.notifyTelegram || !user.telegramChatId) return;
  const sentToday = await prisma.auditLog.count({ where: { actorId: userId, action: 'telegram.sent', createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (sentToday >= TELEGRAM_PER_DAY) return;
  const outcome = await telegram.sendMessage(user.telegramChatId, text);
  if (outcome === 'sent') await prisma.auditLog.create({ data: { actorId: userId, action: 'telegram.sent', entityType: 'Notification' } });
  else if (outcome === 'blocked') {
    await unlinkTelegram(userId); // the person blocked the bot or left: stop trying
    await prisma.auditLog.create({ data: { actorId: userId, action: 'telegram.unlinked', entityType: 'User', entityId: userId, meta: { reason: 'blocked' } } });
  }
}

export const assertLinked = async (userId: string) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { telegramChatId: true } });
  if (!u.telegramChatId) throw badRequest('Connect your Telegram first');
};
