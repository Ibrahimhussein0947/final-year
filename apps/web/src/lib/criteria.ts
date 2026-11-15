import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useI18n, type Locale } from '@/i18n';

export type CriterionType = 'BOOLEAN' | 'NUMBER' | 'CHOICE' | 'MULTI_CHOICE';
export interface CriterionOption { value: string; labelEn: string; labelAm?: string | null; labelOm?: string | null }
export interface CriterionDef {
  id: string; key: string; type: CriterionType;
  labelEn: string; labelAm: string | null; labelOm: string | null; helpEn: string | null;
  options: CriterionOption[]; unit: string | null; minValue: number | null; maxValue: number | null;
  mustHaveAllowed: boolean; evidenceSuggested: boolean; sortOrder: number; isActive: boolean;
  category: { id: string; slug: string; name: string } | null; // null = every sector
}
export type AnswerValue = boolean | number | string | string[];

/** Label in the chosen language, falling back to English (translations are added by administrators, never invented). */
export const labelFor = (x: { labelEn: string; labelAm?: string | null; labelOm?: string | null }, locale: Locale) =>
  (locale === 'am' ? x.labelAm : locale === 'om' ? x.labelOm : null) || x.labelEn;

export const useLabel = () => {
  const { locale } = useI18n();
  return (x: { labelEn: string; labelAm?: string | null; labelOm?: string | null }) => labelFor(x, locale);
};

export const useCriteriaDefs = () =>
  useQuery({ queryKey: ['criteria-defs'], staleTime: 60_000, queryFn: async () => (await api<{ items: CriterionDef[] }>('/criteria')).items });

/** Definitions that apply to a job category or worker sector: that sector's own plus the shared ones. */
export const defsForCategory = (defs: CriterionDef[] | undefined, categoryId: string | null | undefined) =>
  (defs ?? []).filter((d) => d.category === null || d.category.id === categoryId);

export interface MyCriterion { id: string; criterionId: string; value: AnswerValue; source: 'SELF_REPORTED' | 'VERIFIED'; verifiedAt: string | null; verificationPending: boolean; text: string }

export const useMyCriteria = () =>
  useQuery({ queryKey: ['my-criteria'], queryFn: async () => (await api<{ items: MyCriterion[] }>('/workers/me/criteria')).items });

export function useSaveMyCriteria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { criterionId: string; value: AnswerValue | null }[]) => api('/workers/me/criteria', { method: 'PUT', body: { items } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-criteria'] });
      void qc.invalidateQueries({ queryKey: ['my-match'] });
      void qc.invalidateQueries({ queryKey: ['recommended-jobs'] });
    },
  });
}

/** What a job asks for, in the simple form the API uses. */
export interface JobRequirement { criterionId: string; importance: 'MUST_HAVE' | 'PREFERRED'; value: AnswerValue }
export interface JobRequirementView extends JobRequirement {
  key: string; type: CriterionType; labelEn: string; labelAm: string | null; labelOm: string | null; text: string; evidenceSuggested: boolean;
}
