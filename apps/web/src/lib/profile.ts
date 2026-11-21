import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, fetchBlobUrl } from '@/lib/api';

export interface WorkerProfile {
  id: string;
  headline: string | null;
  bio: string | null;
  occupation: string | null;
  categoryId: string | null;
  yearsExperience: number;
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  preferredTypes: string[];
  preferredWorkModes: string[];
  availability: string;
  availableFrom: string | null;
  locationId: string | null;
  lat: number | null;
  lng: number | null;
  maxTravelKm: number | null;
  willingToRelocate: boolean;
  languages: string[];
  portfolioUrls: string[];
  isVisible: boolean;
  profileViews: number;
  completionPct: number;
  photoUrl: string | null;
  cvUrl: string | null;
  locationPath: { id: string; level: string; name: string }[];
  skills: { skillId: string; name: string; proficiency: number; years: number | null; source: 'SELF_REPORTED' | 'VERIFIED'; tested?: { score: number | null; at: string } | null }[];
  education: { id: string; level: string; field: string | null; institution: string | null; department: string | null; gpa: number | null; gpaScale: number | null; year: number | null; source: string; documentUrl: string | null }[];
  certifications: { id: string; name: string; issuer: string | null; year: number | null; source: string; documentUrl: string | null }[];
  activities: Activity[];
  experiences: { id: string; title: string; employer: string | null; startDate: string; endDate: string | null; description: string | null; source: 'SELF_REPORTED' | 'VERIFIED' }[];
  completion: { pct: number; items: { key: string; label: string; points: number; done: boolean }[] };
}

export type ActivityKind = 'INTERNSHIP' | 'VOLUNTEER' | 'TRAINING' | 'APPRENTICESHIP' | 'REFERENCE';
export interface Activity {
  id: string; kind: ActivityKind; title: string; organization: string | null; startDate: string | null; endDate: string | null;
  hours: number | null; description: string | null; source: string; documentUrl: string | null;
}
export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  INTERNSHIP: 'Internship', VOLUNTEER: 'Voluntary service', TRAINING: 'Training course', APPRENTICESHIP: 'Apprenticeship (learned a trade)', REFERENCE: 'Reference (someone who can vouch for you)',
};

export interface Option { id: string; nameEn: string; nameAm?: string | null; nameOm?: string | null }

/** A place's name in the reader's language, falling back to English when no label has been added yet. */
export const placeLabel = (l: Option, locale: string) => (locale === 'am' ? l.nameAm : locale === 'om' ? l.nameOm : null) || l.nameEn;

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], staleTime: 300_000, queryFn: async () => (await api<{ items: Option[] }>('/categories')).items });

export const useLocations = (parentId?: string) =>
  useQuery({
    queryKey: ['locations', parentId ?? 'regions'],
    staleTime: 300_000,
    queryFn: async () => (await api<{ items: Option[] }>(parentId ? `/locations?parentId=${parentId}` : '/locations')).items,
  });

export const useSkillSearch = (q: string) =>
  useQuery({
    queryKey: ['skills', q],
    enabled: q.trim().length >= 2,
    queryFn: async () => (await api<{ items: Option[] }>(`/skills?q=${encodeURIComponent(q.trim())}`)).items,
  });

export const useWorkerProfile = (opts: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['worker-profile'],
    enabled: opts.enabled ?? true,
    queryFn: async () => (await api<{ profile: WorkerProfile }>('/workers/me')).profile,
  });

export type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

/** Run a profile mutation and keep the cached profile in sync with the server's answer. */
export function useProfileAction<TArgs>(run: (args: TArgs) => Promise<{ profile: WorkerProfile }>) {
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const mutation = useMutation({
    mutationFn: run,
    onMutate: () => setState({ status: 'saving' }),
    onSuccess: (data) => {
      qc.setQueryData(['worker-profile'], data.profile);
      setState({ status: 'saved' });
    },
    onError: (e) => setState({ status: 'error', message: e instanceof ApiError ? firstDetail(e) : 'Could not reach the server' }),
  });
  return { ...mutation, state };
}

function firstDetail(e: ApiError) {
  const first = Object.values(e.details ?? {})[0]?.[0];
  return first ?? e.message;
}

/** Load a protected image as an object URL and release it when it changes. */
export function useProtectedImage(url: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    fetchBlobUrl(url)
      .then((u) => {
        if (revoked) URL.revokeObjectURL(u);
        else {
          objectUrl = u;
          setSrc(u);
        }
      })
      .catch(() => setSrc(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return src;
}
