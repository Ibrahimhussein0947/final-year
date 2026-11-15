/**
 * Runs the ranking evaluation: `npm run eval -w @ethiotalent/api`.
 * No database or AI service needed. Writes evaluation/results.json, docs/evaluation-results.md and the annotation template.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { relations as seedRelations, skills as seedSkills } from '../../prisma/seed/data';
import { cosine } from '../modules/matching/components';
import { jobText, workerText } from '../modules/matching/embeddingText';
import { matchPair, recommendable } from '../modules/matching/scorer';
import { DEFAULT_WEIGHTS, type MatchWeights, type RelationMap } from '../modules/matching/types';
import { bm25Rank } from './keyword';
import { bootstrapDiffCI, coverage, mean, ndcgAtK, percentile, precisionAtK, recallAtK, reciprocalRank, totalRelevant, RELEVANT_GRADE } from './metrics';
import { eduBand, expBand, jobs, workers, type EvalJob } from './dataset';

const NOW = new Date('2026-11-01T00:00:00Z');
const KS = [3, 5];

const relMap: RelationMap = new Map();
for (const [a, b, , w] of seedRelations) {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const m = relMap.get(x) ?? new Map<string, number>();
    m.set(y, Math.max(m.get(y) ?? 0, w));
    relMap.set(x, m);
  }
}

type Ranker = (job: EvalJob) => string[];
const wid = workers.map((w) => w.features.id);

const rulesRank = (weights: MatchWeights, filter: boolean): Ranker => (job) => {
  const rows = workers.map((w) => ({ id: w.features.id, r: matchPair(job.features, w.features, weights, relMap, NOW) }));
  return rows
    .filter((x) => !filter || recommendable(x.r))
    .sort((a, b) => b.r.score - a.r.score || b.r.confidence - a.r.confidence || a.id.localeCompare(b.id))
    .map((x) => x.id);
};

const SKILLS_ONLY: MatchWeights = { skills: 1, experience: 0, location: 0, qualification: 0, availability: 0, preferences: 0, criteria: 0 };

function randomRank(seed: number): Ranker {
  return (job) => {
    let s = seed + job.features.id.charCodeAt(2) * 31 + job.features.id.charCodeAt(1);
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    return [...wid].map((id) => ({ id, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.id);
  };
}

const rankers: Record<string, Ranker> = {
  'Keyword (BM25 on free text)': (job) => bm25Rank(job.text, workers.map((w) => ({ id: w.features.id, text: w.text }))),
  'Rule-based, skills only': rulesRank(SKILLS_ONLY, true),
  'Rule-based weighted (the shipped engine)': rulesRank(DEFAULT_WEIGHTS, true),
};

interface Row { job: string; category: string; region: string; p: Record<number, number>; r: Record<number, number | null>; ndcg: Record<number, number | null>; rr: number | null }

function evaluate(rank: Ranker): { rows: Row[]; lists: string[][] } {
  const rows: Row[] = [];
  const lists: string[][] = [];
  for (const job of jobs) {
    const list = rank(job);
    lists.push(list.slice(0, 5));
    rows.push({
      job: job.features.id, category: job.category, region: job.region,
      p: Object.fromEntries(KS.map((k) => [k, precisionAtK(list, job.grades, k)])),
      r: Object.fromEntries(KS.map((k) => [k, recallAtK(list, job.grades, k)])),
      ndcg: Object.fromEntries(KS.map((k) => [k, ndcgAtK(list, job.grades, k)])),
      rr: reciprocalRank(list, job.grades),
    });
  }
  return { rows, lists };
}

const f = (x: number | null, d = 3) => (x === null ? 'n/a' : x.toFixed(d));

// ───── texts for the embedding model, and real embeddings if they were produced ─────
const root = join(__dirname, '..', '..');
const skillName = new Map(seedSkills.map(([slug, , name]) => [slug, name]));
const texts: Record<string, string> = {};
for (const w of workers) texts[w.features.id] = workerText({ headline: w.headline, occupation: null, bio: w.bio, skills: w.features.skills.map((x) => skillName.get(x.skillId) ?? x.skillId) });
for (const j of jobs) texts[j.features.id] = jobText({ title: j.title, description: j.description, skills: j.features.skills.map((x) => ({ name: skillName.get(x.skillId) ?? x.skillId, required: x.importance === 'REQUIRED' })) });
mkdirSync(join(root, 'evaluation'), { recursive: true });
writeFileSync(join(root, 'evaluation', 'benchmark-texts.json'), JSON.stringify(texts, null, 1));

let embeddingNote = 'not measured: no embeddings file (run `npm run eval:export`, then evaluation/embed_texts.py in apps/ai, then `npm run eval`).';
let vectors: Record<string, number[]> | null = null;
let embeddingModel = '';
const embPath = join(root, 'evaluation', 'benchmark-embeddings.json');
if (existsSync(embPath)) {
  const e = JSON.parse(readFileSync(embPath, 'utf8')) as { model: string; vectors: Record<string, number[]>; texts?: Record<string, string> };
  const same = e.texts && Object.keys(texts).every((k) => e.texts![k] === texts[k]);
  if (same) { vectors = e.vectors; embeddingModel = e.model; embeddingNote = ''; }
  else embeddingNote = 'not measured: the embeddings file is out of date for the current benchmark texts. Re-run evaluation/embed_texts.py.';
}
if (vectors) {
  const withEmb = <T extends { id: string }>(f: T): T & { embedding: number[] } => ({ ...f, embedding: vectors![f.id] });
  rankers['Hybrid (rules + embeddings)'] = (job) => {
    const jf = withEmb(job.features);
    const rows = workers.map((w) => ({ id: w.features.id, r: matchPair(jf, withEmb(w.features), DEFAULT_WEIGHTS, relMap, NOW) }));
    return rows.filter((x) => recommendable(x.r)).sort((a, b) => b.r.score - a.r.score || b.r.confidence - a.r.confidence || a.id.localeCompare(b.id)).map((x) => x.id);
  };
  rankers['Semantic only (cosine, no rules)'] = (job) =>
    workers.map((w) => ({ id: w.features.id, c: cosine(vectors![job.features.id], vectors![w.features.id]) })).sort((a, b) => b.c - a.c || a.id.localeCompare(b.id)).map((x) => x.id);
}

// ───── main comparison ─────
const results: Record<string, ReturnType<typeof evaluate>> = {};
for (const [name, rk] of Object.entries(rankers)) results[name] = evaluate(rk);

// random floor: average of 30 seeds
const randRows: Row[][] = Array.from({ length: 30 }, (_, i) => evaluate(randomRank(i + 1)).rows);
const randomSummary = {
  p5: mean(randRows.map((rs) => mean(rs.map((r) => r.p[5])))), ndcg5: mean(randRows.map((rs) => mean(rs.map((r) => r.ndcg[5])))),
  mrr: mean(randRows.map((rs) => mean(rs.map((r) => r.rr)))),
};

const lines: string[] = [];
const out = (s = '') => lines.push(s);
out('# Evaluation results (generated by `npm run eval`)');
out('');
out('> **Read this first.** The data is a **synthetic** benchmark of 14 jobs and 45 invented workers, and the relevance grades were written by the project developer using a written rubric, not by independent annotators. Differences between methods are indicative on this small set, not proof of how the system performs on real Ethiopian job seekers. Results are not a claim of production accuracy.');
out('');
out(`Pairs judged: ${jobs.length} jobs × ${workers.length} workers = ${jobs.length * workers.length}. Relevant = grade ≥ ${RELEVANT_GRADE}. Mean relevant per job: ${(jobs.reduce((s, j) => s + totalRelevant(j.grades), 0) / jobs.length).toFixed(1)}.`);
out('');
out('## 1. Method comparison (mean over jobs)');
out('');
out('| Method | P@3 | P@5 | R@5 | NDCG@3 | NDCG@5 | MRR |');
out('|---|---|---|---|---|---|---|');
const summary: Record<string, { p3: number | null; p5: number | null; r5: number | null; n3: number | null; n5: number | null; mrr: number | null; coverage: number; emptyLists: number }> = {};
for (const [name, { rows, lists }] of Object.entries(results)) {
  const s = {
    p3: mean(rows.map((r) => r.p[3])), p5: mean(rows.map((r) => r.p[5])), r5: mean(rows.map((r) => r.r[5])),
    n3: mean(rows.map((r) => r.ndcg[3])), n5: mean(rows.map((r) => r.ndcg[5])), mrr: mean(rows.map((r) => r.rr)),
    coverage: coverage(lists, wid), emptyLists: lists.filter((l) => l.length === 0).length,
  };
  summary[name] = s;
  out(`| ${name} | ${f(s.p3)} | ${f(s.p5)} | ${f(s.r5)} | ${f(s.n3)} | ${f(s.n5)} | ${f(s.mrr)} |`);
}
out(`| Random order (floor, mean of 30 shuffles) | n/a | ${f(randomSummary.p5)} | n/a | n/a | ${f(randomSummary.ndcg5)} | ${f(randomSummary.mrr)} |`);
if (!vectors) out('| Hybrid (rules + embeddings) | not measured | not measured | not measured | not measured | not measured | not measured |');
out('');
out(vectors
  ? `Hybrid rows use real embeddings from \`${embeddingModel}\` on **English** benchmark text, with the calibration bounds still PROVISIONAL (SEMANTIC_LOW/HIGH were not tuned on this benchmark). \"Semantic only\" ranks by raw cosine similarity of the two texts and is a diagnostic of the model, not a product mode.`
  : `The hybrid row is empty: ${embeddingNote} No number is invented for it.`);
out('');
out('Precision divides by K even if fewer people were returned, so a method that shows a shorter list (the shipped engine hides people who cover none of the required skills) is not rewarded for it. Recall@K and NDCG@K are `n/a` for a job only if it has no relevant / graded candidate (not the case here).');
out('');

const keyName = 'Keyword (BM25 on free text)';
const shipName = 'Rule-based weighted (the shipped engine)';
const diff = (a: string, b: string, pick: (r: Row) => number | null) =>
  results[a].rows.map((r, i) => (pick(r) ?? 0) - (pick(results[b].rows[i]) ?? 0));
const ci = bootstrapDiffCI(diff(shipName, keyName, (r) => r.ndcg[5]));
out('## 2. Is the difference real?');
out('');
out(`Paired bootstrap over the 14 jobs, NDCG@5 of the shipped engine minus keyword: **${ci.mean.toFixed(3)}** (95% interval ${ci.low.toFixed(3)} to ${ci.high.toFixed(3)}). ${ci.low > 0 ? 'The interval is above zero.' : 'The interval includes zero, so the gain is not established on this data.'} With 14 jobs the interval is wide by construction.`);
out('');

const hybridName = 'Hybrid (rules + embeddings)';
if (vectors) {
  const ci2 = bootstrapDiffCI(diff(hybridName, shipName, (r) => r.ndcg[5]));
  const ci3 = bootstrapDiffCI(diff(hybridName, keyName, (r) => r.ndcg[5]));
  out(`Hybrid minus shipped rules, NDCG@5: **${ci2.mean.toFixed(3)}** (95% interval ${ci2.low.toFixed(3)} to ${ci2.high.toFixed(3)}). Hybrid minus keyword: **${ci3.mean.toFixed(3)}** (${ci3.low.toFixed(3)} to ${ci3.high.toFixed(3)}). ${ci2.low > 0 ? 'The hybrid gain is above zero.' : 'The interval includes zero, so no hybrid gain is established on this data.'} This benchmark is English, uses the same vocabulary as the skill list, and is near its ceiling, so it is a weak test of what embeddings add.`);
  out('');
}

// ───── per job ─────
out('## 3. Per job (NDCG@5)');
out('');
out(`| Job | Category | Region | Keyword | Skills only | Shipped engine |`);
out('|---|---|---|---|---|---|');
const names = Object.keys(results);
jobs.forEach((j, i) => out(`| ${j.title} | ${j.category} | ${j.region} | ${names.map((n) => f(results[n].rows[i].ndcg[5], 2)).join(' | ')} |`));
out('');

// ───── slices ─────
const sliceTable = (title: string, key: 'category' | 'region') => {
  out(`## ${title}`);
  out('');
  out('| Group | Jobs | Keyword NDCG@5 | Shipped engine NDCG@5 | Keyword P@5 | Shipped engine P@5 |');
  out('|---|---|---|---|---|---|');
  const groups = [...new Set(jobs.map((j) => j[key]))];
  for (const g of groups) {
    const idx = jobs.map((j, i) => (j[key] === g ? i : -1)).filter((i) => i >= 0);
    const m = (n: string, pick: (r: Row) => number | null) => mean(idx.map((i) => pick(results[n].rows[i])));
    out(`| ${g} | ${idx.length} | ${f(m(keyName, (r) => r.ndcg[5]))} | ${f(m(shipName, (r) => r.ndcg[5]))} | ${f(m(keyName, (r) => r.p[5]))} | ${f(m(shipName, (r) => r.p[5]))} |`);
  }
  out('');
  out('Groups with one or two jobs are anecdotes, not statistics.');
  out('');
};
sliceTable('4. By job category', 'category');
sliceTable('5. By job region', 'region');

// ───── fairness: who gets surfaced among the truly relevant ─────
out('## 6. Fairness check: are equally suitable people surfaced equally?');
out('');
out('For every (job, worker) pair graded relevant (≥ 2), did the worker appear in the top 5? Grouped by the worker\'s education and experience. The grade rubric does **not** reduce a grade for missing certificates in trades, so a gap here is a gap the engine introduces relative to the rubric.');
out('');
const fairness: Record<string, Record<string, { found: number; total: number }>> = {};
const grouping: Record<string, (id: string) => string> = {
  'Education': (id) => eduBand(workers.find((w) => w.features.id === id)!.features),
  'Experience': (id) => expBand(workers.find((w) => w.features.id === id)!.features),
};
for (const [rname, label] of ([[keyName, 'Keyword'], [shipName, 'Shipped engine'], ...(vectors ? [[hybridName, 'Hybrid']] : [])] as [string, string][])) {
  const lists = results[rname].lists;
  for (const [gname, groupOf] of Object.entries(grouping)) {
    const acc: Record<string, { found: number; total: number }> = {};
    jobs.forEach((j, i) => {
      for (const [id, g] of Object.entries(j.grades)) {
        if (g < RELEVANT_GRADE) continue;
        const grp = groupOf(id);
        acc[grp] ??= { found: 0, total: 0 };
        acc[grp].total++;
        if (lists[i].includes(id)) acc[grp].found++;
      }
    });
    fairness[`${label} / ${gname}`] = acc;
  }
}
out('| Method / grouping | Group | Relevant pairs | Found in top 5 | Rate |');
out('|---|---|---|---|---|');
for (const [k, acc] of Object.entries(fairness)) {
  for (const [grp, v] of Object.entries(acc)) out(`| ${k} | ${grp} | ${v.total} | ${v.found} | ${f(v.total ? v.found / v.total : null, 2)} |`);
}
out('');
out('Groups of fewer than 5 relevant pairs are shown but cannot support any conclusion. Gender, age and ethnicity are not collected by the platform and are not evaluated; this check covers only education and experience.');
out('');

// ───── latency ─────
const timeMs: number[] = [];
const sample = jobs[0];
for (let i = 0; i < 300; i++) {
  const t = performance.now();
  rulesRank(DEFAULT_WEIGHTS, true)(sample);
  timeMs.push(performance.now() - t);
}
const big = Array.from({ length: 10_000 }, (_, i) => ({ ...workers[i % workers.length].features, id: `X${i}` }));
const tBig: number[] = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  big.map((w) => matchPair(sample.features, w, DEFAULT_WEIGHTS, relMap, NOW)).filter(recommendable).sort((a, b) => b.score - a.score);
  tBig.push(performance.now() - t);
}
out('## 7. Speed of the scoring step (in-memory, no database, no AI service)');
out('');
out(`- Ranking ${workers.length} workers for one job: median ${percentile(timeMs, 50).toFixed(2)} ms, 95th percentile ${percentile(timeMs, 95).toFixed(2)} ms (300 runs).`);
out(`- Scoring and ranking 10,000 workers for one job: median ${percentile(tBig, 50).toFixed(0)} ms (5 runs).`);
out('- This excludes database reads and network time; see the API performance tests for end-to-end timings.');
out('');
out('## 8. Coverage');
out('');
out('Share of the 45 workers shown in at least one job\'s top 5:');
for (const [n, s] of Object.entries(summary)) out(`- ${n}: ${(s.coverage * 100).toFixed(0)}% (jobs with an empty list: ${s.emptyLists})`);
out('');

// ───── errors worth reading ─────
out('## 9. Where the shipped engine disagrees with the labels');
out('');
const missed: string[] = [];
const wrongTop: string[] = [];
jobs.forEach((j, i) => {
  const list = results[shipName].lists[i];
  for (const [id, g] of Object.entries(j.grades)) if (g >= 3 && !list.slice(0, 3).includes(id)) missed.push(`${j.title}: ${id} (${workers.find((w) => w.features.id === id)!.headline}, grade ${g}) is not in the top 3`);
  list.slice(0, 3).forEach((id, pos) => {
    if ((j.grades[id] ?? 0) === 0) wrongTop.push(`${j.title}: rank ${pos + 1} is ${id} (${workers.find((w) => w.features.id === id)!.headline}), graded 0`);
  });
});
out('Clearly suitable people (grade 3) missing from the top 3:');
out(missed.length ? missed.map((m) => `- ${m}`).join('\n') : '- none');
out('');
out('Top-3 positions held by people graded 0:');
out(wrongTop.length ? wrongTop.map((m) => `- ${m}`).join('\n') : '- none');
out('');

writeFileSync(join(root, 'evaluation', 'results.json'), JSON.stringify({ embeddingModel: embeddingModel || null, summary, randomSummary, ci, fairness }, null, 2));
writeFileSync(join(root, '..', '..', 'docs', 'evaluation-results.md'), lines.join('\n'));
const csv = ['job_id,job_title,worker_id,worker_headline,developer_grade,annotator_1_grade,annotator_2_grade'];
for (const j of jobs) for (const w of workers) csv.push([j.features.id, j.title, w.features.id, w.headline, j.grades[w.features.id] ?? 0, '', ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
writeFileSync(join(root, 'evaluation', 'annotation-template.csv'), csv.join('\n'));
console.log(lines.join('\n'));
