import { describe, expect, it } from 'vitest';
import type { ApplicationStatus } from '@prisma/client';
import { CONTACT_VISIBLE, EMPLOYER_TRANSITIONS, INTERVIEWABLE, WORKER_CAN_WITHDRAW, canEmployerMove } from '../modules/applications/transitions';

const ALL: ApplicationStatus[] = ['PENDING', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'];

describe('application status machine', () => {
  it('has a rule for every status', () => {
    expect(Object.keys(EMPLOYER_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('treats accepted, rejected and withdrawn as final', () => {
    for (const s of ['ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const) expect(EMPLOYER_TRANSITIONS[s]).toEqual([]);
  });

  it('never lets an employer set INTERVIEW_SCHEDULED or WITHDRAWN or PENDING directly', () => {
    for (const from of ALL) {
      for (const to of ['INTERVIEW_SCHEDULED', 'WITHDRAWN', 'PENDING'] as const) expect(canEmployerMove(from, to), `${from}->${to}`).toBe(false);
    }
  });

  it('allows the normal happy path', () => {
    expect(canEmployerMove('PENDING', 'UNDER_REVIEW')).toBe(true);
    expect(canEmployerMove('UNDER_REVIEW', 'SHORTLISTED')).toBe(true);
    expect(canEmployerMove('SHORTLISTED', 'ACCEPTED')).toBe(true);
  });

  it('does not allow skipping straight from pending to accepted', () => {
    expect(canEmployerMove('PENDING', 'ACCEPTED')).toBe(false);
    expect(canEmployerMove('UNDER_REVIEW', 'ACCEPTED')).toBe(false);
  });

  it('only lets workers withdraw non-final applications', () => {
    expect(WORKER_CAN_WITHDRAW).not.toContain('ACCEPTED');
    expect(WORKER_CAN_WITHDRAW).not.toContain('REJECTED');
    expect(WORKER_CAN_WITHDRAW).not.toContain('WITHDRAWN');
    expect(WORKER_CAN_WITHDRAW).toContain('PENDING');
  });

  it('keeps phone numbers hidden until shortlisting and never schedules interviews from pending', () => {
    expect(CONTACT_VISIBLE).not.toContain('PENDING');
    expect(CONTACT_VISIBLE).not.toContain('UNDER_REVIEW');
    expect(CONTACT_VISIBLE).not.toContain('REJECTED');
    expect(INTERVIEWABLE).not.toContain('PENDING');
  });
});
