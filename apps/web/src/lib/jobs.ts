import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { JobRequirementView } from '@/lib/criteria';

export interface JobListItem {
  id: string;
  title: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'CLOSED' | 'FILLED' | 'REMOVED';
  organization: { id: string; name: string; verified: boolean; type?: string };
  category: { id: string; slug: string; name: string };
  employmentType: string;
  workMode: string;
  seniority?: string | null;
  /** Groups the employer welcomes (see OPEN_TO_LABEL). */
  openTo?: string[];
  workplace?: string | null;
  recruitmentMethod?: string | null;
  /** What salaryMin and salaryMax count: per month, day, hour ... (null on older jobs: monthly). */
  payBasis?: string | null;
  benefitTags?: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  vacancies: number;
  deadline: string | null;
  publishedAt: string | null;
  /** Shown first in the search because the employer's plan includes featuring. */
  featured?: boolean;
  locationPath: { id: string; level: string; name: string }[];
  skills: string[];
  expired?: boolean;
  applicationCount?: number;
}

export interface JobDetail extends JobListItem {
  description: string;
  benefits: string | null;
  schedule: string | null;
  startDate: string | null;
  languages: string[];
  minExperienceYears: number | null;
  requiredEducationLevel: string | null;
  approxLocation: { lat: number; lng: number } | null;
  expired: boolean;
  organization: JobListItem['organization'] & { description: string | null; website: string | null; type: string };
  allSkills: { skillId: string; name: string; importance: 'REQUIRED' | 'PREFERRED'; minProficiency: number | null }[];
  /** Vacancy reference number, and the label of the organization type's formal recruitment (for example "Government vacancy"). */
  referenceNumber?: string | null;
  vacancyLabel?: string | null;
  /** Sector requirements (licence, shifts, tools...). */
  criteria: JobRequirementView[];
  categoryId?: string;
  locationId?: string | null;
}

export interface JobSearchResult {
  items: JobListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const useJobSearch = (qs: string) =>
  useQuery({ queryKey: ['jobs', qs], placeholderData: (prev) => prev, queryFn: () => api<JobSearchResult>(`/jobs?${qs}`) });

export interface JobViewer { application: { id: string; status: string } | null; saved: boolean }
export type JobWithViewer = JobDetail & { viewer: JobViewer | null };

export const useJob = (id: string | undefined) =>
  useQuery({
    queryKey: ['job', id],
    enabled: !!id,
    queryFn: async (): Promise<JobWithViewer> => {
      const r = await api<{ job: JobDetail; viewer: JobViewer | null }>(`/jobs/${id}`);
      return { ...r.job, viewer: r.viewer };
    },
  });

export const useMyJobs = () =>
  useQuery({ queryKey: ['my-jobs'], queryFn: async () => (await api<{ items: JobListItem[] }>('/jobs/mine')).items });
