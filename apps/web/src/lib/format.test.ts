import { afterEach, describe, expect, it, vi } from 'vitest';
import { deadlineText, formatPlace, formatSalary } from './format';

afterEach(() => vi.useRealTimers());

describe('formatSalary', () => {
  it('formats ranges, single values and open ends; hides when nothing is given', () => {
    expect(formatSalary(5000, 8000)).toBe('5,000 – 8,000 ETB');
    expect(formatSalary(5000, 5000)).toBe('5,000 ETB');
    expect(formatSalary(5000, null)).toBe('From 5,000 ETB');
    expect(formatSalary(null, 9000)).toBe('Up to 9,000 ETB');
    expect(formatSalary(null, null)).toBeNull();
    // with a basis the amount says what it is per, so a daily wage is never read as a monthly salary
    expect(formatSalary(500, 700, 'ETB', 'DAILY')).toBe('500 – 700 ETB per day');
    expect(formatSalary(60, 60, 'ETB', 'HOURLY')).toBe('60 ETB per hour');
    expect(formatSalary(8000, 8000, 'ETB', 'MONTHLY')).toBe('8,000 ETB per month');
    expect(formatSalary(null, null, 'ETB', 'NEGOTIABLE')).toBe('Negotiable');
    expect(formatSalary(3000, 3000, 'ETB', 'UNPAID')).toBe('Unpaid (volunteering)');
  });
});

describe('formatPlace', () => {
  it('shows most specific place then region', () => {
    expect(formatPlace([{ name: 'Oromia' }, { name: 'Adama' }])).toBe('Adama, Oromia');
    expect(formatPlace([{ name: 'Tigray' }])).toBe('Tigray');
    expect(formatPlace([], true)).toBe('Remote');
    expect(formatPlace([])).toBe('Location not specified');
  });
});

describe('deadlineText', () => {
  it('describes open, closed, today and soon', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T08:00:00Z'));
    expect(deadlineText(null)).toEqual({ text: 'Open until filled', urgent: false });
    expect(deadlineText('2026-06-01T00:00:00Z')).toEqual({ text: 'Closed', urgent: true });
    expect(deadlineText('2026-06-13T08:00:00Z')).toEqual({ text: '3 days left', urgent: true });
    expect(deadlineText('2026-06-11T00:00:00Z').urgent).toBe(true);
    expect(deadlineText('2026-09-01T00:00:00Z').urgent).toBe(false);
  });
});
