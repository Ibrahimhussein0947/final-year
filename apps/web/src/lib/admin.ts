import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, ApiError, fetchBlobUrl } from '@/lib/api';

export const useAdminQuery = <T,>(key: QueryKey, path: string, enabled = true) =>
  useQuery({ queryKey: ['admin', ...key], enabled, queryFn: () => api<T>(`/admin${path}`) });

/** A PATCH/POST/PUT/DELETE against the admin API that refreshes admin data and reports errors in plain words. */
export function useAdminAction<TArgs = void>(run: (args: TArgs) => Promise<unknown>, opts: { invalidate?: string[] } = {}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: run,
    onSuccess: async () => {
      setError(null);
      // each name is its own cache entry (['admin', 'reports'], ['admin', 'stats'], ...), not one nested key
      const names = opts.invalidate?.length ? opts.invalidate : [];
      await Promise.all(names.length ? names.map((n) => qc.invalidateQueries({ queryKey: ['admin', n] })) : [qc.invalidateQueries({ queryKey: ['admin'] })]);
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string | undefined) ?? e.message : 'Could not reach the server'),
  });
  return { ...m, error, clearError: () => setError(null) };
}

/** Download a file from a protected URL (CSV exports, uploaded evidence) using the signed-in session. */
export async function downloadProtected(url: string, filename: string) {
  const blobUrl = await fetchBlobUrl(url);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

export interface AdminStats {
  users: number; workers: number; employers: number; jobs: number; activeJobs: number; applications: number;
  successfulRecruitments: number; pendingVerifications: number; openReports: number; suspiciousAds: number;
  suspendedUsers: number; unverifiedOrganizations: number;
}
export interface AdminUser {
  id: string; fullName: string; phone: string; email: string | null; role: string; status: string; createdAt: string; lastLoginAt: string | null;
  phoneVerified: boolean; emailVerified: boolean; organization: { name: string; verificationStatus: string } | null;
}
export interface VerificationItem {
  id: string; kind: string; status: string; createdAt: string; note: string | null; target: string | null; evidenceUrl: string | null;
  requester: { id: string; name: string; role: string }; organization: { name: string; type: string; verificationStatus: string } | null;
  /** What the system could match in an uploaded document. A hint for the reviewer, never a verdict. */
  check: AutoCheck | null;
}
export interface AutoCheck {
  docType: string; outcome: 'CONSISTENT' | 'PARTIAL' | 'MISMATCH' | 'UNREADABLE'; reason: string | null; ocrConfidence: number | null; textChars: number;
  fields: { field: string; expected: string; status: 'FOUND' | 'CLOSE' | 'NOT_FOUND'; required: boolean; note?: string; read?: string }[];
  flags: { code: string; level: 'info' | 'warn'; message: string }[];
}
export interface ReportItem {
  id: string; targetType: 'JOB' | 'USER' | 'SERVICE'; targetId: string; reason: string; details: string | null; status: string; createdAt: string; reporter: string;
  target: { label: string; status?: string } | null; openReportsOnTarget: number; resolutionNote: string | null;
}
export interface PendingJob { id: string; title: string; snippet: string; category: string; organization: string; organizationVerified: boolean; reason: string; createdAt: string }
export interface AuditItem { id: string; at: string; action: string; entityType: string; entityId: string | null; meta: unknown; actor: { id: string; name: string; role: string } | null }
export interface CategoryRow { id: string; slug: string; nameEn: string; nameAm: string | null; nameOm: string | null; isActive: boolean; skills: number; jobs: number }
export interface SkillRow { id: string; slug: string; nameEn: string; nameAm: string | null; nameOm: string | null; aliases: string[]; isActive: boolean; categoryId: string; category: string; workers: number; jobs: number }
export interface Paged<T> { total: number; page: number; pageSize: number; items: T[] }
