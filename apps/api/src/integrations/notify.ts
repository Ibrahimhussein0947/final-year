import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Delivery adapters for SMS and email.
 *
 * Email: no provider is configured, so email is only logged.
 * SMS: optional. If SMS_GATEWAY_URL and SMS_GATEWAY_TOKEN are set, messages are POSTed as JSON to that gateway
 * ({to, text, sender}) with a bearer token. This is a generic shape, not any specific Ethiopian operator's API:
 * Ethio Telecom, Safaricom Ethiopia and aggregators each have their own contract, so a real deployment needs an
 * adapter written against the chosen provider's documentation and credentials. Until then SMS stays off and the
 * app says so. Delivery is best effort and never blocks or fails the action that triggered it.
 */
export interface Notifier {
  smsConfigured(): boolean;
  sendSms(toE164: string, text: string): Promise<void>;
  sendEmail(to: string, subject: string, text: string): Promise<void>;
}

export function createGatewaySms(url: string, token: string, sender: string | undefined, fetchImpl: typeof fetch = fetch) {
  return async (to: string, text: string): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, text, ...(sender ? { sender } : {}) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`SMS gateway answered ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

export const consoleNotifier: Notifier = {
  smsConfigured: () => false,
  async sendSms(to, text) {
    logger.info({ to, text }, '[dev] SMS not sent (no gateway configured)');
  },
  async sendEmail(to, subject, text) {
    logger.info({ to, subject, text }, '[dev] email not sent (no provider configured)');
  },
};

export function createNotifier(sms?: (to: string, text: string) => Promise<void>): Notifier {
  return {
    smsConfigured: () => !!sms,
    async sendSms(to, text) {
      if (!sms) return consoleNotifier.sendSms(to, text);
      try {
        await sms(to, text);
      } catch (err) {
        logger.warn({ err: String(err) }, 'SMS delivery failed');
      }
    },
    sendEmail: consoleNotifier.sendEmail,
  };
}

export let notifier: Notifier =
  env.SMS_GATEWAY_URL && env.SMS_GATEWAY_TOKEN ? createNotifier(createGatewaySms(env.SMS_GATEWAY_URL, env.SMS_GATEWAY_TOKEN, env.SMS_SENDER_ID)) : consoleNotifier;
export function setNotifier(n: Notifier) {
  notifier = n;
}
