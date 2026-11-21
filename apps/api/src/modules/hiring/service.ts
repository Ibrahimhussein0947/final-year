import type { OrganizationType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError, badRequest, notFound } from '../../lib/errors';
// Kept here, not imported from ./steps, which imports this file (a cycle would leave it undefined when the schema below is built).
const STEP_KEYS = ['ID_VERIFIED', 'WRITTEN_EXAM', 'PRACTICAL_TEST', 'SCORE_SHEET', 'REFERENCE_CHECKED', 'GUARANTOR_RECORDED'] as const;

/**
 * Hiring rules by organization type. How a vacancy may be announced and how a candidate may be selected depends on what
 * kind of organization is hiring: a government office follows formal recruitment rules, a private company decides
 * freely. The rules are rows in `HiringPolicy`, edited by administrators, and enforced here:
 *   - when a job is published or edited while live  (verification, closing date, minimum announcement period, pay, reference number)
 *   - when an application is accepted or rejected   (written reason, the announcement has closed, an interview took place)
 * The seeded values are starting defaults, not legal advice (see prisma/seed/policies.ts).
 */
export interface Policy {
  organizationType: OrganizationType;
  label: string | null;
  minAnnouncementDays: number;
  requireVerified: boolean;
  requireDeadline: boolean;
  requireSalary: boolean;
  requireReference: boolean;
  requireDecisionNote: boolean;
  requireInterview: boolean;
  /** The recruitment methods: steps recorded before a candidate can be accepted (required) or shown as good practice (suggested). */
  requiredSteps: string[];
  suggestedSteps: string[];
  panelSize: number;
  maxProbationDays: number | null;
  appealDays: number;
}

const FIELDS = ['label', 'minAnnouncementDays', 'requireVerified', 'requireDeadline', 'requireSalary', 'requireReference', 'requireDecisionNote', 'requireInterview', 'requiredSteps', 'suggestedSteps', 'panelSize', 'maxProbationDays', 'appealDays'] as const;

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Policy }>();
export const clearPolicyCache = () => cache.clear();

export const noRules = (organizationType: OrganizationType): Policy => ({
  organizationType, label: null, minAnnouncementDays: 0, requireVerified: false, requireDeadline: false, requireSalary: false, requireReference: false, requireDecisionNote: false, requireInterview: false,
  requiredSteps: [], suggestedSteps: [], panelSize: 1, maxProbationDays: null, appealDays: 0,
});

export async function getPolicy(type: OrganizationType): Promise<Policy> {
  const hit = cache.get(type);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const row = await prisma.hiringPolicy.findUnique({ where: { organizationType: type } });
  const value: Policy = row ? { organizationType: type, ...Object.fromEntries(FIELDS.map((f) => [f, row[f]])) } as Policy : noRules(type);
  cache.set(type, { at: Date.now(), value });
  return value;
}

/** Ethiopian calendar day is not used here: dates are shown as YYYY-MM-DD in Ethiopia time (UTC+3). */
const dayText = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

export interface JobState { deadline: Date | null; salaryMin: number | null; salaryMax: number | null; referenceNumber: string | null }

/**
 * Problems that stop a job going live (or being edited while live) under this organization type's rules.
 * `startsAt` is when the announcement period starts: now for a new publication, the original publication time for an edit.
 */
export function liveJobProblems(p: Policy, s: JobState, ctx: { startsAt: Date; verified: boolean; checkVerified: boolean }): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (k: string, m: string) => { (out[k] ??= []).push(m); };
  if (p.requireVerified && ctx.checkVerified && !ctx.verified) {
    add('organization', 'This type of organization must be verified before it can publish jobs. Upload your verification documents on the Organization page and wait for approval.');
  }
  if ((p.requireDeadline || p.minAnnouncementDays > 0) && !s.deadline) add('deadline', 'A closing date is required for this type of organization.');
  if (p.minAnnouncementDays > 0 && s.deadline) {
    const earliest = new Date(ctx.startsAt.getTime() + p.minAnnouncementDays * 86_400_000);
    if (s.deadline.getTime() < earliest.getTime()) add('deadline', `The vacancy must stay open for at least ${p.minAnnouncementDays} days. Choose a closing date on or after ${dayText(earliest)}.`);
  }
  if (p.requireSalary && s.salaryMin == null && s.salaryMax == null) add('salaryMin', 'State the salary or pay-scale range for this vacancy.');
  if (p.requireReference && !s.referenceNumber?.trim()) add('referenceNumber', 'A vacancy reference number is required for this type of organization.');
  return out;
}

export interface DecisionContext {
  applicationId: string;
  orgType: OrganizationType;
  job: { deadline: Date | null };
  to: 'ACCEPTED' | 'REJECTED';
  note: string | null;
}

/** Checks the hiring rules for accepting or rejecting a candidate. Throws a readable error when a rule is not met. */
export async function assertDecisionAllowed(c: DecisionContext) {
  const p = await getPolicy(c.orgType);
  if (p.requireDecisionNote && (c.note ?? '').trim().length < 10) {
    throw badRequest('A written reason is required', { note: [`Your organization type requires a written reason (at least 10 characters) when you ${c.to === 'ACCEPTED' ? 'accept' : 'reject'} a candidate.`] });
  }
  if (c.to !== 'ACCEPTED') return;
  if (p.minAnnouncementDays > 0) {
    if (!c.job.deadline || c.job.deadline.getTime() > Date.now()) {
      throw new AppError(409, 'ANNOUNCEMENT_OPEN', `Hiring decisions are made after the announcement closes${c.job.deadline ? ` (closing date ${dayText(c.job.deadline)})` : ''}. You can shortlist and interview in the meantime.`);
    }
  }
  if (p.requireInterview) {
    const held = await prisma.interview.count({ where: { applicationId: c.applicationId, status: { not: 'CANCELLED' } } });
    if (!held) throw new AppError(409, 'INTERVIEW_REQUIRED', 'Your organization type requires an interview to be recorded before a candidate is accepted. Schedule one first.');
  }
}

/** What the employer screens need to know to guide the user (not the enforcement itself). */
export const rulesView = (p: Policy, job: { deadline: Date | null }) => ({
  label: p.label,
  requireDecisionNote: p.requireDecisionNote,
  requireInterview: p.requireInterview,
  requiredSteps: p.requiredSteps,
  suggestedSteps: p.suggestedSteps,
  panelSize: p.panelSize,
  maxProbationDays: p.maxProbationDays,
  appealDays: p.appealDays,
  announcementClosesAt: p.minAnnouncementDays > 0 ? job.deadline : null,
});

// ───────── administrator management ─────────

export const policyUpdateSchema = z
  .object({
    label: z.string().trim().max(60).transform((v) => v || null).nullable().optional(),
    minAnnouncementDays: z.number().int().min(0).max(90).optional(),
    requireVerified: z.boolean().optional(),
    requireDeadline: z.boolean().optional(),
    requireSalary: z.boolean().optional(),
    requireReference: z.boolean().optional(),
    requireDecisionNote: z.boolean().optional(),
    requireInterview: z.boolean().optional(),
    requiredSteps: z.array(z.enum(STEP_KEYS)).max(STEP_KEYS.length).optional(),
    suggestedSteps: z.array(z.enum(STEP_KEYS)).max(STEP_KEYS.length).optional(),
    panelSize: z.number().int().min(1).max(9).optional(),
    maxProbationDays: z.number().int().min(0).max(365).nullable().optional(),
    appealDays: z.number().int().min(0).max(60).optional(),
  })
  .strict();

export const ORGANIZATION_TYPES = [
  'PRIVATE_COMPANY', 'PUBLIC_ENTERPRISE', 'GOVERNMENT', 'NGO', 'SME', 'CONSTRUCTION', 'FACTORY', 'HOTEL_RESTAURANT',
  'AGRICULTURAL', 'HOUSEHOLD', 'INDIVIDUAL', 'RECRUITMENT_AGENCY', 'TRAINING_INSTITUTION', 'COOPERATIVE',
] as const satisfies readonly OrganizationType[];

export async function listPolicies() {
  const [rows, counts] = await Promise.all([
    prisma.hiringPolicy.findMany(),
    prisma.organization.groupBy({ by: ['type'], _count: true }),
  ]);
  const byType = new Map(rows.map((r) => [r.organizationType, r]));
  const orgs = new Map(counts.map((c) => [c.type, c._count]));
  return ORGANIZATION_TYPES.map((t) => {
    const r = byType.get(t);
    const p = r ? ({ organizationType: t, ...Object.fromEntries(FIELDS.map((f) => [f, r[f]])) } as Policy) : noRules(t);
    return { ...p, organizations: orgs.get(t) ?? 0, updatedAt: r?.updatedAt ?? null };
  });
}

export async function updatePolicy(type: string, input: z.infer<typeof policyUpdateSchema>, adminId: string) {
  if (!(ORGANIZATION_TYPES as readonly string[]).includes(type)) throw notFound('Unknown organization type');
  const t = type as OrganizationType;
  // A step cannot be both required and merely suggested: required wins.
  const clean = { ...input, ...(input.requiredSteps && input.suggestedSteps ? { suggestedSteps: input.suggestedSteps.filter((s) => !input.requiredSteps!.includes(s)) } : {}) };
  await prisma.hiringPolicy.upsert({
    where: { organizationType: t },
    update: { ...clean, updatedById: adminId },
    create: { organizationType: t, ...clean, updatedById: adminId },
  });
  clearPolicyCache();
}
