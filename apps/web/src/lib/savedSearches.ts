import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, string | number>;
  alertsEnabled: boolean;
  lastAlertedAt: string | null;
  createdAt: string;
}

const KEY = ['saved-searches'];

export const useSavedSearches = (enabled: boolean) =>
  useQuery({ queryKey: KEY, enabled, queryFn: () => api<{ items: SavedSearch[]; max: number }>('/saved-searches') });

export function useSavedSearchActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    create: useMutation({
      mutationFn: (b: { name: string; filters: Record<string, string>; alertsEnabled: boolean }) => api('/saved-searches', { method: 'POST', body: b }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; alertsEnabled?: boolean }) => api(`/saved-searches/${id}`, { method: 'PATCH', body: b }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/saved-searches/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

/** A short, readable summary of what a saved search looks for. */
export function describeFilters(f: Record<string, string | number>): string {
  const label: Record<string, string> = {
    q: 'Words', region: 'Region', category: 'Category', type: 'Type', mode: 'Arrangement', minSalary: 'Min salary', language: 'Language',
    postedWithin: 'Posted within (days)', maxExperience: 'Max experience (yrs)', maxEducation: 'Schooling', employerGroup: 'Employer',
  };
  const parts = Object.entries(f).map(([k, v]) => {
    if (v === 'true') return label[k] ?? k.replace(/([A-Z])/g, ' $1').toLowerCase();
    if (k === 'locationId' || k === 'categoryId' || k === 'skills') return null;
    return `${label[k] ?? k}: ${String(v).replace(/_/g, ' ').toLowerCase()}`;
  }).filter(Boolean);
  const hidden = Object.keys(f).filter((k) => ['locationId', 'categoryId', 'skills'].includes(k)).length;
  return [...parts, ...(hidden ? [`${hidden} more filter${hidden > 1 ? 's' : ''}`] : [])].join(' · ');
}
