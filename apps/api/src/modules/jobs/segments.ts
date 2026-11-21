import type { EmploymentType, OrganizationType, Prisma } from '@prisma/client';

/**
 * Four ways to look at the whole employment market, worked out from what a job already says (who the employer is and the
 * kind of work). Nothing is stored, so existing jobs are covered at once. The groups can overlap on purpose: a daily
 * construction laborer is both informal and flexible work. They are a browsing aid, not a legal classification.
 */
export const SEGMENTS = ['formal', 'informal', 'flexible', 'self_employment'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_INFO: Record<Segment, { label: string; help: string }> = {
  formal: { label: 'Formal employment', help: 'Government, public enterprise, NGO and private company jobs.' },
  informal: { label: 'Informal employment', help: 'Household, farm and daily work: house workers, cleaners, gardeners, laborers, porters, drivers, mechanics.' },
  flexible: { label: 'Temporary and flexible', help: 'Part-time, seasonal, daily, temporary, contract and freelance work.' },
  self_employment: { label: 'Self-employment and services', help: 'Freelance work, and one-off service jobs for a household or person: electricians, plumbers, carpenters, painters, tailors, technicians.' },
};

const FORMAL_EMPLOYERS: OrganizationType[] = ['GOVERNMENT', 'PUBLIC_ENTERPRISE', 'NGO', 'PRIVATE_COMPANY'];
const INFORMAL_EMPLOYERS: OrganizationType[] = ['HOUSEHOLD', 'INDIVIDUAL', 'AGRICULTURAL'];
const FLEXIBLE_TYPES: EmploymentType[] = ['PART_TIME', 'SEASONAL', 'DAILY', 'TEMPORARY', 'CONTRACT', 'FREELANCE', 'CASUAL', 'GIG', 'ON_CALL'];
const SERVICE_TYPES: EmploymentType[] = ['CONTRACT', 'DAILY', 'TEMPORARY', 'CASUAL', 'GIG'];

export function segmentFilter(segment: Segment): Prisma.JobWhereInput {
  switch (segment) {
    case 'formal':
      return { organization: { type: { in: FORMAL_EMPLOYERS } } };
    case 'informal':
      return { OR: [{ organization: { type: { in: INFORMAL_EMPLOYERS } } }, { employmentType: { in: ['DAILY', 'CASUAL'] } }] };
    case 'flexible':
      return { employmentType: { in: FLEXIBLE_TYPES } };
    case 'self_employment':
      return { OR: [{ employmentType: { in: ['FREELANCE', 'GIG'] } }, { employmentType: { in: SERVICE_TYPES }, organization: { type: { in: ['HOUSEHOLD', 'INDIVIDUAL'] } } }] };
  }
}
