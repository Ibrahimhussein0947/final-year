import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { parseCv } from '../analysis/cvParser';
import { loadSkillIndex } from '../analysis/skillIndex';
import { ocrLanguages } from '../analysis/ocr';
import { readDocument } from '../documents/inspect';
import { filePathOf } from '../files/storage';
import { detailInclude, toListItem } from '../jobs/service';
import { publicMatch, recommendJobs } from '../matching/service';
import { notify } from '../notifications/service';
import { checkProfileAgainstCv, type Finding, type Outcome, type ProfileFacts } from './consistency';

export async function loadProfileFacts(workerId: string): Promise<ProfileFacts> {
  const w = await prisma.workerProfile.findUniqueOrThrow({
    where: { id: workerId },
    select: {
      yearsExperience: true,
      user: { select: { fullName: true, phone: true, email: true } },
      education: { select: { level: true } },
      experiences: { select: { employer: true } },
    },
  });
  return {
    fullName: w.user.fullName, phone: w.user.phone, email: w.user.email, yearsExperience: w.yearsExperience,
    educationLevels: w.education.map((e) => e.level), employers: w.experiences.map((e) => e.employer ?? '').filter(Boolean),
  };
}

/** Changes whenever a detail the check looks at changes, so an old result is never reused for a different profile. */
export const profileHash = (f: ProfileFacts) =>
  createHash('sha256').update(JSON.stringify([f.fullName, f.phone, f.email, f.yearsExperience, [...f.educationLevels].sort(), [...f.employers].sort()])).digest('hex').slice(0, 32);

export interface CvCheckView { id: string; outcome: Outcome; reason: string | null; findings: Finding[]; createdAt: Date }
type Stored = { items: Finding[]; reason: string | null };
const viewOf = (c: { id: string; outcome: Outcome; findings: Prisma.JsonValue; createdAt: Date }): CvCheckView => {
  const s = c.findings as unknown as Stored;
  return { id: c.id, outcome: c.outcome, reason: s.reason, findings: s.items, createdAt: c.createdAt };
};

/** Read the CV, compare it with the profile, and remember the result (not the CV's text). */
export async function checkCv(workerId: string, file: { buffer: Buffer; mime: string; fileId: string | null }): Promise<CvCheckView> {
  const profile = await loadProfileFacts(workerId);
  const read = await readDocument(file.buffer, file.mime);
  const parsed = read.text.length >= 40 ? parseCv(read.text, await loadSkillIndex()) : null;
  let result: { outcome: Outcome; findings: Finding[]; reason: string | null };
  if (read.source === 'none' || !parsed) {
    result = { outcome: 'UNCHECKED', findings: [], reason: read.problem ?? 'Not enough text could be read from the CV to compare it with your profile.' };
  } else {
    result = checkProfileAgainstCv(profile, {
      text: read.text, confidence: read.confidence,
      educationLevels: parsed.education.map((e) => e.level), hasEducationSection: parsed.sectionsFound.includes('education') || parsed.education.length > 0,
      estimatedYears: parsed.estimatedYearsExperience, experienceEntries: parsed.experiences.length,
      canReadEthiopic: read.source === 'pdf-text' || ocrLanguages().includes('amh'),
    });
  }
  const row = await prisma.cvCheck.create({
    data: { workerId, fileId: file.fileId, outcome: result.outcome, profileHash: profileHash(profile), ocrConfidence: read.confidence, findings: { items: result.findings, reason: result.reason } as unknown as Prisma.InputJsonValue },
  });
  return viewOf(row);
}

export async function latestCvCheck(workerId: string): Promise<CvCheckView | null> {
  const row = await prisma.cvCheck.findFirst({ where: { workerId }, orderBy: { createdAt: 'desc' } });
  return row ? viewOf(row) : null;
}

/** The check for the CV on the profile as it is now: reuse the last one if nothing it looks at has changed, otherwise read the CV again. */
export async function currentCvCheck(workerId: string): Promise<CvCheckView | null> {
  const w = await prisma.workerProfile.findUniqueOrThrow({ where: { id: workerId }, select: { cvFileId: true } });
  if (!w.cvFileId) return null;
  const hash = profileHash(await loadProfileFacts(workerId));
  const last = await prisma.cvCheck.findFirst({ where: { workerId, fileId: w.cvFileId }, orderBy: { createdAt: 'desc' } });
  if (last && last.profileHash === hash) return viewOf(last);
  const asset = await prisma.fileAsset.findUnique({ where: { id: w.cvFileId } });
  if (!asset) return null;
  return checkCv(workerId, { buffer: await fs.readFile(filePathOf(asset.storagePath)), mime: asset.mime, fileId: asset.id });
}

/** Turn a declined check into the error the person sees: what is wrong and what to do about it. */
export const mismatchError = (c: CvCheckView, what: 'application' | 'cv') =>
  new AppError(422, 'PROFILE_MISMATCH', what === 'cv'
    ? 'This CV was not accepted because it does not agree with the details on your profile.'
    : 'Your application was declined because your CV does not agree with the details on your profile.', {
    reasons: c.findings.filter((f) => f.severity === 'block').map((f) => f.message),
    warnings: c.findings.filter((f) => f.severity === 'warn').map((f) => f.message),
    fix: ['Correct the details on your profile if they are wrong, or upload the right CV, then try again.'],
  });

/**
 * Called before a worker applies. A worker with no CV has nothing to compare, so nothing is checked. A worker whose CV
 * contradicts their profile is declined, with the reasons, and can fix it and try again. Warnings do not stop anything.
 */
export async function assertCvAgreesWithProfile(workerId: string): Promise<CvCheckView | null> {
  const check = await currentCvCheck(workerId);
  if (check?.outcome === 'DECLINED') throw mismatchError(check, 'application');
  return check;
}

// ───────── after acceptance: the jobs that fit what the worker wants ─────────

/** Open jobs ranked by the worker's skills, experience, location and preferences (the same ranking as "Recommended for you"). */
export async function opportunitiesFor(workerId: string, limit = 5) {
  const { items, reason } = await recommendJobs(workerId, limit);
  const jobs = await prisma.job.findMany({ where: { id: { in: items.map((i) => i.jobId) } }, include: detailInclude });
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return { reason, items: items.filter((i) => byId.has(i.jobId)).map(({ jobId, result }) => ({ job: toListItem(byId.get(jobId)!), match: publicMatch(result) })) };
}

/** A CV was accepted: find the jobs that fit and tell the worker. Never blocks or fails the upload. */
export async function opportunitiesAfterAcceptance(workerId: string, userId: string) {
  try {
    const found = await opportunitiesFor(workerId, 5);
    if (found.items.length > 0) await notify(userId, 'cv.accepted', { count: found.items.length, topJob: found.items[0].job.title });
    return found;
  } catch (err) {
    logger.warn({ err: String(err) }, 'could not find job opportunities after CV acceptance');
    return { reason: 'ok' as const, items: [] };
  }
}
