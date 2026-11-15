import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Match } from '@/lib/matching';

export type InvitationState = 'SENT' | 'APPLIED' | 'DECLINED';

export interface TalentItem {
  workerId: string; name: string; headline: string | null; occupation: string | null; yearsExperience: number;
  photoUrl: string | null; location: string | null; availability: string; completionPct: number; skills: string[];
  verified: { skills: number; qualifications: number; answers: number };
  /** Present only when the search is ranked by one of the employer's jobs. */
  match?: Match | null; invitation?: InvitationState | null; applied?: boolean;
}
export interface TalentResult { job: { id: string; title: string } | null; total: number; page: number; pageSize: number; capped: boolean; items: TalentItem[] }

export const AVAILABILITY_LABEL: Record<string, string> = {
  IMMEDIATELY: 'Available now', FLEXIBLE: 'Flexible', WITHIN_TWO_WEEKS: 'Within 2 weeks', WITHIN_ONE_MONTH: 'Within a month', NOT_AVAILABLE: 'Not available',
};

export const useTalentSearch = (qs: string, enabled = true) =>
  useQuery({ queryKey: ['talent', qs], enabled, placeholderData: (prev) => prev, queryFn: () => api<TalentResult>(`/talent/search?${qs}`) });

export function useInviteWorker(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workerId: string; message?: string }) => api(`/jobs/${jobId}/invitations`, { method: 'POST', body: { workerId: v.workerId, ...(v.message?.trim() ? { message: v.message.trim() } : {}) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['talent'] });
      void qc.invalidateQueries({ queryKey: ['recommended-workers', jobId] });
      void qc.invalidateQueries({ queryKey: ['job-invitations', jobId] });
    },
  });
}

export interface JobInvitationRow { id: string; conversationId: string | null; status: InvitationState; message: string | null; createdAt: string; respondedAt: string | null; worker: { id: string; name: string; headline: string | null } }
export const useJobInvitations = (jobId: string | undefined) =>
  useQuery({ queryKey: ['job-invitations', jobId], enabled: !!jobId, queryFn: async () => (await api<{ items: JobInvitationRow[] }>(`/jobs/${jobId}/invitations`)).items });

export interface MyInvitation {
  id: string; conversationId: string | null; status: InvitationState; message: string | null; createdAt: string;
  job: { id: string; title: string; open: boolean; organization: string; verified: boolean; location: string | null };
}
export const useMyInvitations = (enabled = true) =>
  useQuery({ queryKey: ['my-invitations'], enabled, queryFn: async () => (await api<{ items: MyInvitation[] }>('/invitations/mine')).items });

export function useDeclineInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/invitations/${id}/decline`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-invitations'] }),
  });
}

export interface BulkInviteResult { sent: number; failed: number; results: { workerId: string; sent: boolean; reason?: string }[] }
export function useBulkInvite(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workerIds: string[]; message?: string }) =>
      api<BulkInviteResult>(`/jobs/${jobId}/invitations/bulk`, { method: 'POST', body: { workerIds: v.workerIds, ...(v.message?.trim() ? { message: v.message.trim() } : {}) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['talent'] });
      void qc.invalidateQueries({ queryKey: ['recommended-workers', jobId] });
      void qc.invalidateQueries({ queryKey: ['job-invitations', jobId] });
    },
  });
}
