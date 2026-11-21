import { describe, expect, it } from 'vitest';
import { buildFields, type CompareContext } from '../modules/documents/compare';
import { compactNumber, numberResult, tokensOf } from '../modules/documents/match';
import { DOC_LABEL, EMPLOYER_DOC_TYPES, WORKER_DOC_TYPES, employerRequirements, requestFor, workerRequirements } from '../modules/documents/requirements';
import { ORG_TYPE_INFO } from '../modules/hiring/catalog';

const ctx = (over: Partial<CompareContext> = {}): CompareContext => ({ fullName: 'Selam Tadesse', today: new Date('2026-11-19T00:00:00Z'), ...over });
const by = (fields: ReturnType<typeof buildFields>) => Object.fromEntries(fields.map((f) => [f.field, f.status]));

describe('numbers', () => {
  it('ignores spaces, dashes and slashes, and reads O, I and L as digits in mostly-numeric values', () => {
    expect(compactNumber('0012 345-678')).toBe('0012345678');
    expect(compactNumber('OO12 3I5-678')).toBe('0012315678'.replace('5', '5')); // O->0 and I->1
    expect(numberResult('TIN', '0012345678', 'Taxpayer TIN: 0012 345 678 name', true).status).toBe('FOUND');
    expect(numberResult('TIN', '0012345678', 'TIN OO12-345-678', true).status).toBe('FOUND');
    expect(numberResult('Licence', 'AA/1234/15', 'Licence No. aa 1234 15 issued', true).status).toBe('FOUND');
  });
  it('says close for one character off in a long number, and not found for anything else', () => {
    expect(numberResult('TIN', '0012345678', 'TIN 0012345679', true)).toMatchObject({ status: 'CLOSE' });
    expect(numberResult('TIN', '0012345678', 'TIN 0099999999', true).status).toBe('NOT_FOUND');
    expect(numberResult('Licence', 'AB123', 'AB124', true).status).toBe('NOT_FOUND'); // short numbers must match exactly
    expect(numberResult('Licence', '12', 'anything 12', true).status).toBe('NOT_FOUND'); // too short to mean anything
  });
});

describe('what is compared on each document', () => {
  it('an ID document: name, date of birth (either calendar) and the ID number', () => {
    const w = { fatherName: null, grandfatherName: null, dateOfBirth: new Date('1995-03-12T00:00:00Z'), idNumber: 'KB 4412/87', employers: [] };
    const f = buildFields('NATIONAL_ID', ctx({ worker: w }), 'KEBELE ID Selam Tadesse DOB 3/7/1987 No KB4412/87');
    expect(by(f)).toEqual({ 'Your name': 'FOUND', 'Date of birth': 'FOUND', 'ID number': 'FOUND' });
    expect(by(buildFields('NATIONAL_ID', ctx({ worker: { ...w, idNumber: 'ZZ9999999' } }), 'Selam Tadesse 12/03/1995'))['ID number']).toBe('NOT_FOUND');
  });

  it('a business licence: name, number and whether it has expired', () => {
    const org = { name: 'Adama Auto Garage PLC', tin: null, licenseNumber: 'AA/2231/15', licenseExpiresAt: new Date('2027-06-30T00:00:00Z'), registrationNumber: null };
    const text = 'Trade licence No AA/2231/15 Adama Auto Garage PLC owner Selam Tadesse valid until 30/06/2027';
    expect(by(buildFields('BUSINESS_LICENSE', ctx({ org }), text))).toEqual({ 'Organization name': 'FOUND', 'Licence number': 'FOUND', 'Not expired': 'FOUND', 'Owner or manager': 'FOUND' });
    const expired = buildFields('BUSINESS_LICENSE', ctx({ org: { ...org, licenseExpiresAt: new Date('2025-06-30T00:00:00Z') } }), text);
    expect(expired.find((x) => x.field === 'Not expired')).toMatchObject({ status: 'NOT_FOUND', required: true, note: 'expired on 2025-06-30' });
  });

  it('a TIN certificate: the organization name and the 10-digit number', () => {
    const org = { name: 'Adama Auto Garage PLC', tin: '0012345678', licenseNumber: null, licenseExpiresAt: null, registrationNumber: null };
    expect(by(buildFields('TIN_CERTIFICATE', ctx({ org }), 'Tax identification number 0012345678 taxpayer Adama Auto Garage PLC'))).toEqual({ 'Organization name': 'FOUND', TIN: 'FOUND' });
    expect(by(buildFields('TIN_CERTIFICATE', ctx({ org }), 'taxpayer Adama Auto Garage PLC number 0099999999'))['TIN']).toBe('NOT_FOUND');
  });

  it('an authorisation letter needs both the organization and the person; a representative ID only the person', () => {
    const org = { name: 'Hope Water NGO', tin: null, licenseNumber: null, licenseExpiresAt: null, registrationNumber: null };
    expect(by(buildFields('AUTHORIZATION_LETTER', ctx({ org }), 'Hope Water NGO authorises Selam Tadesse to recruit'))).toEqual({ 'Organization name': 'FOUND', 'Your name': 'FOUND' });
    expect(by(buildFields('AUTHORIZATION_LETTER', ctx({ org }), 'Hope Water NGO authorises somebody else'))['Your name']).toBe('NOT_FOUND');
    expect(buildFields('REPRESENTATIVE_ID', ctx({ org }), 'Selam Tadesse').map((x) => x.field)).toEqual(['Your name']);
  });

  it('an experience letter looks for one of the employers on the profile, without requiring it', () => {
    const w = { fatherName: null, grandfatherName: null, dateOfBirth: null, idNumber: null, employers: ['Adama Transport Share Company'] };
    const f = buildFields('EXPERIENCE_LETTER', ctx({ worker: w }), 'This certifies that Selam Tadesse worked at Adama Transport as a driver');
    expect(f.find((x) => x.field === 'Employer')).toMatchObject({ status: 'FOUND', required: false });
    expect(tokensOf('Adama Transport Share Company').length).toBeGreaterThan(1);
  });
});

describe('requirements', () => {
  it('a job seeker must send an ID document and a photo; the rest is recommended', () => {
    const req = workerRequirements();
    expect(req.filter((r) => r.required).map((r) => r.key).sort()).toEqual(['NATIONAL_ID', 'PHOTO']);
    expect(req.map((r) => r.key)).toEqual(expect.arrayContaining(['BIRTH_CERTIFICATE', 'EDUCATION_CERTIFICATE', 'CV', 'EXPERIENCE_LETTER']));
  });

  it('every organization type has something required, and the ID of the person is always among it', () => {
    for (const t of ORG_TYPE_INFO) {
      const req = employerRequirements(t.value);
      expect(req.some((r) => r.required), t.value).toBe(true);
      expect(req.find((r) => r.key === 'REPRESENTATIVE_ID')?.required, t.value).toBe(true);
      for (const r of req) expect(EMPLOYER_DOC_TYPES, `${t.value} ${r.key}`).toContain(r.key);
    }
  });

  it('asks for what each kind of organization really has', () => {
    const need = (t: Parameters<typeof employerRequirements>[0]) => employerRequirements(t).filter((r) => r.required).map((r) => r.key).sort();
    expect(need('PRIVATE_COMPANY')).toEqual(['BUSINESS_LICENSE', 'REPRESENTATIVE_ID', 'TIN_CERTIFICATE']);
    expect(need('HOUSEHOLD')).toEqual(['REPRESENTATIVE_ID']); // a family hiring a nanny has no business licence
    expect(need('INDIVIDUAL')).toEqual(['REPRESENTATIVE_ID']);
    expect(need('GOVERNMENT')).toEqual(['GOVERNMENT_LETTER', 'REPRESENTATIVE_ID']);
    expect(need('NGO')).toEqual(['AUTHORIZATION_LETTER', 'ORG_REGISTRATION', 'REPRESENTATIVE_ID']);
    expect(need('RECRUITMENT_AGENCY')).toEqual(['AGENCY_LICENSE', 'BUSINESS_LICENSE', 'REPRESENTATIVE_ID']);
  });

  it('has a label and a request kind for every document type, and keeps the two audiences apart', () => {
    for (const t of [...WORKER_DOC_TYPES, ...EMPLOYER_DOC_TYPES]) expect(DOC_LABEL[t]).toBeTruthy();
    for (const t of WORKER_DOC_TYPES) expect(requestFor(t).audience).toBe('WORKER');
    for (const t of EMPLOYER_DOC_TYPES) expect(requestFor(t)).toMatchObject({ audience: 'EMPLOYER', kind: 'EMPLOYER', targetType: t });
    expect(requestFor('BIRTH_CERTIFICATE')).toMatchObject({ kind: 'IDENTITY', targetType: 'IDENTITY' }); // older uploads keep working
    expect(requestFor('NATIONAL_ID').targetType).not.toBe(requestFor('BIRTH_CERTIFICATE').targetType); // so one does not replace the other
  });
});
