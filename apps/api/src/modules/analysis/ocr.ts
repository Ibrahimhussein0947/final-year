import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * OCR for CVs that are a photo or a scan, so there is no text layer to read.
 *
 * Tesseract (WebAssembly build, no system install) reads English. The language file is downloaded once on first use
 * and kept in `ocr-data/`; set OCR_LANG_PATH to a folder that already holds `eng.traineddata` to run fully offline.
 * Scanned PDFs are drawn page by page with pdf.js and a prebuilt canvas, then read like a photo.
 *
 * Cost control: one OCR job at a time per server (the rest wait), at most 4 pages, pages drawn at a size that is
 * readable but not huge, and a hard time limit. A CV that needs more than that should be uploaded as a text PDF.
 */
const MAX_PAGES = 4;
const MAX_CHARS = 40_000;
const TIMEOUT_MS = 90_000;
const RENDER_WIDTH = 1600; // px; about 200 dpi for an A4 page
const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_QUEUE = 5;

export interface OcrResult {
  text: string;
  pages: number;
  confidence: number | null; // average word confidence 0..100, as reported by Tesseract
}

const cachePath = process.env.OCR_LANG_PATH ?? path.resolve(__dirname, '../../../ocr-data');

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_QUEUE) throw new AppError(429, 'OCR_BUSY', 'Many CVs are being read right now. Please try again in a minute.');
  waiting++;
  const run = queue.then(job, job).finally(() => { waiting--; });
  queue = run.catch(() => undefined);
  return run;
}

type Canvas = { width: number; height: number; getContext: (t: '2d') => unknown; toBuffer: (mime: 'image/png') => Buffer };
type CanvasLib = { createCanvas: (w: number, h: number) => Canvas; loadImage: (b: Buffer) => Promise<{ width: number; height: number }> };

async function readImages(images: Buffer[]): Promise<OcrResult> {
  fs.mkdirSync(cachePath, { recursive: true });
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, { cachePath, logger: () => undefined });
  try {
    const parts: string[] = [];
    const confs: number[] = [];
    for (const img of images) {
      const { data } = await worker.recognize(img);
      parts.push(data.text);
      if (typeof data.confidence === 'number') confs.push(data.confidence);
    }
    return {
      text: parts.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS),
      pages: images.length,
      confidence: confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null,
    };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError(422, 'OCR_TIMEOUT', 'Reading this CV took too long. Try a clearer or smaller picture, or a text PDF.')), TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function failure(err: unknown): never {
  if (err instanceof AppError) throw err;
  logger.warn({ err: String(err) }, 'ocr failed');
  throw new AppError(422, 'OCR_FAILED', 'Could not read the text in this file. Try a clearer picture, or fill in your profile by hand.');
}

/** A JPEG or PNG photo or scan of a CV. */
export function ocrImage(data: Buffer): Promise<OcrResult> {
  return oneAtATime(async () => {
    try {
      const { loadImage } = (await import('@napi-rs/canvas')) as unknown as CanvasLib;
      const img = await loadImage(data);
      if (img.width * img.height > MAX_IMAGE_PIXELS) throw new AppError(422, 'IMAGE_TOO_LARGE', 'This picture is too large to read. Use a smaller photo (under about 25 megapixels).');
      return await withTimeout(readImages([data]));
    } catch (err) {
      return failure(err);
    }
  });
}

/** A PDF whose pages are pictures. Pages are drawn at a fixed width and read in order. */
export function ocrPdf(data: Buffer): Promise<OcrResult> {
  return oneAtATime(async () => {
    try {
      const { createCanvas } = (await import('@napi-rs/canvas')) as unknown as CanvasLib;
      const specifier = 'pdfjs-dist/legacy/build/pdf.mjs';
      const pdfjs = (await import(/* @vite-ignore */ specifier)) as {
        getDocument: (s: Record<string, unknown>) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> }; cleanup: () => void }>; destroy: () => Promise<void> }> };
      };
      const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false, enableXfa: false, verbosity: 0 }).promise;
      const images: Buffer[] = [];
      try {
        const pages = Math.min(doc.numPages, MAX_PAGES);
        for (let n = 1; n <= pages; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          images.push(canvas.toBuffer('image/png'));
          page.cleanup();
        }
        const result = await withTimeout(readImages(images));
        return { ...result, pages: doc.numPages };
      } finally {
        await doc.destroy().catch(() => undefined);
      }
    } catch (err) {
      return failure(err);
    }
  });
}
