import { describe, expect, it } from 'vitest';
import { checkProfileAgainstCv, type CvFacts, type ProfileFacts } from '../modules/verification/consistency';

const profile = (over: Partial<ProfileFacts> = {}): ProfileFacts => ({ fullName: 'Selam Tadesse', phone: '+251911223344', email: 'selam@example.com', yearsExperience: 4, educationLevels: ['DIPLOMA'], employers: [], ...over });
const LONG = 'Selam Tadesse. Phone 0911 22 33 44. Email selam@example.com. Experience: Mechanic at Adama Garage 2019 to 2023. Education: Diploma in Automotive Technology, Adama Polytechnic 2018. Skills: welding, engine repair.';
const cv = (over: Partial<CvFacts> = {}): CvFacts => ({ text: LONG, confidence: null, educationLevels: ['DIPLOMA'], hasEducationSection: true, estimatedYears: 4, experienceEntries: 1, canReadEthiopic: false, ...over });
const codes = (r: ReturnType<typeof checkProfileAgainstCv>, sev: string) => r.findings.filter((f) => f.severity === sev).map((f) => f.code);

describe('CV against profile', () => {
  it('accepts a CV that agrees with the profile and says what matched', () => {
    const r = checkProfileAgainstCv(profile(), cv());
    expect(r.outcome).toBe('ACCEPTED');
    expect(codes(r, 'ok')).toEqual(expect.arrayContaining(['NAME', 'PHONE', 'EMAIL', 'EDUCATION', 'EXPERIENCE']));
    expect(codes(r, 'block')).toEqual([]);
  });

  it("declines a CV that is in someone else's name", () => {
    const r = checkProfileAgainstCv(profile(), cv({ text: LONG.replace(/Selam Tadesse/g, 'Hanna Bekele') }));
    expect(r.outcome).toBe('DECLINED');
    expect(codes(r, 'block')).toEqual(['NAME']);
    expect(r.reason).toMatch(/may belong to someone else/);
  });

  it('tolerates a misread letter in the name and a missing grandfather name', () => {
    expect(checkProfileAgainstCv(profile({ fullName: 'Selam Tadesse Lemma' }), cv({ text: LONG.replace('Tadesse', 'Tadese') })).outcome).toBe('ACCEPTED');
  });

  it('declines education claimed two levels above anything on the CV, but only warns for one level', () => {
    const inflated = checkProfileAgainstCv(profile({ educationLevels: ['MASTER'] }), cv({ educationLevels: ['DIPLOMA'] }));
    expect(inflated.outcome).toBe('DECLINED');
    expect(codes(inflated, 'block')).toEqual(['EDUCATION']);
    const slightly = checkProfileAgainstCv(profile({ educationLevels: ['BACHELOR'] }), cv({ educationLevels: ['DIPLOMA'] }));
    expect(slightly.outcome).toBe('ACCEPTED');
    expect(codes(slightly, 'warn')).toContain('EDUCATION');
  });

  it('does not judge education when the CV has no education section', () => {
    const r = checkProfileAgainstCv(profile({ educationLevels: ['MASTER'] }), cv({ hasEducationSection: false, educationLevels: [] }));
    expect(r.outcome).toBe('ACCEPTED');
    expect(r.findings.find((f) => f.code === 'EDUCATION')?.severity).toBe('info');
  });

  it('declines years of experience far beyond the CV, warns for a smaller gap, and ignores a CV without dated jobs', () => {
    expect(checkProfileAgainstCv(profile({ yearsExperience: 12 }), cv({ estimatedYears: 4 })).outcome).toBe('DECLINED');
    const gap3 = checkProfileAgainstCv(profile({ yearsExperience: 7 }), cv({ estimatedYears: 4 }));
    expect(gap3.outcome).toBe('ACCEPTED');
    expect(codes(gap3, 'warn')).toContain('EXPERIENCE');
    expect(checkProfileAgainstCv(profile({ yearsExperience: 20 }), cv({ estimatedYears: null, experienceEntries: 0 })).outcome).toBe('ACCEPTED');
    expect(checkProfileAgainstCv(profile({ yearsExperience: 2 }), cv({ estimatedYears: 9 })).outcome).toBe('ACCEPTED'); // CV showing more than claimed is fine
  });

  it('only warns when the phone or email on the CV differ', () => {
    const r = checkProfileAgainstCv(profile(), cv({ text: LONG.replace('0911 22 33 44', '0922 55 66 77').replace('selam@example.com', 'other@mail.com') }));
    expect(r.outcome).toBe('ACCEPTED');
    expect(codes(r, 'warn')).toEqual(expect.arrayContaining(['PHONE', 'EMAIL']));
  });

  it('warns when none of the employers on the profile appear on the CV', () => {
    const r = checkProfileAgainstCv(profile({ employers: ['Blue Nile Textiles', 'Habesha Bakery'] }), cv());
    expect(r.outcome).toBe('ACCEPTED');
    expect(codes(r, 'warn')).toContain('EMPLOYERS');
  });

  it('never declines a CV it cannot read', () => {
    expect(checkProfileAgainstCv(profile(), cv({ text: 'x y z' })).outcome).toBe('UNCHECKED');
    const blurry = checkProfileAgainstCv(profile(), cv({ text: LONG.replace(/Selam Tadesse/g, 'Qqq Www'), confidence: 30 }));
    expect(blurry.outcome).toBe('UNCHECKED');
    expect(blurry.reason).toMatch(/blurry/);
    expect(checkProfileAgainstCv(profile({ fullName: 'ሰላም ታደሰ' }), cv({ canReadEthiopic: false })).outcome).toBe('UNCHECKED');
  });
});
