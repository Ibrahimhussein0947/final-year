import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import type { FileKind } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError, badRequest } from '../../lib/errors';

const apiRoot = path.resolve(__dirname, '../../..');
export const uploadRoot = path.resolve(apiRoot, env.UPLOAD_DIR);

type Detected = { ext: 'pdf' | 'jpg' | 'png'; mime: string };

/** Identify a file by its leading bytes. The client-supplied name and MIME type are never trusted. */
export function sniff(buf: Buffer): Detected | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  return null;
}

const RULES: Record<FileKind, { types: Detected['ext'][]; maxBytes: number }> = {
  PROFILE_PHOTO: { types: ['jpg', 'png'], maxBytes: 2 * 1024 * 1024 },
  CV: { types: ['pdf', 'jpg', 'png'], maxBytes: 5 * 1024 * 1024 },
  VERIFICATION_EVIDENCE: { types: ['pdf', 'jpg', 'png'], maxBytes: 5 * 1024 * 1024 },
  CERTIFICATE: { types: ['pdf', 'jpg', 'png'], maxBytes: 5 * 1024 * 1024 },
  PORTFOLIO: { types: ['pdf', 'jpg', 'png'], maxBytes: 5 * 1024 * 1024 },
};

/** Multer parses into memory (hard 5 MB cap); we validate before anything touches the disk. */
export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
}).single('file');

export async function saveUpload(ownerId: string, kind: FileKind, file: Express.Multer.File | undefined) {
  if (!file) throw badRequest('No file received. Send it as multipart field "file".');
  const rule = RULES[kind];
  if (file.size > rule.maxBytes) throw new AppError(413, 'FILE_TOO_LARGE', `File is too large (max ${rule.maxBytes / 1024 / 1024} MB)`);
  const detected = sniff(file.buffer);
  if (!detected || !rule.types.includes(detected.ext)) {
    throw new AppError(415, 'UNSUPPORTED_FILE', `Unsupported file type. Allowed: ${rule.types.join(', ').toUpperCase()}`);
  }
  await fs.mkdir(uploadRoot, { recursive: true });
  const storageName = `${randomUUID()}.${detected.ext}`; // random name: user input never reaches the path
  await fs.writeFile(path.join(uploadRoot, storageName), file.buffer, { flag: 'wx' });
  return prisma.fileAsset.create({
    data: {
      ownerId,
      kind,
      storagePath: storageName,
      mime: detected.mime,
      sizeBytes: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    },
  });
}

export async function deleteFileAsset(id: string | null | undefined) {
  if (!id) return;
  const row = await prisma.fileAsset.findUnique({ where: { id } });
  if (!row) return;
  await prisma.fileAsset.delete({ where: { id } });
  await fs.rm(path.join(uploadRoot, path.basename(row.storagePath)), { force: true });
}

export const filePathOf = (storagePath: string) => path.join(uploadRoot, path.basename(storagePath));
