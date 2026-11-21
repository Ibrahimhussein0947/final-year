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
  /** Recruitment methods: steps recorded before accepting a candidate (required) or shown as good practice (suggested). */
  requiredSteps: string[];
  suggestedSteps: string[];
  panelSize: number;
  maxProbationDays: number | null;
  appealDays: number;
}

const none: SeedPolicy = { label: null, minAnnouncementDays: 0, requireVerified: false, requireDeadline: false, requireSalary: false, requireReference: false, requireDecisionNote: false, requireInterview: false, requiredSteps: [], suggestedSteps: [], panelSize: 1, maxProbationDays: null, appealDays: 0 };

/** Formal, competitive recruitment: announced for a fixed period, transparent pay, documented selection. */
const formal = (label: string, days: number): SeedPolicy => ({
  label, minAnnouncementDays: days, requireVerified: true, requireDeadline: true, requireSalary: true, requireReference: true, requireDecisionNote: true, requireInterview: true,
  requiredSteps: ['ID_VERIFIED', 'WRITTEN_EXAM', 'SCORE_SHEET'], suggestedSteps: ['REFERENCE_CHECKED'], panelSize: 2, maxProbationDays: 45, appealDays: 7,
});

const business: SeedPolicy = { ...none, suggestedSteps: ['ID_VERIFIED', 'REFERENCE_CHECKED'], maxProbationDays: 45 };
const personal: SeedPolicy = { ...none, suggestedSteps: ['ID_VERIFIED', 'GUARANTOR_RECORDED', 'REFERENCE_CHECKED'] };

export const hiringPolicies: Record<string, SeedPolicy> = {
  // A selection committee of three, and no probation limit set (civil-service rules differ from the labour law): confirm both with a legal adviser.
  GOVERNMENT: { ...formal('Government vacancy', 10), panelSize: 3, maxProbationDays: null },
  PUBLIC_ENTERPRISE: formal('Public enterprise vacancy', 7),
  // Donor-funded organizations document selection; pay is often "as per scale", so it is not forced.
  NGO: { label: 'NGO vacancy', minAnnouncementDays: 7, requireVerified: true, requireDeadline: true, requireSalary: false, requireReference: false, requireDecisionNote: true, requireInterview: true, requiredSteps: ['ID_VERIFIED', 'SCORE_SHEET', 'REFERENCE_CHECKED'], suggestedSteps: ['WRITTEN_EXAM'], panelSize: 2, maxProbationDays: 45, appealDays: 0 },
  // Agencies post on behalf of others, so they must be verified and state a closing date.
  // An agency places other people, so it must know who they are.
  RECRUITMENT_AGENCY: { ...none, label: 'Recruitment agency', requireVerified: true, requireDeadline: true, requiredSteps: ['ID_VERIFIED'], suggestedSteps: ['REFERENCE_CHECKED'] },
  TRAINING_INSTITUTION: { ...none, requireVerified: true, requireDeadline: true, suggestedSteps: ['ID_VERIFIED', 'SCORE_SHEET', 'REFERENCE_CHECKED'], maxProbationDays: 45 },
  // Everyone else decides freely: no extra rules.
  // Private employers decide freely, but are shown good practice; the probation limit follows the general labour law (45 days): confirm it.
  PRIVATE_COMPANY: business,
  SME: business,
  CONSTRUCTION: business,
  FACTORY: business,
  HOTEL_RESTAURANT: business,
  AGRICULTURAL: business,
  COOPERATIVE: business,
  // A person or family hiring help: a guarantor and references are common practice. No probation limit is set for domestic work.
  HOUSEHOLD: personal,
  INDIVIDUAL: personal,
};
