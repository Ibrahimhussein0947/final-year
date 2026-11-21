import { describe, expect, it } from 'vitest';
import { notificationLink, notificationText, type AppNotification } from '@/lib/applications';

const n = (type: string, payload: Record<string, unknown>): AppNotification => ({ id: '1', type, payload, readAt: null, createdAt: '2026-01-01T00:00:00Z' });

describe('notification wording', () => {
  it('tells a worker which employer and score matched', () => {
    const t = notificationText(n('job.recommended', { jobTitle: 'Software Developer', organizationName: 'ABC Company', score: 95 }));
    expect(t).toContain('ABC Company');
    expect(t).toContain('"Software Developer"');
    expect(t).toContain('95%');
  });
  it('says the application was forwarded only for automatic applications', () => {
    expect(notificationText(n('application.auto', { jobTitle: 'Driver', organizationName: 'XYZ', score: 82 }))).toContain('forwarded to the employer');
    expect(notificationText(n('job.recommended', { jobTitle: 'Driver', organizationName: 'XYZ', score: 82 }))).not.toContain('forwarded');
  });
  it('gives the employer a count, with singular and plural', () => {
    expect(notificationText(n('job.matches', { jobTitle: 'Driver', matching: 1 }))).toContain('1 candidate matches');
    expect(notificationText(n('job.matches', { jobTitle: 'Driver', matching: 7, strong: 3 }))).toContain('7 candidates match');
    expect(notificationLink(n('job.matches', { jobId: 'j1' }), 'EMPLOYER')).toBe('/employer/jobs/j1/recommended');
  });
  it('explains a rejection and keeps the profile available', () => {
    const t = notificationText(n('application.status', { jobTitle: 'Driver', status: 'REJECTED', reasons: ['Required skills not on your profile: Welding'], otherMatches: 2, note: 'Licence needed' }));
    expect(t).toContain('not selected');
    expect(t).toContain('Welding');
    expect(t).toContain('Licence needed');
    expect(t).toContain('2 other open jobs fit you');
    expect(t).toContain('stays available');
  });
  it('describes each step of an offer for the right person', () => {
    expect(notificationText(n('offer.made', { jobTitle: 'Driver', organizationName: 'Abay Transport', startDate: '2026-12-01', respondBy: '2026-11-25' }))).toContain('Abay Transport sent you a job offer');
    expect(notificationText(n('offer.responded', { jobTitle: 'Driver', candidateName: 'Abebe', accepted: true, startDate: '2026-12-01' }))).toContain('Abebe accepted your offer');
    expect(notificationText(n('offer.responded', { jobTitle: 'Driver', candidateName: 'Abebe', accepted: false }))).toContain('declined');
    expect(notificationText(n('offer.reminder', { jobTitle: 'Driver', kind: 'start', audience: 'worker', startDate: '2026-12-01' }))).toContain('starts on 2026-12-01');
    expect(notificationText(n('offer.reminder', { jobTitle: 'Driver', kind: 'answer', respondBy: '2026-11-25' }))).toContain('runs out on 2026-11-25');
    expect(notificationLink(n('offer.made', { jobId: 'j1' }), 'WORKER')).toBe('/applications');
    expect(notificationLink(n('offer.responded', { jobId: 'j1' }), 'EMPLOYER')).toBe('/employer/jobs/j1/applications');
  });
});
