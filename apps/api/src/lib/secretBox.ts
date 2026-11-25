import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * Encrypts small secrets (the authenticator key) before they go in the database, with AES-256-GCM.
 * The key is TOTP_ENCRYPTION_KEY when set, otherwise derived from JWT_ACCESS_SECRET, so no new setting is required.
 * Values that do not start with "enc:v1:" are older plaintext secrets and are still read as they are.
 */
const PREFIX = 'enc:v1:';
const key = () => createHmac('sha256', process.env.TOTP_ENCRYPTION_KEY || env.JWT_ACCESS_SECRET).update('totp-secret-box').digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

export function open(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
