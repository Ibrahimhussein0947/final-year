import type { ApplicationStatus } from '@prisma/client';

/**
 * Who may move an application from one status to another.
 * INTERVIEW_SCHEDULED is never set directly: it happens by scheduling an interview.
 * ACCEPTED, REJECTED and WITHDRAWN are final.
 */
export const EMPLOYER_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  PENDING: ['UNDER_REVIEW', 'SHORTLISTED', 'REJECTED'],
  UNDER_REVIEW: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['UNDER_REVIEW', 'ACCEPTED', 'REJECTED'],
  INTERVIEW_SCHEDULED: ['SHORTLISTED', 'ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

export const WORKER_CAN_WITHDRAW: ApplicationStatus[] = ['PENDING', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED'];

/** Statuses from which an interview may be scheduled. */
export const INTERVIEWABLE: ApplicationStatus[] = ['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED'];

/** Statuses where the employer may see the candidate's phone number. */
export const CONTACT_VISIBLE: ApplicationStatus[] = ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'ACCEPTED'];

export const canEmployerMove = (from: ApplicationStatus, to: ApplicationStatus) => EMPLOYER_TRANSITIONS[from].includes(to);
