import type { OrganizationType } from '@prisma/client';
import type { Policy } from './service';

/**
 * Who is hiring: the kinds of employer, grouped so people can find theirs, with what each should prepare for the
 * "verified employer" check. The hiring RULES per type live in hiring/service.ts (database, editable by administrators).
 *
 * The labels, descriptions and "documents to prepare" are reasoned defaults written by the developer, NOT legal advice
 * and not checked against Ethiopian regulation: the administrator decides what counts as acceptable proof.
 */
export type OrgGroup = 'business' | 'public' | 'nonprofit' | 'individual' | 'agency' | 'institution';

export const GROUP_LABEL: Record<OrgGroup, string> = {
  business: 'Businesses',
  public: 'Government and public bodies',
  nonprofit: 'Non-profit and international',
  individual: 'Individuals and households',
  agency: 'Agencies',
  institution: 'Schools and training',
};
export const ORG_GROUPS = Object.keys(GROUP_LABEL) as OrgGroup[];

export interface OrgTypeInfo {
  value: OrganizationType;
  label: string;
  group: OrgGroup;
  description: string;
  /** What to upload when asking for the verified badge (one clear document is enough to start the review). */
  documents: string[];
  /** Older industry-flavoured choices kept for existing accounts; new ones pick "Private company" and post in the right sector. */
  legacy?: boolean;
}

const OLD = (label: string, sector: string): Pick<OrgTypeInfo, 'description' | 'documents' | 'legacy' | 'group'> => ({
  group: 'business', legacy: true, documents: ['Trade or business licence'],
  description: `Older choice, kept for existing accounts. New accounts choose "Private company" and post jobs in the ${sector} sector.`,
});

export const ORG_TYPE_INFO: OrgTypeInfo[] = [
  { value: 'PRIVATE_COMPANY', label: 'Private company', group: 'business', description: 'A privately owned business.', documents: ['Trade or business licence', 'Tax registration certificate'] },
  { value: 'SME', label: 'Small or medium business', group: 'business', description: 'A small shop, workshop or sole trader.', documents: ['Business licence or trader registration'] },
  { value: 'COOPERATIVE', label: 'Cooperative or association', group: 'business', description: 'A member-owned cooperative, union or association.', documents: ['Cooperative or association registration certificate'] },
  { value: 'PUBLIC_ENTERPRISE', label: 'Public company or state-owned enterprise', group: 'public', description: 'A publicly owned enterprise, a state-owned company, or a company owned by many shareholders.', documents: ['Establishment or registration document', 'Letter authorising you to recruit'] },
  { value: 'GOVERNMENT', label: 'Government office or agency', group: 'public', description: 'A federal, regional or local government office, ministry or agency.', documents: ['Official letter on the office letterhead authorising you to recruit', 'Your office ID or appointment letter'] },
  { value: 'NGO', label: 'NGO or international organization', group: 'nonprofit', description: 'A non-governmental or civil-society organization, an embassy, or a UN or international agency.', documents: ['Registration or accreditation certificate', 'Letter showing you represent the organization'] },
  { value: 'INDIVIDUAL', label: 'Individual hiring for themselves', group: 'individual', description: 'A person hiring someone for personal work, such as a driver, a tutor or a builder.', documents: ['A valid ID (kebele or national ID)'] },
  { value: 'HOUSEHOLD', label: 'Household (family)', group: 'individual', description: 'A family hiring domestic help, a nanny or a gardener.', documents: ['A valid ID of the person hiring'] },
  { value: 'RECRUITMENT_AGENCY', label: 'Recruitment agency', group: 'agency', description: 'A licensed agency recruiting on behalf of other employers.', documents: ['Employment-agency licence', 'Trade licence'] },
  { value: 'TRAINING_INSTITUTION', label: 'Training institution (school, college, TVET)', group: 'institution', description: 'A school, college or training centre.', documents: ['Accreditation or registration document'] },
  { value: 'CONSTRUCTION', label: 'Construction company', ...OLD('Construction company', 'construction') },
  { value: 'FACTORY', label: 'Factory', ...OLD('Factory', 'manufacturing') },
  { value: 'HOTEL_RESTAURANT', label: 'Hotel or restaurant', ...OLD('Hotel or restaurant', 'hospitality') },
  { value: 'AGRICULTURAL', label: 'Agricultural organization', ...OLD('Agricultural organization', 'agriculture') },
];

export const orgTypeInfo = (type: OrganizationType): OrgTypeInfo => ORG_TYPE_INFO.find((t) => t.value === type)!;
export const typesInGroup = (group: OrgGroup): OrganizationType[] => ORG_TYPE_INFO.filter((t) => t.group === group).map((t) => t.value);

/** The rules of a policy in plain words (same semantics as hiring/service.ts). */
export function describeRules(p: Policy): string[] {
  const rules: string[] = [];
  if (p.requireVerified) rules.push('The organization must be verified by an administrator before a job can be published.');
  if (p.requireReference) rules.push('Every job needs a vacancy announcement or reference number.');
  if (p.requireDeadline || p.minAnnouncementDays > 0) rules.push('Every job needs a closing date.');
  if (p.minAnnouncementDays > 0) rules.push(`A job must stay open for at least ${p.minAnnouncementDays} days, and nobody can be accepted before it closes.`);
  if (p.requireSalary) rules.push('The salary or pay-scale range must be stated.');
  if (p.requireInterview) rules.push('An interview must be recorded before a candidate is accepted.');
  if (p.requireDecisionNote) rules.push('A written reason (at least 10 characters) is required to accept or reject a candidate.');
  const names: Record<string, string> = { ID_VERIFIED: "the candidate's ID is verified on the platform", WRITTEN_EXAM: 'a written exam result is recorded', PRACTICAL_TEST: 'a practical skills test result is recorded',SCORE_SHEET: p.panelSize > 1 ? `${p.panelSize} different selection panel members each record a score sheet` : 'a selection panel score sheet is recorded', REFERENCE_CHECKED: 'a reference check is recorded', GUARANTOR_RECORDED: 'a guarantor is recorded' };
  if (p.requiredSteps.length) rules.push(`Before a candidate is accepted: ${p.requiredSteps.map((s) => names[s] ?? s).join('; ')}.`);
  if (p.maxProbationDays !== null && p.maxProbationDays !== undefined) rules.push(`An offer may state a probation period of at most ${p.maxProbationDays} days.`);
  if (p.appealDays > 0) rules.push(`A rejected candidate may ask for a review within ${p.appealDays} days, and you must answer in writing.`);
  return rules;
}
