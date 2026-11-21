import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { RecommendedJob } from '@/lib/matching';

export interface CvFinding { code: string; severity: 'ok' | 'info' | 'warn' | 'block'; message: string; expected?: string; found?: string }
export interface CvCheck { id: string; outcome: 'ACCEPTED' | 'DECLINED' | 'UNCHECKED'; reason: string | null; findings: CvFinding[]; createdAt: string }
export interface Opportunities { reason: string; items: RecommendedJob[] }
export interface CvResult { cvCheck?: CvCheck; check?: CvCheck; opportunities: Opportunities | null }

/** What the system tells the person when it declines: why, and what to do. */
export interface Declined { message: string; reasons: string[]; warnings: string[]; fix: string[] }
export function declinedFrom(e: unknown): Declined | null {
  if (!(e instanceof ApiError) || e.code !== 'PROFILE_MISMATCH') return null;
  const d = (e.details ?? {}) as Record<string, string[]>;
  return { message: e.message, reasons: d.reasons ?? [], warnings: d.warnings ?? [], fix: d.fix ?? [] };
}

export const useLatestCvCheck = () => useQuery({ queryKey: ['cv-check'], queryFn: () => api<{ hasCv: boolean; check: CvCheck | null }>('/workers/me/cv-check') });

const refresh = (qc: ReturnType<typeof useQueryClient>) => Promise.all(['cv-check', 'worker-profile', 'recommended-jobs'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

/** Upload a CV: the server compares it with the profile and either accepts it (and returns the jobs that fit) or declines it. */
export function useCvUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api<CvResult>('/workers/me/cv', { method: 'POST', body });
    },
    onSettled: () => { void refresh(qc); },
  });
}

/** Compare the CV that is already on the profile again, for example after correcting a detail. */
export function useRecheckCv() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<CvResult>('/workers/me/cv-check', { method: 'POST', body: {} }), onSettled: () => { void refresh(qc); } });
}
