import { detectDiscrimination, discriminationMessage } from '../criteria/discrimination';
import fs from 'node:fs/promises';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/errors';
import { filePathOf } from '../files/storage';
import { createChild, upsertSkill, workerIdFor } from '../workers/service';
import { analyzeJob } from './jobAnalyzer';
import { parseCv } from './cvParser';
import { extractPdfText } from './pdf';
import { ocrImage, ocrPdf, type OcrResult } from './ocr';
import { AppError } from '../../lib/errors';
import { loadSkillIndex } from './skillIndex';

let categoryCache: { at: number; value: { id: string; slug: string; nameEn: string }[] } | null = null;
async function categories() {
  if (categoryCache && Date.now() - categoryCache.at < 5 * 60_000) return categoryCache.value;
  const value = await prisma.category.findMany({ select: { id: true, slug: true, nameEn: true } });
  categoryCache = { at: Date.now(), value };
  return value;
}

export async function analyzeJobText(input: { title?: string; description: string }) {
  const analysis = analyzeJob(input, await loadSkillIndex(), await categories());
  // Warn while the employer is still writing: such text will be refused when the job is saved.
  const findings = detectDiscrimination(input.title, input.description);
  if (findings.length) analysis.notes.unshift(discriminationMessage(findings));
  return analysis;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Read the worker's stored CV, parse it, and say which parts are already on the profile. Nothing is saved. */
export async function analyzeMyCv(userId: string) {
  const workerId = await workerIdFor(userId);
  const worker = await prisma.workerProfile.findUniqueOrThrow({
    where: { id: workerId },
    select: {
      cvFileId: true,
      skills: { select: { skillId: true } },
      experiences: { select: { title: true, startDate: true } },
      education: { select: { level: true, field: true } },
      certifications: { select: { name: true } },
    },
  });
  if (!worker.cvFileId) throw badRequest('Upload your CV first, then analyse it.');
  const asset = await prisma.fileAsset.findUnique({ where: { id: worker.cvFileId } });
  if (!asset) throw notFound('CV file not found');

  const buf = await fs.readFile(filePathOf(asset.storagePath));
  // Text PDFs are read directly. A photo, or a PDF that is only pictures, goes through OCR instead.
  let ocr: OcrResult | null = null;
  let text: string;
  let pages: number;
  if (asset.mime.startsWith('image/')) {
    ocr = await ocrImage(buf);
    ({ text, pages } = ocr);
  } else {
    try {
      ({ text, pages } = await extractPdfText(buf));
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'NO_TEXT') throw err;
      ocr = await ocrPdf(buf);
      ({ text, pages } = ocr);
    }
  }
  if (ocr && text.replace(/\s/g, '').length < 40) {
    throw new AppError(422, 'NO_TEXT', 'No readable text was found, even after trying to read it as a picture. Use a clearer, straighter photo or scan, or fill in your profile by hand.');
  }
  const parsed = parseCv(text, await loadSkillIndex());

  const haveSkills = new Set(worker.skills.map((s) => s.skillId));
  const haveExp = new Set(worker.experiences.map((e) => `${norm(e.title)}|${e.startDate.toISOString().slice(0, 7)}`));
  const haveEdu = new Set(worker.education.map((e) => `${e.level}|${norm(e.field)}`));
  const haveCert = new Set(worker.certifications.map((c) => norm(c.name)));

  return {
    pages,
    characters: text.length,
    // Set when the text came from reading a picture: it can contain mistakes, so the worker must check every line.
    ocr: ocr ? { used: true, confidence: ocr.confidence } : { used: false, confidence: null },
    parsed: {
      ...parsed,
      skills: parsed.skills.map((s) => ({ ...s, alreadyOnProfile: haveSkills.has(s.skillId) })),
      experiences: parsed.experiences.map((e) => ({ ...e, alreadyOnProfile: haveExp.has(`${norm(e.title)}|${e.startDate.slice(0, 7)}`) })),
      education: parsed.education.map((e) => ({ ...e, alreadyOnProfile: haveEdu.has(`${e.level}|${norm(e.field)}`) })),
      certifications: parsed.certifications.map((c) => ({ ...c, alreadyOnProfile: haveCert.has(norm(c.name)) })),
    },
  };
}

export interface CvApplyInput {
  skills: { skillId: string; proficiency: number }[];
  experiences: { title: string; employer?: string | null; categoryId?: string | null; startDate: Date; endDate?: Date | null; description?: string | null }[];
  education: { level: string; field?: string | null; institution?: string | null; year?: number | null }[];
  certifications: { name: string; issuer?: string | null; year?: number | null }[];
  yearsExperience?: number;
  bio?: string | null;
}

/**
 * Save what the worker reviewed and approved. Entries that already exist are skipped, and everything is stored
 * as self-reported: a CV is the person's own claim, so importing it can never create a "verified" item.
 */
export async function applyCv(userId: string, input: CvApplyInput) {
  const workerId = await workerIdFor(userId);
  const existing = await prisma.workerProfile.findUniqueOrThrow({
    where: { id: workerId },
    select: {
      bio: true,
      skills: { select: { skillId: true } },
      experiences: { select: { title: true, startDate: true } },
      education: { select: { level: true, field: true } },
      certifications: { select: { name: true } },
    },
  });
  const added = { skills: 0, experiences: 0, education: 0, certifications: 0 };
  const skipped = { skills: 0, experiences: 0, education: 0, certifications: 0 };

  const haveSkills = new Set(existing.skills.map((s) => s.skillId));
  for (const s of input.skills) {
    if (haveSkills.has(s.skillId)) { skipped.skills++; continue; }
    await upsertSkill(workerId, s.skillId, s.proficiency, null); // throws 404 for unknown skills
    haveSkills.add(s.skillId);
    added.skills++;
  }

  const haveExp = new Set(existing.experiences.map((e) => `${norm(e.title)}|${e.startDate.toISOString().slice(0, 7)}`));
  for (const e of input.experiences) {
    const key = `${norm(e.title)}|${e.startDate.toISOString().slice(0, 7)}`;
    if (haveExp.has(key)) { skipped.experiences++; continue; }
    await createChild('workExperience', workerId, { ...e });
    haveExp.add(key);
    added.experiences++;
  }

  const haveEdu = new Set(existing.education.map((e) => `${e.level}|${norm(e.field)}`));
  for (const e of input.education) {
    const key = `${e.level}|${norm(e.field)}`;
    if (haveEdu.has(key)) { skipped.education++; continue; }
    await createChild('education', workerId, { ...e });
    haveEdu.add(key);
    added.education++;
  }

  const haveCert = new Set(existing.certifications.map((c) => norm(c.name)));
  for (const c of input.certifications) {
    if (haveCert.has(norm(c.name))) { skipped.certifications++; continue; }
    await createChild('certification', workerId, { ...c });
    haveCert.add(norm(c.name));
    added.certifications++;
  }

  const patch: { yearsExperience?: number; bio?: string } = {};
  if (input.yearsExperience !== undefined) patch.yearsExperience = input.yearsExperience;
  // Never overwrite a biography the person already wrote.
  if (input.bio && !existing.bio) patch.bio = input.bio;
  if (Object.keys(patch).length) await prisma.workerProfile.update({ where: { id: workerId }, data: patch });

  return { added, skipped, workerId };
}
