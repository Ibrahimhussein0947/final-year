import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Telegram Bot API client (sendMessage only). Plain fetch, no package.
 * 'blocked' means the user stopped the bot or deleted the chat, so the caller should unlink it. Delivery is best effort and
 * never throws. The bot token is part of the request URL, so it is scrubbed from anything that gets logged.
 */
export type SendOutcome = 'sent' | 'blocked' | 'failed';
export interface TelegramClient {
  configured(): boolean;
  sendMessage(chatId: string, text: string): Promise<SendOutcome>;
}

export function createTelegramClient(token: string, fetchImpl: typeof fetch = fetch, baseUrl = 'https://api.telegram.org'): TelegramClient {
  const scrub = (s: string) => s.split(token).join('[token]');
  return {
    configured: () => true,
    async sendMessage(chatId, text) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetchImpl(`${baseUrl}/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
          signal: controller.signal,
        });
        if (res.ok) return 'sent';
        if (res.status === 403) return 'blocked'; // "Forbidden: bot was blocked by the user"
        const body = (await res.json().catch(() => null)) as { description?: string } | null;
        if (res.status === 400 && /chat not found/i.test(body?.description ?? '')) return 'blocked';
        logger.warn({ status: res.status, description: scrub(body?.description ?? '') }, 'Telegram delivery failed');
        return 'failed';
      } catch (err) {
        logger.warn({ err: scrub(String(err)) }, 'Telegram delivery failed');
        return 'failed';
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const noTelegram: TelegramClient = { configured: () => false, sendMessage: async () => 'failed' };

export let telegram: TelegramClient = env.TELEGRAM_BOT_TOKEN ? createTelegramClient(env.TELEGRAM_BOT_TOKEN) : noTelegram;
export function setTelegram(client: TelegramClient) {
  telegram = client;
}
