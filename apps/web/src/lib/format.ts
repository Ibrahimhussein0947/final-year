export const TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time', PART_TIME: 'Part-time', TEMPORARY: 'Temporary', CONTRACT: 'Contract',
  FREELANCE: 'Freelance', INTERNSHIP: 'Internship', SEASONAL: 'Seasonal', DAILY: 'Daily work',
  PERMANENT: 'Permanent', CASUAL: 'Casual', APPRENTICESHIP: 'Apprenticeship', VOLUNTEER: 'Volunteer (unpaid)', GIG: 'Gig (short task)', ON_CALL: 'On-call',
};
export const SENIORITY_LABEL: Record<string, string> = {
  ENTRY: 'Entry level', JUNIOR: 'Junior', INTERMEDIATE: 'Intermediate', SENIOR: 'Senior', SPECIALIST: 'Specialist',
  SUPERVISOR: 'Supervisor', MANAGER: 'Manager', EXECUTIVE: 'Executive or director',
};
/** Groups an employer can say they welcome. A welcome, never a requirement: nobody is turned away by it. */
export const OPEN_TO_LABEL: Record<string, string> = {
  DISABILITY: 'People with disabilities', STUDENTS: 'Students', YOUTH: 'Young people', RETIREES: 'Retired people',
  RETURNING_TO_WORK: 'Returning to work', SECOND_CHANCE: 'Second chance', REFUGEES: 'Refugees', MIGRANTS: 'Migrants and returnees',
  NO_EXPERIENCE: 'No experience needed',
};
/** How the pay is counted. The amount on a job means "per" this unit. */
export const PAY_BASIS_LABEL: Record<string, string> = {
  MONTHLY: 'Monthly salary', WEEKLY: 'Weekly pay', DAILY: 'Daily pay', HOURLY: 'Hourly pay', PER_PROJECT: 'Per project',
  COMMISSION: 'Commission', PIECE_RATE: 'Piece-rate', PERFORMANCE: 'Performance-based', NEGOTIABLE: 'Negotiable', UNPAID: 'Unpaid (volunteering)',
};
const PAY_UNIT: Record<string, string> = { MONTHLY: 'per month', WEEKLY: 'per week', DAILY: 'per day', HOURLY: 'per hour', PER_PROJECT: 'per project', COMMISSION: 'commission', PIECE_RATE: 'per piece', PERFORMANCE: 'performance-based' };
export const WORKPLACE_LABEL: Record<string, string> = {
  OFFICE: 'Office', HOME: 'At home', FACTORY: 'Factory', FARM: 'Farm', HEALTH_FACILITY: 'Hospital or clinic', CONSTRUCTION_SITE: 'Construction site',
  OUTDOOR: 'Outdoors', INDUSTRIAL_FACILITY: 'Industrial facility', VEHICLE: 'In a vehicle', SHIP: 'On a ship', AIRCRAFT: 'On an aircraft',
  LABORATORY: 'Laboratory', RETAIL_SHOP: 'Shop or store', MULTIPLE_SITES: 'Several locations', FULLY_REMOTE: 'Fully remote',
};
export const RECRUITMENT_LABEL: Record<string, string> = {
  OPEN: 'Open recruitment', INTERNAL: 'Internal (current staff)', REFERRAL: 'By referral', DIRECT: 'Direct hiring', COMPETITIVE: 'Competitive (assessments)',
  MASS: 'Mass recruitment', EMERGENCY: 'Emergency hiring', SEASONAL: 'Seasonal hiring', CAMPUS: 'Campus recruitment', AGENCY: 'Through an agency',
};
export const BENEFIT_LABEL: Record<string, string> = {
  ACCOMMODATION: 'Accommodation', TRANSPORT: 'Transport allowance', FOOD: 'Food allowance', HEALTH_INSURANCE: 'Health insurance', PENSION: 'Pension',
  PAID_LEAVE: 'Paid leave', TRAINING: 'Training', RELOCATION: 'Relocation help', OVERTIME_PAY: 'Overtime pay', BONUS: 'Bonuses',
};
/** The four ways to browse the whole market; the server works out which jobs belong to each (apps/api jobs/segments.ts). */
export const SEGMENT_LABEL: Record<string, string> = {
  formal: 'Formal (government, NGO, company)',
  informal: 'Informal (household, farm, daily work)',
  flexible: 'Temporary and flexible',
  self_employment: 'Self-employment and services',
};
export const MODE_LABEL: Record<string, string> = { ON_SITE: 'On-site', REMOTE: 'Remote', HYBRID: 'Hybrid' };
export const EDU_LABEL: Record<string, string> = {
  NONE: 'No formal education', PRIMARY: 'Primary', SECONDARY: 'Secondary', VOCATIONAL_CERTIFICATE: 'Vocational certificate',
  DIPLOMA: 'Diploma', BACHELOR: "Bachelor's degree", MASTER: "Master's degree", DOCTORATE: 'Doctorate',
};

const nf = new Intl.NumberFormat('en-US');

/**
 * The pay of a job. With a basis it says what the amount is per ("5,000 ETB per day"); without one (older jobs, or a worker's
 * monthly expectation) it is shown as before. Negotiable and unpaid work show their words even when an amount is also stored.
 */
export function formatSalary(min: number | null, max: number | null, currency = 'ETB', basis?: string | null): string | null {
  if (basis === 'UNPAID') return 'Unpaid (volunteering)';
  const unit = basis && PAY_UNIT[basis] ? ` ${PAY_UNIT[basis]}` : '';
  if (min === null && max === null) return basis === 'NEGOTIABLE' ? 'Negotiable' : null;
  const tail = `${currency}${unit}${basis === 'NEGOTIABLE' ? ' (negotiable)' : ''}`;
  if (min !== null && max !== null) return min === max ? `${nf.format(min)} ${tail}` : `${nf.format(min)} – ${nf.format(max)} ${tail}`;
  return min !== null ? `From ${nf.format(min)} ${tail}` : `Up to ${nf.format(max!)} ${tail}`;
}

export function formatPlace(path: { name: string }[], remote = false): string {
  if (!path.length) return remote ? 'Remote' : 'Location not specified';
  // Most specific first, then the region: "Adama, Oromia"
  const [region, ...rest] = path.map((p) => p.name);
  return rest.length ? `${rest[rest.length - 1]}, ${region}` : region;
}

export function deadlineText(deadline: string | null): { text: string; urgent: boolean } {
  if (!deadline) return { text: 'Open until filled', urgent: false };
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: 'Closed', urgent: true };
  if (days === 0) return { text: 'Closes today', urgent: true };
  if (days <= 7) return { text: `${days} day${days === 1 ? '' : 's'} left`, urgent: true };
  return { text: `Closes ${new Date(deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, urgent: false };
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString('en-GB');
}
