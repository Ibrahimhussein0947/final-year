import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Opaque random token for refresh cookies. Only its hash is stored. */
export const newOpaqueToken = () => randomBytes(48).toString('base64url');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Normalize Ethiopian mobile numbers to +251XXXXXXXXX (9 national digits starting 9 or 7). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  const national = digits.slice(-9);
  return `+251${national}`;
}

export const PHONE_REGEX = /^(\+251|251|0)?[79]\d{8}$/;

/** People type numbers as "0912 234 567", "0912-234-567" or "(0912) 234567": ignore spaces and punctuation, then validate. */
export const stripPhoneFormatting = (input: string) => input.replace(/[\s\-().]/g, '');
