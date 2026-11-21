import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** "You meet 4 of 6 requirements" for the jobs on a page. */
export interface Fit {
  score: number; strength: 'strong' | 'good' | 'partial' | 'weak'; eligibility: string;
  total: number; met: number; missing: string[]; nothingListed: boolean;
}
export const useJobFit = (jobIds: string[], enabled: boolean) =>
  useQuery({
    queryKey: ['job-fit', jobIds.join(',')],
    enabled: enabled && jobIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => (await api<{ items: Record<string, Fit> }>('/jobs/fit', { method: 'POST', body: { jobIds } })).items,
  });

export type SalaryGuide =
  | { available: true; currency: string; scope: { level: string; name: string }; sample: number; low: number; median: number; high: number }
  | { available: false; sample: number; needed: number };
export const useSalaryGuide = (categoryId: string | undefined, locationId: string | null | undefined) =>
  useQuery({
    queryKey: ['salary-guide', categoryId, locationId ?? ''],
    enabled: !!categoryId,
    staleTime: 5 * 60_000,
    queryFn: () => api<SalaryGuide>(`/jobs/salary-guide?categoryId=${categoryId}${locationId ? `&locationId=${locationId}` : ''}`),
  });

export interface Rating { count: number; average: number | null; paidOnTime: number | null; respectful: number | null; asDescribed: number | null; hidden: boolean }
export const useOrgRating = (organizationId: string | undefined) =>
  useQuery({ queryKey: ['org-rating', organizationId], enabled: !!organizationId, queryFn: async () => (await api<{ rating: Rating }>(`/organizations/${organizationId}/rating`)).rating });
