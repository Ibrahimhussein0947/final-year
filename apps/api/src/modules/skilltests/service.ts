import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound, tooMany } from '../../lib/errors';
import { workerIdFor } from '../workers/service';

/**
 * Short multiple-choice skill tests. A pass puts a "Tested" mark on that skill of the worker's profile.
 * It shows what the worker could answer on the day. It is NOT verification (no administrator looked at a document), it is
 * not used in the match score or the trust level, and a worker with no test is never ranked lower.
 *
 * Fair and safe by design: the server picks and orders the questions, the answers never reach the browser, the order of the
 * options is shuffled for each attempt, the time is limited, and attempts per day are limited.
 */
export const ATTEMPTS_PER_DAY = 3;
export const TIME_LIMIT_MIN = 30;
export const RETEST_AFTER_DAYS = 90;
const GRACE_MS = 60_000;
const DAY = 86_400_000;

// ───────── questions (what an administrator writes) ─────────

export const questionSchema = z.object({
  id: z.string().trim().min(1).max(20),
  text: z.string().trim().min(5).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(5),
  answer: z.number().int().min(0),
}).strict().refine((q) => q.answer < q.options.length, { path: ['answer'], message: 'The answer must be the number of one of the options' })
  .refine((q) => new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length, { path: ['options'], message: 'Two options are the same' });
export type Question = z.infer<typeof questionSchema>;

const poolSchema = z.array(questionSchema).min(4).max(100).refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, 'Question ids must be different');

export const testSchema = z.object({
  skillId: z.string().uuid(),
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().max(300).nullable().optional(),
  passPercent: z.number().int().min(1).max(100).default(70),
  questionsAsked: z.number().int().min(3).max(30).default(8),
  isActive: z.boolean().default(true),
  questions: poolSchema,
}).strict().refine((t) => t.questions.length >= t.questionsAsked, { path: ['questions'], message: 'The pool must have at least as many questions as are asked' });
export const testUpdateSchema = z.object({
  title: z.string().trim().min(3).max(100).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  passPercent: z.number().int().min(1).max(100).optional(),
  questionsAsked: z.number().int().min(3).max(30).optional(),
  isActive: z.boolean().optional(),
  questions: poolSchema.optional(),
}).strict();

const asPool = (v: Prisma.JsonValue) => v as unknown as Question[];

// ───────── pure helpers ─────────

/** Fisher-Yates with a cryptographic source, so the order cannot be predicted. */
export function shuffled<T>(items: readonly T[], rand: (n: number) => number = randomInt): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** What was picked for one attempt: the question id and the order its options are shown in (indices into the stored options). */
export interface Picked { id: string; order: number[] }

export function pick(pool: readonly Question[], count: number, rand?: (n: number) => number): Picked[] {
  return shuffled(pool, rand).slice(0, count).map((q) => ({ id: q.id, order: shuffled(q.options.map((_, i) => i), rand) }));
}

/** Grade shown positions: answers[i] is the position (0-based) the person chose for the i-th question, or null for skipped. */
export function grade(pool: readonly Question[], picked: readonly Picked[], answers: readonly (number | null)[]) {
  const byId = new Map(pool.map((q) => [q.id, q]));
  let correct = 0;
  picked.forEach((p, i) => {
    const q = byId.get(p.id);
    const chosen = answers[i];
    if (q && chosen !== null && chosen !== undefined && p.order[chosen] === q.answer) correct++;
  });
  return { correct, total: picked.length, percent: picked.length ? Math.round((correct / picked.length) * 100) : 0 };
}

// ───────── worker ─────────

export async function listTestsForWorker(userId: string) {
  const workerId = await workerIdFor(userId);
  const since = new Date(Date.now() - DAY);
  const [tests, mine, attempts] = await Promise.all([
    prisma.skillTest.findMany({ where: { isActive: true }, include: { skill: { select: { nameEn: true } } }, orderBy: { title: 'asc' } }),
    prisma.workerSkill.findMany({ where: { workerId }, select: { skillId: true, testedScore: true, testedAt: true } }),
    prisma.skillTestAttempt.findMany({ where: { workerId, startedAt: { gte: since } }, select: { testId: true } }),
  ]);
  const have = new Map(mine.map((m) => [m.skillId, m]));
  const used = (id: string) => attempts.filter((a) => a.testId === id).length;
  return tests.map((t) => {
    const ws = have.get(t.skillId);
    const fresh = ws?.testedAt && Date.now() - ws.testedAt.getTime() < RETEST_AFTER_DAYS * DAY;
    const reason = !ws ? 'Add this skill to your profile first.' : fresh ? 'You already passed. You can take it again after 90 days.' : used(t.id) >= ATTEMPTS_PER_DAY ? 'You used all attempts for today. Try again tomorrow.' : null;
    return {
      id: t.id, title: t.title, description: t.description, skill: { id: t.skillId, name: t.skill.nameEn }, questionsAsked: t.questionsAsked,
      passPercent: t.passPercent, timeLimitMinutes: TIME_LIMIT_MIN, hasSkill: !!ws,
      tested: ws?.testedAt ? { score: ws.testedScore, at: ws.testedAt } : null,
      attemptsLeftToday: Math.max(0, ATTEMPTS_PER_DAY - used(t.id)), canTake: reason === null, reason,
    };
  });
}

const served = (pool: Question[], picked: Picked[]) => {
  const byId = new Map(pool.map((q) => [q.id, q]));
  return picked.map((p, i) => { const q = byId.get(p.id)!; return { n: i + 1, text: q.text, options: p.order.map((idx) => q.options[idx]) }; });
};

export async function startTest(userId: string, testId: string) {
  const workerId = await workerIdFor(userId);
  const test = await prisma.skillTest.findFirst({ where: { id: testId, isActive: true } });
  if (!test) throw notFound('Test not found');
  const ws = await prisma.workerSkill.findUnique({ where: { workerId_skillId: { workerId, skillId: test.skillId } } });
  if (!ws) throw conflict('Add this skill to your profile before you take its test.');
  if (ws.testedAt && Date.now() - ws.testedAt.getTime() < RETEST_AFTER_DAYS * DAY) throw conflict('You already passed this test. You can take it again after 90 days.');
  const pool = asPool(test.questions);

  // A test already started and not yet finished is continued, not restarted, so closing the page does not cost an attempt.
  const open = await prisma.skillTestAttempt.findFirst({ where: { testId, workerId, finishedAt: null, startedAt: { gte: new Date(Date.now() - TIME_LIMIT_MIN * 60_000) } }, orderBy: { startedAt: 'desc' } });
  if (open) return view(open.id, test.title, open.startedAt, served(pool, open.picked as unknown as Picked[]));

  const used = await prisma.skillTestAttempt.count({ where: { workerId, testId, startedAt: { gte: new Date(Date.now() - DAY) } } });
  if (used >= ATTEMPTS_PER_DAY) throw tooMany('You used all attempts for today. Try again tomorrow.');
  const picked = pick(pool, Math.min(test.questionsAsked, pool.length));
  const attempt = await prisma.skillTestAttempt.create({ data: { testId, workerId, picked: picked as unknown as Prisma.InputJsonValue } });
  return view(attempt.id, test.title, attempt.startedAt, served(pool, picked));
}

const view = (attemptId: string, title: string, startedAt: Date, questions: ReturnType<typeof served>) => ({
  attemptId, title, startedAt, expiresAt: new Date(startedAt.getTime() + TIME_LIMIT_MIN * 60_000), questions,
});

export const submitSchema = z.object({ answers: z.array(z.number().int().min(0).max(4).nullable()).min(1).max(30) }).strict();

export async function submitTest(userId: string, attemptId: string, answers: (number | null)[]) {
  const workerId = await workerIdFor(userId);
  const attempt = await prisma.skillTestAttempt.findFirst({ where: { id: attemptId, workerId }, include: { test: true } });
  if (!attempt) throw notFound('Attempt not found');
  if (attempt.finishedAt) throw conflict('This test was already handed in.');
  const picked = attempt.picked as unknown as Picked[];
  if (answers.length !== picked.length) throw badRequest('Answer every question, or leave it empty to skip it', { answers: [`Expected ${picked.length} answers`] });
  if (answers.some((a, i) => a !== null && a >= picked[i].order.length)) throw badRequest('One answer is not one of the choices');

  // Claim the attempt first, so handing in twice (or on two devices) is graded once.
  const late = Date.now() > attempt.startedAt.getTime() + TIME_LIMIT_MIN * 60_000 + GRACE_MS;
  const g = late ? { correct: 0, total: picked.length, percent: 0 } : grade(asPool(attempt.test.questions), picked, answers);
  const passed = !late && g.percent >= attempt.test.passPercent;
  const claimed = await prisma.skillTestAttempt.updateMany({ where: { id: attempt.id, finishedAt: null }, data: { finishedAt: new Date(), correct: g.correct, total: g.total, passed } });
  if (!claimed.count) throw conflict('This test was already handed in.');
  if (late) throw conflict(`The ${TIME_LIMIT_MIN} minutes ran out, so this attempt did not count. You can start again.`);
  if (passed) await prisma.workerSkill.updateMany({ where: { workerId, skillId: attempt.test.skillId }, data: { testedScore: g.percent, testedAt: new Date() } });
  const used = await prisma.skillTestAttempt.count({ where: { workerId, testId: attempt.testId, startedAt: { gte: new Date(Date.now() - DAY) } } });
  return { correct: g.correct, total: g.total, percent: g.percent, passed, passPercent: attempt.test.passPercent, attemptsLeftToday: Math.max(0, ATTEMPTS_PER_DAY - used) };
}

// ───────── administrator ─────────

const adminOut = (t: { id: string; skillId: string; title: string; description: string | null; passPercent: number; questionsAsked: number; isActive: boolean; questions: Prisma.JsonValue; skill: { nameEn: string } }) => ({
  id: t.id, skill: { id: t.skillId, name: t.skill.nameEn }, title: t.title, description: t.description, passPercent: t.passPercent, questionsAsked: t.questionsAsked, isActive: t.isActive, questions: asPool(t.questions),
});
const include = { skill: { select: { nameEn: true } } } as const;

export async function adminList() {
  return (await prisma.skillTest.findMany({ include, orderBy: { title: 'asc' } })).map(adminOut);
}
export async function adminCreate(input: z.infer<typeof testSchema>) {
  if (!(await prisma.skill.findFirst({ where: { id: input.skillId, isActive: true }, select: { id: true } }))) throw badRequest('Unknown skill', { skillId: ['Choose a skill from the list'] });
  if (await prisma.skillTest.findUnique({ where: { skillId: input.skillId }, select: { id: true } })) throw conflict('This skill already has a test. Edit it instead.');
  return adminOut(await prisma.skillTest.create({ data: { ...input, description: input.description ?? null, questions: input.questions as unknown as Prisma.InputJsonValue }, include }));
}
export async function adminUpdate(id: string, input: z.infer<typeof testUpdateSchema>) {
  const found = await prisma.skillTest.findUnique({ where: { id } });
  if (!found) throw notFound('Test not found');
  const pool = input.questions ?? asPool(found.questions);
  const asked = input.questionsAsked ?? found.questionsAsked;
  if (pool.length < asked) throw badRequest('The pool must have at least as many questions as are asked', { questions: [`${pool.length} questions, ${asked} asked`] });
  const { questions, ...rest } = input;
  return adminOut(await prisma.skillTest.update({ where: { id }, data: { ...rest, ...(questions ? { questions: questions as unknown as Prisma.InputJsonValue } : {}) }, include }));
}
export async function adminDelete(id: string) {
  const { count } = await prisma.skillTest.deleteMany({ where: { id } });
  if (!count) throw notFound('Test not found');
}
