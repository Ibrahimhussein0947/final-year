import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** The hiring rules that apply to one organization type (edited by administrators). */
export interface HiringPolicy {
  organizationType: string;
  label: string | null;
  minAnnouncementDays: number;
  requireVerified: boolean;
  requireDeadline: boolean;
  requireSalary: boolean;
  requireReference: boolean;
  requireDecisionNote: boolean;
  requireInterview: boolean;
}

export const useHiringRules = () =>
  useQuery({
    queryKey: ['hiring-rules'],
    queryFn: () => api<{ organizationType: string; verificationStatus: string; rules: HiringPolicy }>('/employers/me/hiring-rules'),
  });

/** The rules as short plain sentences. Empty when the organization type has no extra rules. */
export function describeRules(p: HiringPolicy): string[] {
  const out: string[] = [];
  if (p.requireVerified) out.push('Your organization must be verified before it can publish jobs.');
  if (p.minAnnouncementDays > 0) out.push(`Each vacancy must stay open for at least ${p.minAnnouncementDays} days, and a candidate can be accepted only after the closing date.`);
  else if (p.requireDeadline) out.push('Each vacancy needs a closing date.');
  if (p.requireSalary) out.push('State the salary or pay scale.');
  if (p.requireReference) out.push('Give each vacancy a reference number.');
  if (p.requireInterview) out.push('Record an interview before accepting a candidate.');
  if (p.requireDecisionNote) out.push('Write a reason when you accept or reject a candidate; it is kept with the decision.');
  return out;
}
