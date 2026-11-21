import { describe, expect, it } from 'vitest';
import { FAIRNESS_K_MIN, FIRST_PAGE, fairnessReport, type FairnessPerson } from '../modules/analytics/fairness';

const day = (n: number) => new Date(Date.UTC(2027, 0, 1) + n * 86_400_000);
const person = (over: Partial<FairnessPerson> = {}): FairnessPerson => ({ completionPct: 80, updatedAt: day(0), yearsExperience: 4, education: 'SECONDARY', region: 'Oromia', ...over });
const many = (n: number, over: Partial<FairnessPerson> = {}) => Array.from({ length: n }, (_, i) => person({ ...over, updatedAt: day(i) }));

describe('search fairness report', () => {
  it('does not report numbers for a pool that is too small to mean anything', () => {
    const r = fairnessReport(many(10));
    expect(r.attributes).toEqual([]);
    expect(r.overallShownRate).toBeNull();
    expect(r.notes[0]).toMatch(/Not enough visible workers/);
  });

  it('flags a group that is rarely in the first page and leaves an even pool unflagged', () => {
    const even = fairnessReport([...many(30, { education: 'SECONDARY' }), ...many(30, { education: 'BACHELOR' })]);
    const edu = even.attributes.find((a) => a.attribute === 'Education')!;
    // identical completeness: order falls to recency, which is the same spread in both groups, so nobody is flagged
    expect(edu.groups).toHaveLength(2);
    expect(edu.groups.every((g) => !g.flagged && g.ratioToBest === 1)).toBe(true);

    // degree holders have complete profiles, vocational-certificate holders do not: they are rarely shown first
    const skewed = fairnessReport([...many(40, { education: 'BACHELOR', completionPct: 95 }), ...many(40, { education: 'VOCATIONAL_CERTIFICATE', completionPct: 40 })]);
    const row = skewed.attributes.find((a) => a.attribute === 'Education')!.groups.find((g) => g.group === 'Vocational certificate')!;
    expect(row).toMatchObject({ people: 40, inFirstPage: 0, shownRate: 0, flagged: true });
    const best = skewed.attributes.find((a) => a.attribute === 'Education')!.groups.find((g) => g.group === 'Diploma or higher')!;
    expect(best.inFirstPage).toBe(FIRST_PAGE);
    expect(best.flagged).toBe(false);
    expect(skewed.overallShownRate).toBeCloseTo(FIRST_PAGE / 80, 2);
  });

  it('hides groups under the minimum size and counts them', () => {
    const r = fairnessReport([...many(40, { region: 'Oromia' }), ...many(FAIRNESS_K_MIN - 1, { region: 'Harari' })]);
    const region = r.attributes.find((a) => a.attribute === 'Region')!;
    expect(region.groups.map((g) => g.group)).toEqual(['Oromia']);
    expect(region.hiddenSmallGroups).toBe(1);
  });

  it('is clear about what it does not cover', () => {
    const text = fairnessReport(many(40)).notes.join(' ');
    expect(text).toMatch(/not collected/);
    expect(text).toMatch(/not proof/);
  });
});
