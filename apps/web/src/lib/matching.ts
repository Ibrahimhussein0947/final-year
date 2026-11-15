import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { JobListItem } from '@/lib/jobs';
import type { PublicProfile } from '@/lib/applications';

export type ComponentKey = 'skills' | 'experience' | 'location' | 'qualification' | 'availability' | 'preferences' | 'criteria';
export type Eligibility = 'eligible' | 'not_eligible' | 'unknown' | 'n/a';
export type Strength = 'strong' | 'good' | 'partial' | 'weak';

export interface BriefMatch { score: number; confidence: number; strength: Strength; eligibility?: Eligibility }

export interface CriteriaDetail {
  met: { label: string; verified: boolean }[];
  unmet: { label: string; mustHave: boolean }[];
  unknown: { label: string; mustHave: boolean }[];
  eligibility: Eligibility;
}

export interface Match extends BriefMatch {
  explanation: string;
  components: Record<ComponentKey, { score: number | null; weight: number; note: string }>;
  matchedSkills: string[];
  relatedSkills: { required: string; has: string; credit: number }[];
  missingSkills: string[];
  notAssessed: { component: ComponentKey; reason: string }[];
  distanceKm: number | null;
  engineVersion: string;
  criteria?: CriteriaDetail;
  eligibility?: Eligibility;
  /** Present when the AI service contributed; similarity is null when it did not. */
  semantic?: { similarity: number | null; score: number | null; lift: number };
}

export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  skills: 'Skills', experience: 'Experience', location: 'Location',
  qualification: 'Qualification', availability: 'Availability', preferences: 'Pay and preferences', criteria: 'Sector requirements',
};

export interface RecommendedJob { job: JobListItem; match: Match }
export interface RecommendedWorker {
  workerId: string; name: string; headline: string | null; occupation: string | null; yearsExperience: number;
  photoUrl: string | null; location: string | null; skills: string[]; match: Match;
  invitation?: 'SENT' | 'APPLIED' | 'DECLINED' | null;
}

export const useRecommendedJobs = (limit = 10, enabled = true) =>
  useQuery({
    queryKey: ['recommended-jobs', limit],
    enabled,
    queryFn: () => api<{ reason: 'ok' | 'no_profile_data'; items: RecommendedJob[] }>(`/recommendations/jobs?limit=${limit}`),
  });

export const useMyMatch = (jobId: string | undefined, enabled: boolean) =>
  useQuery({ queryKey: ['my-match', jobId], enabled: enabled && !!jobId, queryFn: async () => (await api<{ match: Match }>(`/jobs/${jobId}/match`)).match });

export const useRecommendedWorkers = (jobId: string | undefined) =>
  useQuery({
    queryKey: ['recommended-workers', jobId],
    enabled: !!jobId,
    queryFn: () => api<{ job: { id: string; title: string }; items: RecommendedWorker[] }>(`/jobs/${jobId}/recommended-workers?limit=20`),
  });

export const useWorkerProfileForEmployer = (workerId: string | undefined) =>
  useQuery({ queryKey: ['worker-public', workerId], enabled: !!workerId, queryFn: async () => (await api<{ profile: PublicProfile }>(`/workers/${workerId}`)).profile });
