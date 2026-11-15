// Usage: npm run embeddings:backfill -w @ethiotalent/api
// Computes embeddings for skills, active jobs and visible workers that do not have one yet (or all, with --all).
// Requires AI_SERVICE_URL and AI_SERVICE_TOKEN and a running AI service.
import { aiClient } from '../integrations/aiClient';
import { prisma } from '../lib/prisma';
import { isMostlyEthiopic, jobText, skillText, workerText } from '../modules/matching/embeddings';

const BATCH = 16;
const all = process.argv.includes('--all');

async function embedAll<T extends { id: string }>(label: string, rows: T[], text: (r: T) => string, save: (id: string, vec: number[], model: string) => Promise<unknown>) {
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).filter((r) => text(r).length > 0);
    if (!batch.length) continue;
    const res = await aiClient().embed(batch.map(text), { timeoutMs: 60_000 });
    if (!res) throw new Error(`AI service did not answer while embedding ${label}`);
    for (let j = 0; j < batch.length; j++) await save(batch[j].id, res.vectors[j], res.model);
    done += batch.length;
  }
  console.log(`${label}: ${done} embedded`);
}

async function main() {
  if (!aiClient().enabled()) {
    console.error('AI_SERVICE_URL / AI_SERVICE_TOKEN are not set; nothing to do.');
    process.exit(1);
  }
  const missing = all ? {} : { embedding: { isEmpty: true } };

  const skills = await prisma.skill.findMany({ where: { isActive: true, ...missing }, select: { id: true, nameEn: true, aliases: true } });
  await embedAll('skills', skills, skillText, (id, embedding) => prisma.skill.update({ where: { id }, data: { embedding } }));

  const jobs = await prisma.job.findMany({
    where: { status: { in: ['ACTIVE', 'PENDING_REVIEW'] }, ...missing },
    select: { id: true, title: true, description: true, skills: { select: { importance: true, skill: { select: { nameEn: true } } } } },
  });
  await embedAll('jobs', jobs, (j) => isMostlyEthiopic(j.title, j.description) ? '' : jobText({ title: j.title, description: j.description, skills: j.skills.map((s) => ({ name: s.skill.nameEn, required: s.importance === 'REQUIRED' })) }),
    (id, embedding, embeddingModel) => prisma.job.update({ where: { id }, data: { embedding, embeddingModel } }));

  const workers = await prisma.workerProfile.findMany({
    where: { isVisible: true, ...missing },
    select: { id: true, headline: true, occupation: true, bio: true, skills: { select: { skill: { select: { nameEn: true } } } } },
  });
  await embedAll('workers', workers, (w) => isMostlyEthiopic(w.headline, w.occupation, w.bio) ? '' : workerText({ ...w, skills: w.skills.map((s) => s.skill.nameEn) }),
    (id, embedding, embeddingModel) => prisma.workerProfile.update({ where: { id }, data: { embedding, embeddingModel } }));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
