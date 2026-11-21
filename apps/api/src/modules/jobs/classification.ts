/**
 * How a job can be described beyond its title and category: the ways of employing someone, the seniority of the position,
 * and the groups the employer says they welcome. Held here so the API, the search filters and the forms use one list.
 */
export const EMPLOYMENT_TYPES = [
  'FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACT', 'FREELANCE', 'INTERNSHIP', 'SEASONAL', 'DAILY',
  'PERMANENT', 'CASUAL', 'APPRENTICESHIP', 'VOLUNTEER', 'GIG', 'ON_CALL',
] as const;

export const SENIORITY_LEVELS = ['ENTRY', 'JUNIOR', 'INTERMEDIATE', 'SENIOR', 'SPECIALIST', 'SUPERVISOR', 'MANAGER', 'EXECUTIVE'] as const;

/**
 * "Open to" says who an employer actively welcomes. It adds a tag that people can search by; it never stops anyone else from
 * applying and it is not used to score or rank candidates. Wording stays on welcoming, not on requiring.
 */
export const OPEN_TO = [
  'DISABILITY', 'STUDENTS', 'YOUTH', 'RETIREES', 'RETURNING_TO_WORK', 'SECOND_CHANCE', 'REFUGEES', 'MIGRANTS', 'NO_EXPERIENCE',
] as const;
export type OpenTo = (typeof OPEN_TO)[number];

// Independent dimensions of a job (see schema.prisma): how it is paid, where it is done, how people are selected, what comes with it.
export const PAY_BASES = ['MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY', 'PER_PROJECT', 'COMMISSION', 'PIECE_RATE', 'PERFORMANCE', 'NEGOTIABLE', 'UNPAID'] as const;
export const WORKPLACES = [
  'OFFICE', 'HOME', 'FACTORY', 'FARM', 'HEALTH_FACILITY', 'CONSTRUCTION_SITE', 'OUTDOOR', 'INDUSTRIAL_FACILITY', 'VEHICLE', 'SHIP', 'AIRCRAFT',
  'LABORATORY', 'RETAIL_SHOP', 'MULTIPLE_SITES', 'FULLY_REMOTE',
] as const;
export const RECRUITMENT_METHODS = ['OPEN', 'INTERNAL', 'REFERRAL', 'DIRECT', 'COMPETITIVE', 'MASS', 'EMERGENCY', 'SEASONAL', 'CAMPUS', 'AGENCY'] as const;
export const BENEFIT_TAGS = [
  'ACCOMMODATION', 'TRANSPORT', 'FOOD', 'HEALTH_INSURANCE', 'PENSION', 'PAID_LEAVE', 'TRAINING', 'RELOCATION', 'OVERTIME_PAY', 'BONUS',
] as const;

/** Working days in a month, and hours in a working day, used to bring daily and hourly pay to a monthly figure. */
export const DAYS_PER_MONTH = 26;
export const HOURS_PER_DAY = 8;
export const WEEKS_PER_MONTH = 4;

/**
 * The monthly equivalent of a pay amount, so it can be compared with a worker's monthly expectation or a monthly search filter.
 * Null when the pay is not a fixed amount over time (per project, commission, piece-rate, performance, negotiable, unpaid):
 * those are shown as they are and are never compared, so they do not look cheap or expensive by accident.
 */
export function monthlyEquivalent(amount: number | null, basis: string | null | undefined): number | null {
  if (amount === null) return null;
  switch (basis ?? 'MONTHLY') {
    case 'MONTHLY': return amount;
    case 'WEEKLY': return amount * WEEKS_PER_MONTH;
    case 'DAILY': return amount * DAYS_PER_MONTH;
    case 'HOURLY': return amount * HOURS_PER_DAY * DAYS_PER_MONTH;
    default: return null;
  }
}

/**
 * Employment types that mean the same thing to a worker looking for work, in either direction. A worker who prefers
 * full-time work should not be marked down for a permanent post.
 */
export const SIMILAR_TYPES: [string, string][] = [
  ['FULL_TIME', 'PERMANENT'], ['DAILY', 'CASUAL'], ['FREELANCE', 'GIG'], ['INTERNSHIP', 'APPRENTICESHIP'], ['PART_TIME', 'ON_CALL'],
];

export const typeAccepted = (preferred: readonly string[], jobType: string) =>
  preferred.includes(jobType) || SIMILAR_TYPES.some(([a, b]) => (jobType === a && preferred.includes(b)) || (jobType === b && preferred.includes(a)));
