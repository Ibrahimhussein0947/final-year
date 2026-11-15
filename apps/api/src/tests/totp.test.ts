import { describe, expect, it } from 'vitest';
import { codeForStep, generateSecret, verifyCode } from '../lib/totp';

// RFC 6238 test secret "12345678901234567890" in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 vectors (last 6 digits)', () => {
    expect(codeForStep(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(codeForStep(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(codeForStep(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('accepts one step of clock drift but not more, and returns the matched step', () => {
    const t = 1_700_000_000_000;
    const step = Math.floor(t / 1000 / 30);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step), t)).toBe(step);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step - 1), t)).toBe(step - 1);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step - 3), t)).toBeNull();
    expect(verifyCode(RFC_SECRET, 'abcdef', t)).toBeNull();
  });

  it('generates valid base32 secrets', () => {
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});
