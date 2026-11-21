import { describe, expect, it } from 'vitest';
import { HOLD_THRESHOLD, scanJobText } from '../modules/jobs/scamCheck';

const scan = (description: string, title = 'Driver needed') => scanJobText({ title, description });
const codes = (description: string, title?: string) => scan(description, title).signals.map((s) => s.code);

describe('scam check: what it catches', () => {
  it('holds a job that asks for an upfront fee', () => {
    const r = scan('Great job in Dubai. Send a registration fee of 5000 birr to secure your place.');
    expect(r.flagged).toBe(true);
    expect(r.signals.map((s) => s.code)).toEqual(expect.arrayContaining(['UPFRONT_FEE', 'ABROAD_OFFER']));
    expect(r.score).toBeGreaterThanOrEqual(HOLD_THRESHOLD);
  });

  it('catches fee wording in Amharic', () => {
    expect(scan('ለመመዝገብ የመመዝገቢያ ክፍያ ይክፈሉ').flagged).toBe(true);
  });

  it('catches requests for passports, bank details or one-time codes', () => {
    expect(scan('To apply please send your passport and bank details to us.').flagged).toBe(true);
    expect(codes('Share your OTP to confirm')).toContain('SENSITIVE_DATA');
    expect(codes('Please send us your password for the portal')).toContain('SENSITIVE_DATA');
  });

  it('adds up weaker signals: abroad + WhatsApp crosses the threshold', () => {
    const r = scan('Work abroad in Saudi. Contact us on WhatsApp.');
    expect(r.signals.map((s) => s.code).sort()).toEqual(['ABROAD_OFFER', 'MESSAGING_APP']);
    expect(r.flagged).toBe(true);
  });

  it('notices phone numbers, free email, short links and pressure', () => {
    expect(codes('Call 0911223344 now')).toContain('CONTACT_IN_TEXT');
    expect(codes('Call +251 911 22 33 44')).toContain('CONTACT_IN_TEXT');
    expect(codes('Email hr.company@gmail.com')).toContain('MESSAGING_APP');
    expect(codes('Apply at https://bit.ly/abc123')).toContain('SHORT_LINK');
    expect(codes('Limited slots, hurry!')).toContain('PRESSURE');
    expect(codes('GUARANTEED INCOME for everyone, easy money')).toContain('GUARANTEED_INCOME');
  });

  it('reports readable evidence and caps the score at 100', () => {
    const r = scan('Registration fee required. Send your passport. Work abroad Dubai. WhatsApp us. Guaranteed income. Limited slots. 0911223344 bit.ly/x');
    expect(r.score).toBe(100);
    expect(r.signals.every((s) => s.label.length > 10)).toBe(true);
    expect(r.signals.find((s) => s.code === 'UPFRONT_FEE')?.evidence.toLowerCase()).toContain('fee');
  });
});

describe('scam check: what it leaves alone', () => {
  it('does not flag an ordinary job', () => {
    const r = scan('We need an experienced mechanic to repair vehicles in Adama. Apply with your experience and references. Salary 8000 ETB per month, transport allowance included.');
    expect(r).toMatchObject({ score: 0, flagged: false, signals: [] });
  });

  it('does not flag honest statements that there is no fee', () => {
    expect(scan('There is no registration fee. We never ask for money from applicants.').flagged).toBe(false);
    expect(codes('No application fee. Free of charge to apply.')).not.toContain('UPFRONT_FEE');
    expect(codes('ክፍያ የለውም')).not.toContain('UPFRONT_FEE');
  });

  it('does not flag a normal phone-free, contact-free long posting with words like "fee" used for pay', () => {
    expect(scan('Cashier at a pharmacy. Salary and commission. Fee-for-service clinic experience is a plus.').flagged).toBe(false);
  });

  it('a single weak signal alone does not hold a job', () => {
    for (const d of ['Contact us on Telegram.', 'Limited slots, hurry!', 'Call 0911223344', 'Work in Dubai office, local salary']) {
      expect(scan(d).flagged, d).toBe(false);
    }
  });

  it('reads benefits and schedule text too', () => {
    const r = scanJobText({ title: 'Cleaner', description: 'Clean offices.', benefits: 'Pay a processing fee first', schedule: null });
    expect(r.flagged).toBe(true);
  });
});
