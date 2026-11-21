import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { BriefMatch, Match } from '@/lib/matching';

export type AppStatus = 'PENDING' | 'UNDER_REVIEW' | 'SHORTLISTED' | 'INTERVIEW_SCHEDULED' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export const STATUS_META: Record<AppStatus, { label: string; tone: 'neutral' | 'info' | 'accent' | 'warning' | 'success' | 'danger' }> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'info' },
  SHORTLISTED: { label: 'Shortlisted', tone: 'accent' },
  INTERVIEW_SCHEDULED: { label: 'Interview scheduled', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
};

export interface Interview { id: string; scheduledAt: string; mode: 'IN_PERSON' | 'PHONE' | 'VIDEO'; locationOrLink: string | null; status: string }
export interface HistoryEntry { from: AppStatus | null; to: AppStatus; note: string | null; at: string }

export interface MyApplication {
  id: string;
  status: AppStatus;
  coverNote: string | null;
  appliedAt: string;
  updatedAt: string;
  job: { id: string; title: string; status: string; organization: string; verified: boolean; location: string | null; deadline: string | null };
  interviews: Interview[];
  history: HistoryEntry[];
  canWithdraw: boolean;
  /** No must-have requirement missed and a match of at least 60. A tracking label, not a decision. */
  qualified: boolean;
  autoApplied: boolean;
  notSelectedReasons: string[];
  /** What the person can do to be a stronger candidate next time. */
  notSelectedTips: { key: string; text: string; link: string }[];
  canReview: boolean;
  review: { rating: number } | null;
}

export interface SavedJobItem {
  savedAt: string;
  job: { id: string; title: string; organization: string; location: string | null; employmentType: string; salaryMin: number | null; salaryMax: number | null; currency: string; deadline: string | null; open: boolean };
}

export interface Candidate {
  workerId: string; name: string; headline: string | null; occupation: string | null; yearsExperience: number;
  location: string | null; skills: string[]; photoUrl: string | null; phone: string | null;
}
export interface ApplicantRow {
  id: string; status: AppStatus; appliedAt: string; coverNote: string | null; allowedNext: AppStatus[]; candidate: Candidate; interviews: Interview[];
  match: BriefMatch | null;
  qualified: boolean;
  autoApplied: boolean;
}
/** Hiring rules of the employer's organization type that affect the screens (see docs/12-hiring-rules.md). */
export interface HiringRulesView { label: string | null; requireDecisionNote: boolean; requireInterview: boolean; announcementClosesAt: string | null }

export interface JobApplicants {
  job: { id: string; title: string; vacancies: number; status: string };
  rules?: HiringRulesView;
  counts: Partial<Record<AppStatus, number>>;
  items: ApplicantRow[];
}

export interface PublicProfile {
  id: string; fullName: string; trust?: import('@/lib/trust').Trust; phoneVerified: boolean; contact: { phone: string } | null;
  headline: string | null; bio: string | null; occupation: string | null; category: { id: string; name: string } | null;
  yearsExperience: number; expectedSalaryMin: number | null; expectedSalaryMax: number | null;
  preferredTypes: string[]; preferredWorkModes: string[]; availability: string; availableFrom: string | null;
  willingToRelocate: boolean; maxTravelKm: number | null; languages: string[]; portfolioUrls: string[]; photoUrl: string | null;
  locationPath: { id: string; level: string; name: string }[];
  skills: { skillId: string; name: string; proficiency: number; years: number | null; source: 'SELF_REPORTED' | 'VERIFIED'; tested?: { score: number | null; at: string } | null }[];
  education: { id: string; level: string; field: string | null; institution: string | null; department: string | null; gpa: number | null; gpaScale: number | null; year: number | null; source: string; hasDocument: boolean; documentUrl: string | null }[];
  certifications: { id: string; name: string; issuer: string | null; year: number | null; source: string; hasDocument: boolean; documentUrl: string | null }[];
  activities: { id: string; kind: string; title: string; organization: string | null; startDate: string | null; endDate: string | null; hours: number | null; description: string | null; source: string; hasDocument: boolean; documentUrl: string | null }[];
  experiences: { id: string; title: string; employer: string | null; startDate: string; endDate: string | null; description: string | null; source?: string; documentUrl?: string | null }[];
  portfolio?: { id: string; url: string; caption: string | null; skillId: string | null; skill: string | null; createdAt: string }[];
  /** Answers to sector questions (licence, shifts, tools...), with verified marks. */
  sectorAnswers?: { criterionId: string; labelEn: string; category: string | null; text: string; verified: boolean }[];
}

export interface CandidateView {
  rules?: HiringRulesView;
  application: { id: string; status: AppStatus; coverNote: string | null; appliedAt: string; allowedNext: AppStatus[]; canSchedule: boolean; job: { id: string; title: string } };
  cvUrl: string | null;
  match: Match | null;
  profile: PublicProfile;
  skillOverlap: { name: string; importance: 'REQUIRED' | 'PREFERRED'; has: boolean }[];
  history: HistoryEntry[];
  interviews: Interview[];
}

export interface CompareResult {
  job: { id: string; title: string };
  requiredSkills: string[];
  columns: { applicationId: string; status: AppStatus; profile: PublicProfile; requiredSkillsHeld: number; match: BriefMatch | null }[];
}

export interface AppNotification { id: string; type: string; payload: Record<string, unknown>; readAt: string | null; createdAt: string }

export const useMyApplications = () =>
  useQuery({ queryKey: ['my-applications'], queryFn: async () => (await api<{ items: MyApplication[] }>('/applications/mine')).items });
export const useSavedJobs = () =>
  useQuery({ queryKey: ['saved-jobs'], queryFn: async () => (await api<{ items: SavedJobItem[] }>('/saved-jobs')).items });
export const useJobApplicants = (jobId: string | undefined, status: string, sort: 'newest' | 'match' = 'newest') =>
  useQuery({
    queryKey: ['job-applicants', jobId, status, sort],
    enabled: !!jobId,
    queryFn: () => api<JobApplicants>(`/jobs/${jobId}/applications?${new URLSearchParams({ ...(status ? { status } : {}), sort }).toString()}`),
  });
export const useCandidate = (id: string | undefined) =>
  useQuery({ queryKey: ['candidate', id], enabled: !!id, queryFn: () => api<CandidateView>(`/applications/${id}`) });
export const useCompare = (ids: string) =>
  useQuery({ queryKey: ['compare', ids], enabled: ids.split(',').filter(Boolean).length >= 2, queryFn: () => api<CompareResult>(`/applications/compare?ids=${ids}`) });
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: AppNotification[]; unread: number }>('/notifications') });
export const useSummary = () =>
  useQuery({ queryKey: ['summary'], queryFn: () => api<{ applications: Partial<Record<AppStatus, number>>; saved?: number; activeJobs?: number; upcomingInterviews: number }>('/applications/summary') });

/** Where clicking a notification should go. */
export function notificationLink(n: AppNotification, role: string | undefined): string {
  const p = n.payload as { jobId?: string; conversationId?: string };
  switch (n.type) {
    case 'message.new': return p.conversationId ? `/messages/${p.conversationId}` : '/messages';
    case 'service.inquiry': return '/service-requests';
    case 'service.inquiry_accepted':
    case 'service.inquiry_declined': return '/service-requests';
    case 'service.removed': return '/my-services';
    case 'job.reviewed': return '/employer/jobs';
    case 'verification.reviewed': return role === 'EMPLOYER' ? '/organization' : '/profile';
    case 'job.matches': return p.jobId ? `/employer/jobs/${p.jobId}/recommended` : '/employer/jobs';
    case 'application.auto': return '/applications';
    case 'interview.reminder': return '/interviews';
    case 'offer.made':
    case 'offer.withdrawn':
    case 'offer.started':
    case 'offer.reminder': return role === 'EMPLOYER' ? (p.jobId ? `/employer/jobs/${p.jobId}/applications` : '/employer/jobs') : '/applications';
    case 'offer.responded':
    case 'offer.expired': return p.jobId ? `/employer/jobs/${p.jobId}/applications` : '/employer/jobs';
    case 'job.invitation':
    case 'search.match':
    case 'job.recommended': return p.jobId ? `/jobs/${p.jobId}` : '/jobs';
    case 'application.received':
    case 'application.withdrawn': return p.jobId ? `/employer/jobs/${p.jobId}/applications` : '/employer/jobs';
    default: return role === 'EMPLOYER' ? '/employer/jobs' : '/applications';
  }
}

export function notificationText(n: AppNotification): string {
  const p = n.payload as { jobTitle?: string; status?: AppStatus; scheduledAt?: string; fromName?: string; count?: number; score?: number; decision?: string; kind?: string; note?: string; rescheduled?: boolean; window?: string; organizationName?: string; searchName?: string; matching?: number; strong?: number; reasons?: string[]; otherMatches?: number; candidateName?: string; topJob?: string; planName?: string; approved?: boolean; response?: 'CONFIRMED' | 'DECLINED'; accepted?: boolean; startDate?: string; respondBy?: string; wasAccepted?: boolean; audience?: string; by?: string };
  const job = p.jobTitle ? `"${p.jobTitle}"` : 'a job';
  switch (n.type) {
    case 'job.reviewed': return `Your job ${job} was ${(p.decision ?? 'reviewed').toLowerCase()} by a moderator${p.note ? `: ${p.note}` : ''}`;
    case 'verification.reviewed': return `Your ${p.kind === 'EMPLOYER' ? 'organization' : (p.kind ?? '').toLowerCase()} verification was ${(p.decision ?? 'reviewed').toLowerCase()}${p.note ? `: ${p.note}` : ''}`;
    case 'message.new': return `${p.count && p.count > 1 ? `${p.count} new messages` : 'New message'} from ${p.fromName ?? 'someone'}`;
    case 'search.match': return `A new job matches your saved search${p.searchName ? ` "${p.searchName}"` : ''}: ${job}${p.organizationName ? ` at ${p.organizationName}` : ''}.`;
    case 'job.invitation': return `${p.organizationName ?? 'An employer'} invited you to apply for ${job}`;
    case 'service.inquiry': return `Someone asked about your service${(n.payload as { serviceTitle?: string }).serviceTitle ? ` "${(n.payload as { serviceTitle?: string }).serviceTitle}"` : ''}. Open your requests to answer.`;
    case 'service.inquiry_accepted': return `A provider accepted your request${(n.payload as { serviceTitle?: string }).serviceTitle ? ` for "${(n.payload as { serviceTitle?: string }).serviceTitle}"` : ''}. You can now chat and see their phone number.`;
    case 'service.inquiry_declined': return `A provider could not take your request${(n.payload as { serviceTitle?: string }).serviceTitle ? ` for "${(n.payload as { serviceTitle?: string }).serviceTitle}"` : ''}. You can ask another provider.`;
    case 'service.removed': return `Your service listing${(n.payload as { serviceTitle?: string }).serviceTitle ? ` "${(n.payload as { serviceTitle?: string }).serviceTitle}"` : ''} was removed by a moderator${(n.payload as { note?: string }).note ? `: ${(n.payload as { note?: string }).note}` : ''}`;
    case 'job.recommended': return `Congratulations! Your qualifications match the requirements of ${p.organizationName ?? 'an employer'} for the ${job} position.${p.score ? ` Your matching score is ${p.score}%.` : ''} Open it to review and apply.`;
    case 'application.auto': return `Your qualifications match the requirements of ${p.organizationName ?? 'an employer'} for the ${job} position.${p.score ? ` Your matching score is ${p.score}%.` : ''} Because automatic applying is on, your application has been forwarded to the employer.`;
    case 'job.matches': return `${p.matching ?? 0} ${p.matching === 1 ? 'candidate matches' : 'candidates match'} the requirements of ${job}${p.strong ? ` (${p.strong} strongly)` : ''}. Open the list to review them.`;
    case 'application.received': return `New application for ${job}`;
    case 'application.withdrawn': return `An applicant withdrew from ${job}`;
    case 'application.status':
      if (p.status === 'REJECTED') {
        return `You were not selected for ${job} this time.${p.reasons?.length ? ` Where the match fell short: ${p.reasons.join('; ')}.` : ''}${p.note ? ` Employer's note: ${p.note}.` : ''} Your profile stays available for other jobs${p.otherMatches ? ` (${p.otherMatches} other open ${p.otherMatches === 1 ? 'job fits' : 'jobs fit'} you)` : ''}.`;
      }
      return `Your application for ${job} is now ${p.status ? STATUS_META[p.status].label.toLowerCase() : 'updated'}`;
    case 'interview.scheduled': return `Interview ${p.rescheduled ? 'moved' : 'scheduled'} for ${job}${p.scheduledAt ? ` on ${new Date(p.scheduledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`;
    case 'interview.responded': return `${p.candidateName ?? 'A candidate'} ${p.response === 'CONFIRMED' ? 'confirmed' : "can't attend"} the interview for ${job}${p.note ? `: "${p.note}"` : ''}`;
    case 'plan.request_decided': return `Your request for the ${p.planName ?? 'new'} plan was ${p.approved ? 'approved. Your plan has been changed' : 'declined'}${p.note ? `: ${p.note}` : '.'}`;
    case 'cv.accepted': return `Your CV was accepted. ${p.count ?? 0} open ${p.count === 1 ? 'job fits' : 'jobs fit'} what you want${p.topJob ? `, for example ${p.topJob}` : ''}. Open Recommended jobs to see them.`;
    case 'offer.made': return `${p.organizationName ?? 'An employer'} sent you a job offer for ${job}${p.startDate ? `, starting ${p.startDate}` : ''}. Open it to read the terms and answer${p.respondBy ? ` by ${p.respondBy}` : ''}.`;
    case 'offer.responded': return `${p.candidateName ?? 'A candidate'} ${p.accepted ? 'accepted' : 'declined'} your offer for ${job}${p.accepted && p.startDate ? `. They start on ${p.startDate}` : ''}.`;
    case 'offer.withdrawn': return `${p.organizationName ?? 'The employer'} took back the ${p.wasAccepted ? 'accepted ' : ''}offer for ${job}.`;
    case 'offer.expired': return `The offer for ${job} ran out without an answer${p.candidateName ? ` from ${p.candidateName}` : ''}. You can send it again.`;
    case 'offer.started': return `${p.by === 'worker' ? (p.candidateName ?? 'The candidate') : (p.organizationName ?? 'The employer')} confirmed that work on ${job} has started.`;
    case 'offer.reminder': return p.kind === 'answer' ? `Your offer for ${job} runs out on ${p.respondBy ?? 'soon'}. Open it to answer.` : p.audience === 'employer' ? `${job} starts on ${p.startDate ?? 'soon'}. Your new hire is expected.` : `Your new job (${job}) starts on ${p.startDate ?? 'soon'}. Good luck!`;
    case 'interview.cancelled': return `An interview for ${job} was cancelled`;
    case 'interview.reminder': {
      const at = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      const soon = p.window === 'hour' ? 'in about an hour' : 'tomorrow or within a day';
      return `Reminder: interview for ${job} ${soon}${at ? ` (${at})` : ''}.`;
    }
    default: return 'New notification';
  }
}
