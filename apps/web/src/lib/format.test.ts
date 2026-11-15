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
