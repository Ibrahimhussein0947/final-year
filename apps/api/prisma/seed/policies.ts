/**
 * Starting hiring rules per organization type. These are REASONED DEFAULTS written by the developer, NOT legal advice
 * and NOT checked against Ethiopian public-service or labour regulations. The numbers (for example the minimum
 * announcement period) must be confirmed by a legal adviser and the relevant authorities before launch; administrators
 * can change every value in the admin console ("Hiring rules"). Existing rows are never overwritten by the seed.
 */
export interface SeedPolicy {
  label: string | null;
  minAnnouncementDays: number;
  requireVerified: boolean;
  requireDeadline: boolean;
  requireSalary: boolean;
  requireReference: boolean;
  requireDecisionNote: boolean;
  requireInterview: boolean;
}

const none: SeedPolicy = { label: null, minAnnouncementDays: 0, requireVerified: false, requireDeadline: false, requireSalary: false, requireReference: false, requireDecisionNote: false, requireInterview: false };

/** Formal, competitive recruitment: announced for a fixed period, transparent pay, documented selection. */
const formal = (label: string, days: number): SeedPolicy => ({
  label, minAnnouncementDays: days, requireVerified: true, requireDeadline: true, requireSalary: true, requireReference: true, requireDecisionNote: true, requireInterview: true,
});

export const hiringPolicies: Record<string, SeedPolicy> = {
  GOVERNMENT: formal('Government vacancy', 10),
  PUBLIC_ENTERPRISE: formal('Public enterprise vacancy', 7),
  // Donor-funded organizations document selection; pay is often "as per scale", so it is not forced.
  NGO: { label: 'NGO vacancy', minAnnouncementDays: 7, requireVerified: true, requireDeadline: true, requireSalary: false, requireReference: false, requireDecisionNote: true, requireInterview: true },
  // Agencies post on behalf of others, so they must be verified and state a closing date.
  RECRUITMENT_AGENCY: { ...none, label: 'Recruitment agency', requireVerified: true, requireDeadline: true },
  TRAINING_INSTITUTION: { ...none, requireVerified: true, requireDeadline: true },
  // Everyone else decides freely: no extra rules.
  PRIVATE_COMPANY: none,
  SME: none,
  CONSTRUCTION: none,
  FACTORY: none,
  HOTEL_RESTAURANT: none,
  AGRICULTURAL: none,
  HOUSEHOLD: none,
  INDIVIDUAL: none,
  COOPERATIVE: none,
};
