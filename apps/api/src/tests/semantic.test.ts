import { randomInt, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createHttpAiClient, setAiClient, type AiClient } from '../integrations/aiClient';
import { prisma } from '../lib/prisma';
import { cosine, semanticScore } from '../modules/matching/components';
import { isLikelyAfaanOromoo, isMostlyEthiopic, isUnsupportedForEmbedding, jobText, refreshJobEmbedding, refreshWorkerEmbedding, workerText } from '../modules/matching/embeddings';
import { matchPair } from '../modules/matching/scorer';
import { DEFAULT_WEIGHTS, type JobFeatures, type RelationMap, type WorkerFeatures } from '../modules/matching/types';

if (!/_test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Refusing to run tests: DATABASE_URL must point at a *_test database');
}

// NOTE: these tests use hand-made vectors, not a real language model. They prove the plumbing and the arithmetic
// (blending, gating, candidate recall, failure handling), NOT that real embeddings recognise synonyms. That is
// measured separately by apps/ai/evaluation/multilingual_probe.py once the model is installed.

const NOW = new Date('2026-06-01T00:00:00Z');
const unit = (cos: number): number[] => [cos, Math.sqrt(1 - cos * cos)]; // a vector at angle acos(cos) from [1, 0]
const REL: RelationMap = new Map();

const job = (over: Partial<JobFeatures> = {}): JobFeatures => ({
  id: 'j', categoryId: 'auto', employmentType: 'FULL_TIME', workMode: 'ON_SITE', minExperienceYears: null, requiredEducationLevel: null,
  salaryMin: null, salaryMax: null, startDate: null, lat: null, lng: null, locationPath: ['R'], embedding: [1, 0],
  skills: [{ skillId: 'engine', name: 'Engine Repair', importance: 'REQUIRED', minProficiency: null }, { skillId: 'brakes', name: 'Brake Systems', importance: 'REQUIRED', minProficiency: null }],
  ...over,
});
const worker = (over: Partial<WorkerFeatures> = {}): WorkerFeatures => ({
  id: 'w', categoryId: 'auto', yearsExperience: 3, experiences: [], educationLevels: [], certificationCount: 0,
  skills: [{ skillId: 'engine', name: 'Engine Repair', proficiency: 4 }], availability: 'IMMEDIATELY', availableFrom: null, lat: null, lng: null,
  maxTravelKm: null, willingToRelocate: false, locationPath: ['R'], preferredTypes: [], preferredWorkModes: [], expectedSalaryMin: null, expectedSalaryMax: null,
  embedding: unit(1), ...over,
});
const only = { skills: 1, experience: 0, location: 0, qualification: 0, availability: 0, preferences: 0, criteria: 0 };
const run = (j: JobFeatures, w: WorkerFeatures) => matchPair(j, w, only, REL, NOW);

describe('semantic similarity arithmetic', () => {
  it('computes cosine and handles degenerate vectors', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 0], [-1, 0])).toBe(-1);
    expect(cosine([1, 2], [1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it('calibrates raw cosine onto 0..1', () => {
    expect(semanticScore(0.1)).toBe(0);
    expect(semanticScore(0.25)).toBe(0);
    expect(semanticScore(0.475)).toBeCloseTo(0.5, 5);
    expect(semanticScore(0.7)).toBe(1);
    expect(semanticScore(0.95)).toBe(1);
  });
});

describe('blending semantic evidence into the skills component', () => {
  it('fills part of the gap left by the taxonomy, and never lowers a score', () => {
    const noSemantic = run(job(), worker({ embedding: null }));
    expect(noSemantic.components.skills.score).toBe(0.5); // engine exact, brakes missing: 1 of 2
    expect(noSemantic.semantic).toEqual({ similarity: null, score: null, lift: 0 });
    expect(noSemantic.engineVersion).toBe('rules-1.0');

    const similar = run(job(), worker({ embedding: unit(0.8) })); // calibrated semantic score 1
    expect(similar.components.skills.score).toBe(0.75); // 0.5 + 0.5 * (1 - 0.5) * 1
    expect(similar.semantic.lift).toBe(0.25);
    expect(similar.engineVersion).toBe('hybrid-1.0');
    expect(similar.components.skills.note).toContain('semantic similarity');

    const unrelatedText = run(job(), worker({ embedding: unit(0.1) })); // semantic score 0
    expect(unrelatedText.components.skills.score).toBe(0.5); // unchanged, not penalized
    expect(unrelatedText.components.skills.note).not.toContain('semantic');

    const perfectSkills = run(job(), worker({ skills: [{ skillId: 'engine', name: 'Engine Repair', proficiency: 4 }, { skillId: 'brakes', name: 'Brake Systems', proficiency: 4 }], embedding: unit(0) }));
    expect(perfectSkills.components.skills.score).toBe(1);
  });

  it('scales the lift with similarity', () => {
    const half = run(job(), worker({ embedding: unit(0.475) }));
    expect(half.components.skills.score).toBeCloseTo(0.5 + 0.5 * 0.5 * 0.5, 3);
  });

  it('uses profile wording alone, at half weight at most, when the worker lists no skills', () => {
    const r = run(job(), worker({ skills: [], embedding: unit(0.8) }));
    expect(r.components.skills.score).toBe(0.5);
    expect(r.components.skills.note).toContain('no skills listed');
    expect(r.notAssessed.find((n) => n.component === 'skills')).toBeUndefined();
    // without an embedding, the same worker stays "not assessed" rather than getting a score
    expect(run(job(), worker({ skills: [], embedding: null })).components.skills.score).toBeNull();
  });

  it('needs both embeddings to be present', () => {
    expect(run(job({ embedding: null }), worker()).semantic.similarity).toBeNull();
    expect(run(job(), worker({ embedding: null })).semantic.similarity).toBeNull();
  });
});

describe('required-skill gate with semantic relief', () => {
  const full = (j: JobFeatures, w: WorkerFeatures) => matchPair(j, w, DEFAULT_WEIGHTS, REL, NOW);
  const other = [{ skillId: 'cooking', name: 'Cooking', proficiency: 5 }];

  it('still caps the label when the text does not look like this work either', () => {
    const r = full(job(), worker({ skills: other, yearsExperience: 10, embedding: unit(0.2) }));
    expect(r.requiredCoverage.covered).toBe(0);
    expect(r.strength).toBe('partial');
    expect(r.explanation).toContain('None of the required skills are listed');
  });

  it('lifts the cap when the profile text clearly describes this kind of work', () => {
    const r = full(job(), worker({ skills: other, yearsExperience: 10, embedding: unit(0.8) }));
    expect(r.requiredCoverage.covered).toBe(0); // the facts are unchanged...
    expect(r.explanation).not.toContain('None of the required skills are listed'); // ...but the cap is not applied
  });
});

// ───────── The HTTP client ─────────

function server(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const calls: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ headers: req.headers, body });
      handler(req, body, res);
    });
  });
  return new Promise<{ url: string; calls: typeof calls; close: () => Promise<void> }>((resolve) =>
    srv.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, calls, close: () => new Promise((r) => srv.close(() => r())) }),
    ),
  );
}
const TOKEN = 't'.repeat(32);

describe('AI service client', () => {
  it('is disabled without configuration and never calls out', async () => {
    const c = createHttpAiClient(undefined, undefined);
    expect(c.enabled()).toBe(false);
    expect(await c.embed(['x'])).toBeNull();
  });

  it('sends the token and texts and returns vectors', async () => {
    const s = await server((_r, body, res) => {
      const { texts } = JSON.parse(body) as { texts: string[] };
      res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ model: 'm', dim: 2, embeddings: texts.map(() => [1, 0]) }));
    });
    const c = createHttpAiClient(s.url, TOKEN);
    const r = await c.embed(['a', 'b']);
    expect(r).toEqual({ model: 'm', vectors: [[1, 0], [1, 0]] });
    expect(s.calls[0].headers['x-service-token']).toBe(TOKEN);
    expect(JSON.parse(s.calls[0].body)).toEqual({ texts: ['a', 'b'] });
    await s.close();
  });

  it('returns null on errors and then stays quiet for a while instead of retrying every request', async () => {
    const s = await server((_r, _b, res) => void res.writeHead(500).end('boom'));
    const c = createHttpAiClient(s.url, TOKEN);
    expect(await c.embed(['a'])).toBeNull();
    expect(await c.embed(['a'])).toBeNull();
    expect(await c.embed(['a'])).toBeNull();
    expect(s.calls).toHaveLength(1); // cool-down: only the first call reached the server
    await s.close();
  });

  it('rejects malformed answers and times out slow ones', async () => {
    const bad = await server((_r, _b, res) => void res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ model: 'm', embeddings: [[1]] })));
    expect(await createHttpAiClient(bad.url, TOKEN).embed(['a', 'b'])).toBeNull(); // 2 texts, 1 vector
    await bad.close();

    const slow = await server(() => undefined); // never answers
    const t0 = Date.now();
    expect(await createHttpAiClient(slow.url, TOKEN).embed(['a'], { timeoutMs: 150 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
    await slow.close();
  });

  it('returns null when the service is down', async () => {
    expect(await createHttpAiClient('http://127.0.0.1:1', TOKEN).embed(['a'])).toBeNull();
  });
});

// ───────── Storing embeddings and recalling candidates ─────────

const app = createApp();
const phones: string[] = [];
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => `zq${randomUUID().slice(0, 8)}`;
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let autoId = '';
let cookId = '';
let skill: Record<string, string> = {};
const noAi: AiClient = { enabled: () => false, embed: async () => null };

async function signUp(role: 'WORKER' | 'EMPLOYER') {
  const p = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`.slice(0, 10);
  phones.push(`+251${p.slice(1)}`);
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Test ${role}`, phone: p, password: 'Passw0rdTest', role, region: 'Oromia', zone: 'Adama', language: 'en',
    ...(role === 'EMPLOYER' ? { organizationName: `TEST_ORG Sem ${tag()}`, organizationType: 'SME' } : {}),
  });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}
async function liveJob(e: { token: string }, skills: string[], over: Record<string, unknown> = {}) {
  const create = await request(app).post('/api/v1/jobs').set(auth(e.token)).send({
    title: `Semantic job ${tag()}`, description: `Repair vehicles. ${randomUUID()} ${randomUUID()} Please apply with your experience and references.`,
    categoryId: autoId, employmentType: 'FULL_TIME', deadline: future(30), minExperienceYears: 2,
    locationId: (await prisma.location.findFirstOrThrow({ where: { nameEn: 'Adama', level: 'ZONE' } })).id,
    skills: skills.map((s) => ({ skillId: skill[s], importance: 'REQUIRED' })), ...over,
  });
  expect(create.status, JSON.stringify(create.body)).toBe(201);
  const id = create.body.job.id as string;
  expect((await request(app).post(`/api/v1/jobs/${id}/publish`).set(auth(e.token)).send({})).status).toBe(200);
  return id;
}

beforeAll(async () => {
  autoId = (await prisma.category.findFirstOrThrow({ where: { slug: 'automotive' } })).id;
  cookId = (await prisma.category.findFirstOrThrow({ where: { slug: 'hospitality' } })).id;
  const rows = await prisma.skill.findMany({ where: { slug: { in: ['engine-repair', 'brake-systems', 'cooking'] } } });
  skill = Object.fromEntries(rows.map((s) => [s.slug, s.id]));
});
afterEach(() => setAiClient(noAi));
afterAll(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({ where: { organization: { name: { startsWith: 'TEST_ORG' } } } });
  await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: 'TEST_ORG' } } });
  await prisma.$disconnect();
});

describe('text sent to the embedding model', () => {
  it('puts the most informative parts first and clips long text', () => {
    expect(workerText({ headline: 'Vehicle repair specialist', occupation: 'Mechanic', bio: 'Ten years.', skills: ['Engine Repair', 'Welding'] }))
      .toBe('Vehicle repair specialist. Mechanic. Skills: Engine Repair, Welding. Ten years.');
    expect(workerText({ headline: null, occupation: null, bio: null, skills: [] })).toBe('');
    expect(jobText({ title: 'Mechanic', description: 'Fix cars.', skills: [{ name: 'Welding', required: false }, { name: 'Engine Repair', required: true }] }))
      .toBe('Mechanic. Skills: Engine Repair, Welding. Fix cars.');
    expect(jobText({ title: 'T', description: 'x'.repeat(5000), skills: [] }).length).toBe(1500);
  });
});

describe('keeping embeddings up to date', () => {
  const fake = (calls: string[][]): AiClient => ({ enabled: () => true, embed: async (texts) => { calls.push(texts); return { model: 'fake-model', vectors: texts.map(() => [1, 0, 0, 0]) }; } });

  it('stores the vector and model name for a job and a worker', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, ['engine-repair']);
    const w = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ headline: 'Vehicle repair specialist', categoryId: autoId });
    const workerId = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } })).id;

    const calls: string[][] = [];
    setAiClient(fake(calls));
    expect(await refreshJobEmbedding(jobId)).toBe(true);
    expect(await refreshWorkerEmbedding(workerId)).toBe(true);
    expect(calls[0][0]).toContain('Skills: Engine Repair');
    expect(calls[1][0]).toContain('Vehicle repair specialist');
    expect(await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { embedding: true, embeddingModel: true } })).toEqual({ embedding: [1, 0, 0, 0], embeddingModel: 'fake-model' });
    expect((await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId } })).embeddingModel).toBe('fake-model');
  });

  it('does not embed Amharic text (the model was measured as unreliable for it) but still embeds English', async () => {
    expect(isMostlyEthiopic('የተሽከርካሪ ጥገና ባለሙያ', null, 'ከአስር ዓመት በላይ ልምድ አለኝ')).toBe(true);
    // Afaan Oromoo is in Latin letters: recognised from very common words, so it is also kept out of the embedding
    const oromoo = "Ani hojjetaa konkolaataa dha. Waggaa kudhan hojii suphaa makiinaa keessa hojjedha, fi barnoota koo xumureera.";
    expect(isLikelyAfaanOromoo('Konkolaachisaa', null, oromoo)).toBe(true);
    expect(isUnsupportedForEmbedding(null, null, oromoo)).toBe(true);
    expect(isLikelyAfaanOromoo('Vehicle repair specialist', null, 'Ten years fixing trucks and buses in a busy garage, with engine and brake work.')).toBe(false);
    expect(isLikelyAfaanOromoo('Hojjetaa dibaa manaa')).toBe(false); // a short title alone is not enough to say
    expect(isLikelyAfaanOromoo('Engine repair', null, 'I work in Adama and also speak Afaan Oromoo and Amharic with customers.')).toBe(false);
    expect(isMostlyEthiopic('Vehicle repair specialist', null, 'Ten years')).toBe(false);
    expect(isMostlyEthiopic('Mechanic with ten years of experience in Adama garages ባለሙያ')).toBe(false); // a little Amharic inside English text is fine
    expect(isMostlyEthiopic(null, '', '   ')).toBe(false);

    const w = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ headline: 'የተሽከርካሪ ጥገና ባለሙያ', bio: 'ከአስር ዓመት በላይ ልምድ አለኝ', categoryId: autoId });
    const workerId = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } })).id;
    const calls: string[][] = [];
    setAiClient(fake(calls));
    expect(await refreshWorkerEmbedding(workerId)).toBe(false);
    expect(calls).toHaveLength(0); // never sent to the model
    expect(await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, select: { embedding: true, embeddingModel: true } })).toEqual({ embedding: [], embeddingModel: null });
  });

  it('leaves data untouched when the AI service is unavailable', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, ['engine-repair']);
    setAiClient(noAi);
    expect(await refreshJobEmbedding(jobId)).toBe(false);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).embedding).toEqual([]);
    // and matching still works, using the rule-based score only
    const w = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: autoId, yearsExperience: 3 });
    await request(app).put(`/api/v1/workers/me/skills/${skill['engine-repair']}`).set(auth(w.token)).send({ proficiency: 4 });
    const m = await request(app).get(`/api/v1/jobs/${jobId}/match`).set(auth(w.token));
    expect(m.status).toBe(200);
    expect(m.body.match.engineVersion).toBe('rules-1.0');
    expect(m.body.match.semantic).toEqual({ similarity: null, score: null, lift: 0 });
  });
});

describe('recall by meaning', () => {
  it('finds workers with no shared skills or category when their profile text is close to the job', async () => {
    const e = await signUp('EMPLOYER');
    const jobId = await liveJob(e, ['engine-repair', 'brake-systems']);
    await prisma.job.update({ where: { id: jobId }, data: { embedding: [1, 0, 0, 0], embeddingModel: 'fake' } });

    const near = await signUp('WORKER'); // no skills, no category: invisible to the rule-based search
    const far = await signUp('WORKER');
    const skip = await signUp('WORKER'); // same, but no embedding at all
    const ids: Record<string, string> = {};
    for (const [name, u] of Object.entries({ near, far, skip })) ids[name] = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId: u.id } })).id;
    await prisma.workerProfile.update({ where: { id: ids.near }, data: { embedding: [1, 0, 0, 0], embeddingModel: 'fake' } });
    await prisma.workerProfile.update({ where: { id: ids.far }, data: { embedding: [0, 1, 0, 0], embeddingModel: 'fake' } });

    const res = await request(app).get(`/api/v1/jobs/${jobId}/recommended-workers`).set(auth(e.token));
    expect(res.status).toBe(200);
    const found = res.body.items.map((i: { workerId: string }) => i.workerId);
    expect(found).toContain(ids.near);
    expect(found).not.toContain(ids.far);
    expect(found).not.toContain(ids.skip);

    const item = res.body.items.find((i: { workerId: string }) => i.workerId === ids.near);
    expect(item.match.engineVersion).toBe('hybrid-1.0');
    expect(item.match.semantic.similarity).toBe(1);
    expect(item.match.components.skills.note).toContain('no skills listed');
  });

  it('recommends jobs by meaning even when the worker shares no skill or category with them', async () => {
    const e = await signUp('EMPLOYER');
    const near = await liveJob(e, ['engine-repair', 'brake-systems']);
    const far = await liveJob(e, ['engine-repair'], { title: `Other job ${tag()}`, description: `Different duties entirely. ${randomUUID()} ${randomUUID()} Apply with references.` });
    await prisma.job.update({ where: { id: near }, data: { embedding: [1, 0, 0, 0], embeddingModel: 'fake' } });
    await prisma.job.update({ where: { id: far }, data: { embedding: [0, 1, 0, 0], embeddingModel: 'fake' } });

    const w = await signUp('WORKER');
    await request(app).patch('/api/v1/workers/me').set(auth(w.token)).send({ categoryId: cookId, yearsExperience: 4 });
    await request(app).put(`/api/v1/workers/me/skills/${skill['cooking']}`).set(auth(w.token)).send({ proficiency: 4 });
    const workerId = (await prisma.workerProfile.findUniqueOrThrow({ where: { userId: w.id } })).id;
    await prisma.workerProfile.update({ where: { id: workerId }, data: { embedding: [1, 0, 0, 0], embeddingModel: 'fake' } });

    const res = await request(app).get('/api/v1/recommendations/jobs?limit=50').set(auth(w.token));
    const ids = res.body.items.map((i: { job: { id: string } }) => i.job.id);
    expect(ids).toContain(near);
    expect(ids).not.toContain(far);
    const item = res.body.items.find((i: { job: { id: string } }) => i.job.id === near);
    expect(item.match.engineVersion).toBe('hybrid-1.0');
    expect(item.match.requiredCoverage.covered).toBe(0); // no listed skill helps; meaning alone found it
    expect(item.match.explanation).not.toContain('None of the required skills are listed');
  });
});
