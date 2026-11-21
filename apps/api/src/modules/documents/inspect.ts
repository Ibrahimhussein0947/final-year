import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { extractPdfText } from '../analysis/pdf';
import { ocrImage, ocrPdf } from '../analysis/ocr';

export interface ReadResult { text: string; confidence: number | null; source: 'pdf-text' | 'ocr' | 'none'; problem: string | null }

const MIN_PDF_TEXT = 40;

/**
 * The text of an uploaded document: the text layer of a PDF when it has one, otherwise a reading of the picture (OCR).
 * A file that cannot be read is not an error for the person: the check simply reports "unreadable" and an administrator
 * looks at the file. Only "too many people are uploading right now" is passed on, so they can try again.
 */
export async function readDocument(buffer: Buffer, mime: string): Promise<ReadResult> {
  try {
    if (mime === 'application/pdf') {
      const { text } = await extractPdfText(buffer).catch(() => ({ text: '' }));
      if (text.replace(/\s/g, '').length >= MIN_PDF_TEXT) return { text, confidence: null, source: 'pdf-text', problem: null };
      const r = await ocrPdf(buffer);
      return { text: r.text, confidence: r.confidence, source: 'ocr', problem: null };
    }
    const r = await ocrImage(buffer);
    return { text: r.text, confidence: r.confidence, source: 'ocr', problem: null };
  } catch (err) {
    if (err instanceof AppError && err.code === 'OCR_BUSY') throw err;
    return { text: '', confidence: null, source: 'none', problem: err instanceof AppError ? err.message : 'The file could not be read.' };
  }
}

// ───────── warning signs ─────────
// These are hints for the administrator, never proof: a genuine scan can trip any of them, and a careful forger can avoid
// all of them. They are shown to administrators only, so they do not become a checklist for getting past the check.

export interface Flag { code: string; level: 'info' | 'warn'; message: string }

const EDITORS = /(Adobe Photoshop|Photoshop|GIMP|Canva|Paint\.NET|Pixlr|PicsArt|Lightroom|Illustrator|Snapseed|Fotor|Affinity Photo)/i;
const WORD_PROCESSORS = /(Microsoft[^\n]{0,4}Word|LibreOffice|OpenOffice|Google Docs|WPS Office)/i;

function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

export async function integrityFlags(input: { buffer: Buffer; mime: string; sha256: string; userId: string; fileId: string }): Promise<Flag[]> {
  const flags: Flag[] = [];
  const sameElsewhere = await prisma.fileAsset.count({ where: { sha256: input.sha256, ownerId: { not: input.userId }, kind: { in: ['VERIFICATION_EVIDENCE', 'CERTIFICATE'] } } });
  if (sameElsewhere > 0) flags.push({ code: 'DUPLICATE_OTHER_ACCOUNT', level: 'warn', message: `This exact file has also been uploaded by ${sameElsewhere === 1 ? 'another account' : `${sameElsewhere} other accounts`}.` });
  const sameSelf = await prisma.fileAsset.count({ where: { sha256: input.sha256, ownerId: input.userId, id: { not: input.fileId }, documentCheck: { isNot: null } } });
  if (sameSelf > 0) flags.push({ code: 'SAME_FILE_REUSED', level: 'info', message: 'The same file was already uploaded for another document by this person.' });

  const head = input.buffer.toString('latin1');
  const editor = head.match(EDITORS);
  if (editor) flags.push({ code: 'EDITING_SOFTWARE', level: 'warn', message: `The file's hidden information names image-editing software (${editor[1]}). Genuine scans sometimes do too, but a certificate is not normally edited.` });
  if (input.mime === 'application/pdf' && WORD_PROCESSORS.test(head)) flags.push({ code: 'MADE_ON_COMPUTER', level: 'warn', message: 'This PDF was created in a word processor, not scanned or photographed from paper.' });
  if (input.mime !== 'application/pdf') {
    const size = imageSize(input.buffer);
    if (size && Math.min(size.w, size.h) < 700) flags.push({ code: 'LOW_RESOLUTION', level: 'info', message: `The picture is small (${size.w}×${size.h} pixels), so small print and stamps may not be checkable.` });
  }
  return flags;
}
