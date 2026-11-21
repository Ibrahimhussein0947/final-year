import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Delivery adapters for SMS and email.
 *
 * Email: optional. With RESEND_API_KEY and EMAIL_FROM set, email goes through Resend; otherwise it is only logged.
 * SMS: optional. Africa's Talking (AT_USERNAME + AT_API_KEY) is used when configured; otherwise the generic gateway below.
 * Generic gateway: If SMS_GATEWAY_URL and SMS_GATEWAY_TOKEN are set, messages are POSTed as JSON to that gateway
 * ({to, text, sender}) with a bearer token. This is a generic shape, not any specific Ethiopian operator's API:
 * Ethio Telecom, Safaricom Ethiopia and aggregators each have their own contract, so a real deployment needs an
 * adapter written against the chosen provider's documentation and credentials. Until then SMS stays off and the
 * app says so. Delivery is best effort and never blocks or fails the action that triggered it.
 */
export interface Notifier {
  smsConfigured(): boolean;
  emailConfigured?(): boolean;
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

/**
 * Africa's Talking bulk SMS (works in Ethiopia through their Ethiopian routes; check your account's sender ID rules).
 * Docs: POST {base}/version1/messaging, header `apiKey`, form fields username/to/message/from. The HTTP status can be 201
 * even when a recipient is rejected, so the per-recipient statusCode is checked too (100-102 mean accepted).
 */
export function createAfricasTalkingSms(
  username: string,
  apiKey: string,
  sender: string | undefined,
  sandbox = false,
  fetchImpl: typeof fetch = fetch,
  baseUrl?: string,
) {
  const url = `${baseUrl ?? (sandbox ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com')}/version1/messaging`;
  return async (to: string, text: string): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const form = new URLSearchParams({ username, to, message: text });
      if (sender) form.set('from', sender);
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Africa's Talking answered ${res.status}`);
      const data = (await res.json().catch(() => null)) as { SMSMessageData?: { Recipients?: { statusCode?: number; status?: string }[] } } | null;
      const bad = data?.SMSMessageData?.Recipients?.find((r) => r.statusCode !== undefined && (r.statusCode < 100 || r.statusCode > 102));
      if (bad) throw new Error(`Africa's Talking rejected the message: ${bad.status ?? bad.statusCode}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Resend transactional email (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendEmail(apiKey: string, from: string, fetchImpl: typeof fetch = fetch, baseUrl = 'https://api.resend.com') {
  return async (to: string, subject: string, text: string): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetchImpl(`${baseUrl}/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Email provider answered ${res.status}`);
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

export function createNotifier(
  sms?: (to: string, text: string) => Promise<void>,
  email?: (to: string, subject: string, text: string) => Promise<void>,
): Notifier {
  return {
    smsConfigured: () => !!sms,
    emailConfigured: () => !!email,
    async sendSms(to, text) {
      if (!sms) return consoleNotifier.sendSms(to, text);
      try {
        await sms(to, text);
      } catch (err) {
        logger.warn({ err: String(err) }, 'SMS delivery failed');
      }
    },
    async sendEmail(to, subject, text) {
      if (!email) return consoleNotifier.sendEmail(to, subject, text);
      try {
        await email(to, subject, text);
      } catch (err) {
        logger.warn({ err: String(err) }, 'Email delivery failed');
      }
    },
  };
}

/** Picks the SMS and email providers from the environment. Anything not configured falls back to logging only. */
function notifierFromEnv(): Notifier {
  const sms =
    env.AT_USERNAME && env.AT_API_KEY
      ? createAfricasTalkingSms(env.AT_USERNAME, env.AT_API_KEY, env.SMS_SENDER_ID, env.AT_SANDBOX)
      : env.SMS_GATEWAY_URL && env.SMS_GATEWAY_TOKEN
        ? createGatewaySms(env.SMS_GATEWAY_URL, env.SMS_GATEWAY_TOKEN, env.SMS_SENDER_ID)
        : undefined;
  const email = env.RESEND_API_KEY && env.EMAIL_FROM ? createResendEmail(env.RESEND_API_KEY, env.EMAIL_FROM) : undefined;
  return sms || email ? createNotifier(sms, email) : consoleNotifier;
}

export let notifier: Notifier = notifierFromEnv();
export function setNotifier(n: Notifier) {
  notifier = n;
}
