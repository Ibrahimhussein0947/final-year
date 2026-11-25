import { prisma } from './prisma';
import { logger } from './logger';

/** Hide most of a phone number or e-mail address: the log shows that something was sent, not to whom in full. */
export function maskRecipient(to: string): string {
  if (to.includes('@')) {
    const [name, domain] = to.split('@');
    return `${name.slice(0, 1)}***@${domain}`;
  }
  return to.length > 6 ? `${to.slice(0, 4)}****${to.slice(-3)}` : '****';
}

/** Best effort: a failure to write the log never affects the message or the action that sent it. The text is not stored. */
export async function recordDelivery(channel: 'SMS' | 'EMAIL', to: string, status: 'SENT' | 'FAILED' | 'NOT_SENT', opts: { subject?: string; error?: string } = {}) {
  try {
    await prisma.deliveryLog.create({ data: { channel, recipient: maskRecipient(to), status, subject: opts.subject?.slice(0, 120), error: opts.error?.slice(0, 300) } });
  } catch (err) {
    logger.warn({ err: String(err) }, 'Could not write the delivery log');
  }
}
