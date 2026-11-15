import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ORG_TYPES as STATIC_TYPES } from '@/lib/taxonomy';

export interface OrgTypeInfo {
  value: string; label: string; group: string; description: string; documents: string[]; legacy?: boolean;
  /** e.g. "Government vacancy": what job pages show for this kind of employer, when the hiring rules define one. */
  policyLabel: string | null;
  /** The hiring rules of this type in plain words (empty when none apply). */
  rules: string[];
}
export interface OrgGroupInfo { group: string; label: string }
export interface OrgTypeCatalog { groups: OrgGroupInfo[]; types: OrgTypeInfo[] }

/** Used only until the catalog loads (or if the API is unreachable), so registration never breaks. */
const FALLBACK: OrgTypeCatalog = {
  groups: [{ group: 'all', label: 'Organization types' }],
  types: STATIC_TYPES.map(([value, label]) => ({ value, label, group: 'all', description: '', documents: [], policyLabel: null, rules: [] })),
};

export const useOrgTypes = () =>
  useQuery({ queryKey: ['org-types'], staleTime: 300_000, queryFn: () => api<OrgTypeCatalog>('/organization-types') });

export const useOrgTypeCatalog = (): OrgTypeCatalog => useOrgTypes().data ?? FALLBACK;

export function useOrgType(value: string | undefined | null): OrgTypeInfo | null {
  const c = useOrgTypeCatalog();
  return value ? c.types.find((t) => t.value === value) ?? null : null;
}

/** What a job page says about who is hiring, or null for an ordinary business (nothing special to say). */
export function useEmployerBadge(type: string | undefined): string | null {
  const c = useOrgTypeCatalog();
  const t = type ? c.types.find((x) => x.value === type) : undefined;
  if (!t || t.group === 'business' || t.group === 'all') return t?.policyLabel ?? null;
  return t.policyLabel ?? c.groups.find((g) => g.group === t.group)?.label ?? t.label;
}
