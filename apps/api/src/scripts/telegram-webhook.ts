/**
 * Tells Telegram where to send bot updates. Run once after deploying (and again if the address or secret changes):
 *   npm run telegram:webhook -- https://jobs.example.com
 * Uses TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from apps/api/.env. Telegram only accepts https addresses.
 * Pass "delete" instead of an address to remove the webhook.
 */
import { env } from '../config/env';

async function main() {
  const arg = process.argv[2];
  const token = env.TELEGRAM_BOT_TOKEN;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in apps/api/.env first');
  if (!arg) throw new Error('Usage: npm run telegram:webhook -- https://your-public-site   (or "delete")');

  const body = arg === 'delete'
    ? {}
    : { url: `${arg.replace(/\/+$/, '')}/api/v1/telegram/webhook`, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true };
  if (arg !== 'delete' && !(body as { url: string }).url.startsWith('https://')) throw new Error('Telegram only accepts https:// webhook addresses');

  const res = await fetch(`https://api.telegram.org/bot${token}/${arg === 'delete' ? 'deleteWebhook' : 'setWebhook'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  // eslint-disable-next-line no-console
  console.log(data?.ok ? (arg === 'delete' ? 'Webhook removed.' : `Webhook set to ${(body as { url: string }).url}`) : `Telegram answered: ${data?.description ?? res.status}`);
  if (!data?.ok) process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
