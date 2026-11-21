import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, conflict, notFound } from '../../lib/errors';
import { trustOf } from '../workers/trust';
import { getPolicy, type Policy } from './service';
import { orgIdFor } from '../jobs/service';

/**
 * The recruitment METHODS an organization type follows, as steps recorded for each candidate before a hiring decision.
 * Which steps a type must do (required) or should do (suggested) is in its HiringPolicy and is edited by administrators. The
 * system records and checks that the steps were done; it cannot judge how well they were done, and the contents are the
 * employer's own record. The defaults are the developer's, not legal advice (see prisma/seed/policies.ts).
 */
export const STEP_KEYS = ['ID_VERIFIED', 'WRITTEN_EXAM', 'PRACTICAL_TEST', 'SCORE_SHEET', 'REFERENCE_CHECKED', 'GUARANTOR_RECORDED'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_INFO: Record<StepKey, { label: string; help: string }> = {
  ID_VERIFIED: { label: 'Identity checked', help: "The candidate's ID document was approved by an administrator on this platform. Nothing to record: it is read automatically." },
  WRITTEN_EXAM: { label: 'Written exam', help: 'Record the exam score the candidate got (out of 100).' },
  PRACTICAL_TEST: { label: 'Practical skills test', help: 'Record the result of a hands-on test of the work itself (a trade task, driving test, typing or cooking demonstration), out of 100.' },
  SCORE_SHEET: { label: 'Selection panel score sheet', help: 'Each panel member records their scores for the candidate. The type may require several different members.' },
  REFERENCE_CHECKED: { label: 'Reference checked', help: 'Record that you contacted a referee (a past employer or other reference) and what they said.' },
  GUARANTOR_RECORDED: { label: 'Guarantor recorded', help: "Record the person who stands as guarantor, and that you saw their ID. Do not store their phone number or address here." },
};
export const isStepKey = (v: string): v is StepKey => (STEP_KEYS as readonly string[]).includes(v);

// ───────── what an employer records ─────────

const person = z.string().trim().min(2, 'Enter at least 2 letters').max(60).regex(/^[\p{L}\p{M}'’.\- ]+$/u, 'Use letters only');
const note = z.string().trim().max(200).transform((v) => v || null).nullable().optional();
const today = () => new Date().toISOString().slice(0, 10);

export const stepInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('WRITTEN_EXAM'), score: z.number().min(0).max(100), examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').refine((d) => d <= today(), 'The exam date cannot be in the future'), note }).strict(),
  z.object({ kind: z.literal('PRACTICAL_TEST'), score: z.number().min(0).max(100), testDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').refine((d) => d <= today(), 'The test date cannot be in the future'), task: z.string().trim().min(2, 'Say what the candidate was asked to do').max(80), note }).strict(),
  z.object({
    kind: z.literal('SCORE_SHEET'), panelist: person,
    scores: z.object({ skills: z.number().int().min(1).max(5), experience: z.number().int().min(1).max(5), communication: z.number().int().min(1).max(5), suitability: z.number().int().min(1).max(5) }).strict(),
    note,
  }).strict(),
  z.object({ kind: z.literal('REFERENCE_CHECKED'), referee: person, outcome: z.enum(['POSITIVE', 'CONCERNS']), note }).strict(),
  z.object({ kind: z.literal('GUARANTOR_RECORDED'), guarantor: person, relationship: z.string().trim().min(2).max(40), idSeen: z.literal(true, { errorMap: () => ({ message: 'Check the guarantor\'s ID before recording them' }) }) }).strict(),
]);
export type StepInput = z.infer<typeof stepInputSchema>;

// ───────── status ─────────

export interface StepStatus { key: StepKey; label: string; help: string; required: boolean; suggested: boolean; done: boolean; detail: string }

/** Which steps are done for one application, against the organization type's policy. */
export function stepStatuses(p: Pick<Policy, 'requiredSteps' | 'suggestedSteps' | 'panelSize'>, recorded: { kind: string; data: Prisma.JsonValue }[], identityVerified: boolean): StepStatus[] {
  const of = (k: string) => recorded.filter((r) => r.kind === k);
  const panelists = new Set(of('SCORE_SHEET').map((r) => String((r.data as { panelist?: string }).panelist ?? '').trim().toLowerCase()).filter(Boolean));
  const needPanel = Math.max(1, p.panelSize);
  const rows: Record<StepKey, { done: boolean; detail: string }> = {
    ID_VERIFIED: { done: identityVerified, detail: identityVerified ? 'ID approved' : 'ID not verified yet' },
    WRITTEN_EXAM: { done: of('WRITTEN_EXAM').length > 0, detail: of('WRITTEN_EXAM').length ? `${(of('WRITTEN_EXAM')[0].data as { score: number }).score}/100` : 'not recorded' },
    PRACTICAL_TEST: { done: of('PRACTICAL_TEST').length > 0, detail: of('PRACTICAL_TEST').length ? `${(of('PRACTICAL_TEST')[0].data as { score: number }).score}/100` : 'not recorded' },
    SCORE_SHEET: { done: panelists.size >= needPanel, detail: `${panelists.size} of ${needPanel} panel member${needPanel === 1 ? '' : 's'}` },
    REFERENCE_CHECKED: { done: of('REFERENCE_CHECKED').length > 0, detail: of('REFERENCE_CHECKED').length ? `${of('REFERENCE_CHECKED').length} recorded` : 'not recorded' },
    GUARANTOR_RECORDED: { done: of('GUARANTOR_RECORDED').length > 0, detail: of('GUARANTOR_RECORDED').length ? 'recorded' : 'not recorded' },
  };
  const required = new Set(p.requiredSteps);
  const suggested = new Set(p.suggestedSteps);
  return STEP_KEYS.filter((k) => required.has(k) || suggested.has(k)).map((k) => ({ key: k, ...STEP_INFO[k], required: required.has(k), suggested: !required.has(k) && suggested.has(k), ...rows[k] }));
}

// ───────── employer actions ─────────

async function ownedApplication(userId: string, applicationId: string) {
  const orgId = await orgIdFor(userId);
  const app = await prisma.application.findFirst({
    where: { id: applicationId, job: { organizationId: orgId } },
    select: { id: true, status: true, workerId: true, job: { select: { organization: { select: { type: true } } } } },
  });
  if (!app) throw notFound('Application not found');
  return app;
}

export async function hiringView(userId: string, applicationId: string) {
  const app = await ownedApplication(userId, applicationId);
  const [policy, recorded, trust] = await Promise.all([
    getPolicy(app.job.organization.type),
    prisma.hiringStep.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } }),
    trustOf(app.workerId),
  ]);
  return {
    open: !['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(app.status),
    panelSize: policy.panelSize,
    steps: stepStatuses(policy, recorded, trust.proven.identity),
    recorded: recorded.map((r) => ({ id: r.id, kind: r.kind, data: r.data, createdAt: r.createdAt })),
  };
}

export async function recordStep(userId: string, applicationId: string, input: StepInput) {
  const app = await ownedApplication(userId, applicationId);
  if (['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(app.status)) throw conflict('This application is already decided. Steps are recorded before the decision.');
  const { kind, ...data } = input;
  // A step the type does not ask for is allowed (good practice), but the same panel member cannot score a candidate twice.
  if (kind === 'SCORE_SHEET') {
    const name = (data as { panelist: string }).panelist.trim().toLowerCase();
    const prior = await prisma.hiringStep.findMany({ where: { applicationId, kind: 'SCORE_SHEET' }, select: { data: true } });
    if (prior.some((r) => String((r.data as { panelist?: string }).panelist ?? '').trim().toLowerCase() === name)) throw conflict('This panel member already scored this candidate. Delete the earlier score sheet to change it.');
  }
  if ((kind === 'WRITTEN_EXAM' || kind === 'PRACTICAL_TEST') && (await prisma.hiringStep.count({ where: { applicationId, kind } }))) throw conflict('A result is already recorded. Delete it first to enter a different one.');
  const row = await prisma.hiringStep.create({ data: { applicationId, kind, data: data as Prisma.InputJsonValue, recordedById: userId } });
  return { id: row.id, kind: row.kind };
}

export async function deleteStep(userId: string, applicationId: string, stepId: string) {
  const app = await ownedApplication(userId, applicationId);
  if (['ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(app.status)) throw conflict('This application is already decided, so its record cannot be changed.');
  const { count } = await prisma.hiringStep.deleteMany({ where: { id: stepId, applicationId } });
  if (!count) throw notFound('Step not found');
}

/** Used by the hiring decision: the required steps still missing for this candidate. Throws STEPS_REQUIRED when there are any. */
export async function assertRequiredSteps(p: Policy, applicationId: string, workerId: string) {
  if (!p.requiredSteps.length) return;
  const [recorded, trust] = await Promise.all([prisma.hiringStep.findMany({ where: { applicationId } }), trustOf(workerId)]);
  const missing = stepStatuses(p, recorded, trust.proven.identity).filter((s) => s.required && !s.done);
  if (missing.length) {
    throw new AppError(409, 'STEPS_REQUIRED', `Your organization type requires these steps before a candidate is accepted: ${missing.map((m) => `${m.label} (${m.detail})`).join('; ')}.`, { missing: missing.map((m) => m.label) });
  }
}
