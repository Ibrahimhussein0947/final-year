import { describe, expect, it } from 'vitest';
import {
  dateOfBirthFound, decide, ethiopianToGregorian, extractDates, fatherResult, findToken, institutionResult, levelFound, nameResult, normalize, tokensOf, yearFound,
} from '../modules/documents/match';

describe('Ethiopian calendar', () => {
  it('converts known new-year dates', () => {
    expect(ethiopianToGregorian(2000, 1, 1)).toEqual({ y: 2007, m: 9, d: 12 }); // the Millennium
    expect(ethiopianToGregorian(2016, 1, 1)).toEqual({ y: 2023, m: 9, d: 12 });
    expect(ethiopianToGregorian(2013, 1, 1)).toEqual({ y: 2020, m: 9, d: 11 });
    expect(ethiopianToGregorian(2012, 1, 1)).toEqual({ y: 2019, m: 9, d: 12 });
  });
  it('converts a date in the middle of a year and the last days of Pagume', () => {
    expect(ethiopianToGregorian(2017, 6, 1)).toEqual({ y: 2025, m: 2, d: 8 }); // Yekatit 1
    expect(ethiopianToGregorian(2015, 13, 6)).toEqual({ y: 2023, m: 9, d: 11 }); // leap year: Pagume has 6 days
    expect(ethiopianToGregorian(2016, 13, 6)).toBeNull(); // 2016 is not a leap year
    expect(ethiopianToGregorian(2016, 14, 1)).toBeNull();
    expect(ethiopianToGregorian(2016, 2, 31)).toBeNull();
  });
});

describe('names', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalize('  Ábebe-KEBEDE, ')).toBe('abebe kebede');
    expect(tokensOf('A. Abebe  Kebede')).toEqual(['abebe', 'kebede']);
  });
  it('finds a name even when the reading made one small mistake, but not a different name', () => {
    expect(findToken('kebede', ['kebede'])).toBe('exact');
    expect(findToken('kebede', ['kebcde'])).toBe('close');
    expect(findToken('tadesse', ['tadese'])).toBe('close');
    expect(findToken('abebe', ['abera'])).toBeNull();
    expect(findToken('ali', ['alo'])).toBeNull(); // short names must match exactly
  });
  it('needs every word of the name', () => {
    const doc = tokensOf('Name of child: ABEBE KEBEDE TADESSE. Father: KEBEDE TADESSE');
    expect(nameResult('Full name', 'Abebe Kebede', doc, true).status).toBe('FOUND');
    expect(nameResult('Full name', 'Abebe Hailu', doc, true)).toMatchObject({ status: 'NOT_FOUND', note: 'not found: hailu' });
    expect(nameResult('Full name', '', doc, true).status).toBe('NOT_FOUND');
  });
});

describe("father's name", () => {
  it("is not satisfied by the child's own name when the two share a word", () => {
    // own name "Abebe Kebede" already contains the father's name "Kebede"
    const onlyChild = tokensOf('Name of child: ABEBE KEBEDE. Date of birth 12/03/1995');
    expect(fatherResult("Father's name", 'Kebede', 'Abebe Kebede', onlyChild, true)).toMatchObject({ status: 'NOT_FOUND', note: expect.stringContaining('separate father line') });
    const withFather = tokensOf('Name of child: ABEBE KEBEDE. Father: KEBEDE TADESSE');
    expect(fatherResult("Father's name", 'Kebede', 'Abebe Kebede', withFather, true).status).toBe('FOUND');
  });
  it('needs one occurrence when the father has a different name from the child', () => {
    expect(fatherResult("Father's name", 'Tadesse', 'Abebe Kebede', tokensOf('Child ABEBE KEBEDE Father TADESSE LEMMA'), true).status).toBe('FOUND');
    expect(fatherResult("Father's name", 'Tadesse', 'Abebe Kebede', tokensOf('Child ABEBE KEBEDE Father HAILU LEMMA'), true).status).toBe('NOT_FOUND');
  });
});

describe('dates', () => {
  const dob = { y: 1995, m: 3, d: 12 };
  it('finds a Gregorian date in common layouts', () => {
    for (const text of ['Date of birth 12/03/1995', 'born 1995-03-12', '12.03.1995', 'on 12 March 1995', 'March 12, 1995', '3/12/1995']) {
      expect(dateOfBirthFound(dob, extractDates(text)), text).toMatchObject({ found: true, via: 'gregorian' });
    }
  });
  it('finds a date written in the Ethiopian calendar', () => {
    // Megabit 3, 1987 EC is 12 March 1995
    expect(ethiopianToGregorian(1987, 7, 3)).toEqual({ y: 1995, m: 3, d: 12 });
    expect(dateOfBirthFound(dob, extractDates('የትውልድ ቀን 03/07/1987'))).toMatchObject({ found: true, via: 'ethiopian' });
    expect(dateOfBirthFound(dob, extractDates('Date of birth: 3 Megabit 1987'))).toMatchObject({ found: true, via: 'ethiopian' });
  });
  it('does not match a different date, and says how many dates it saw', () => {
    const r = dateOfBirthFound(dob, extractDates('Issued 05/06/2010. Born 24/09/1990.'));
    expect(r).toEqual({ found: false, close: false, via: null, datesSeen: 2 });
    expect(dateOfBirthFound(dob, extractDates('no dates here'))).toEqual({ found: false, close: false, via: null, datesSeen: 0 });
  });
  it('marks a date that is one digit off as close, since that is what a misread scan looks like', () => {
    expect(dateOfBirthFound(dob, extractDates('Date of birth: 12/03/1993'))).toMatchObject({ found: false, close: true });
    expect(dateOfBirthFound(dob, extractDates('Date of birth: 12/03/1985'))).toMatchObject({ found: false, close: true });
    expect(dateOfBirthFound(dob, extractDates('Date of birth: 14/05/1990'))).toMatchObject({ found: false, close: false }); // several digits differ
  });
  it('finds a graduation year in either calendar', () => {
    expect(yearFound(2021, 'Graduated in July 2021')).toBe(true);
    expect(yearFound(2021, 'Graduated Sene 2013')).toBe(true);
    expect(yearFound(2021, 'Graduated 2019')).toBe(false);
  });
});

describe('education details', () => {
  it('finds the level words and the distinctive part of a school name', () => {
    expect(levelFound('DIPLOMA', 'Advanced Diploma in Accounting')).toBe(true);
    expect(levelFound('BACHELOR', 'Bachelor of Science')).toBe(true);
    expect(levelFound('MASTER', 'Bachelor of Science')).toBe(false);
    const doc = tokensOf('Hawassa University College of Business');
    expect(institutionResult('Hawassa University', doc).status).toBe('FOUND');
    expect(institutionResult('Jimma University', doc).status).toBe('NOT_FOUND'); // "university" alone is not enough
  });
});

describe('deciding', () => {
  const f = (status: 'FOUND' | 'NOT_FOUND', required: boolean) => ({ field: 'x', expected: 'x', status, required });
  it('says unreadable when there is too little text or the picture is poor', () => {
    expect(decide({ chars: 10, confidence: null, fields: [f('NOT_FOUND', true)] }).outcome).toBe('UNREADABLE');
    expect(decide({ chars: 500, confidence: 30, fields: [f('NOT_FOUND', true)] }).outcome).toBe('UNREADABLE');
  });
  it('is consistent when everything is found, partial when only a supporting detail is missing', () => {
    expect(decide({ chars: 500, confidence: 90, fields: [f('FOUND', true), f('FOUND', false)] }).outcome).toBe('CONSISTENT');
    expect(decide({ chars: 500, confidence: null, fields: [f('FOUND', true), f('NOT_FOUND', false)] }).outcome).toBe('PARTIAL');
  });
  it('sends a one-digit difference to a person instead of calling it a mismatch', () => {
    const r = decide({ chars: 500, confidence: 93, fields: [f('FOUND', true), { field: 'x', expected: 'x', status: 'CLOSE', required: true }] });
    expect(r.outcome).toBe('PARTIAL');
    expect(r.reason).toMatch(/single digit/);
  });
  it('only calls a mismatch when the reading was good enough to trust', () => {
    expect(decide({ chars: 500, confidence: 90, fields: [f('NOT_FOUND', true)] }).outcome).toBe('MISMATCH');
    expect(decide({ chars: 500, confidence: 50, fields: [f('NOT_FOUND', true)] })).toMatchObject({ outcome: 'UNREADABLE' });
  });
});
