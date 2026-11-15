import { AppError } from '../../lib/errors';

const MAX_PAGES = 15;
const MAX_CHARS = 40_000;
const TIMEOUT_MS = 15_000;

type PdfJs = {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc>; destroy: () => Promise<void> };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string; transform?: number[]; hasEOL?: boolean }[] }>; cleanup: () => void }>; destroy: () => Promise<void> };

let lib: Promise<PdfJs> | null = null;
/**
 * pdf.js ships as an ES module only. Node 22.12+ can load ES modules from CommonJS, and the test runner and
 * tsx handle it natively, so a plain dynamic import works everywhere we run (Node 20 would need a newer runtime).
 */
function loadPdfJs(): Promise<PdfJs> {
  const specifier = 'pdfjs-dist/legacy/build/pdf.mjs';
  lib ??= import(/* @vite-ignore */ specifier) as Promise<PdfJs>;
  return lib;
}

/**
 * Plain text of a PDF, one line per visual row. Limits keep hostile or huge files from tying up the server:
 * at most 15 pages, 40 000 characters and 15 seconds, with scripting, eval and font loading switched off.
 * (For full isolation run this in a separate process or worker; planned for deployment, Phase 14.)
 */
export async function extractPdfText(data: Buffer): Promise<{ text: string; pages: number }> {
  if (data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError(422, 'UNREADABLE_PDF', 'This file is not a readable PDF');
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    verbosity: 0,
  });

  const work = (async () => {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const out: string[] = [];
    let total = 0;
    for (let p = 1; p <= pages && total < MAX_CHARS; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Group text fragments into rows by their vertical position, then read each row left to right.
      const rows = new Map<number, { x: number; s: string }[]>();
      for (const it of content.items) {
        if (!it.str || !it.transform) continue;
        const y = Math.round(it.transform[5] / 3) * 3;
        const row = rows.get(y) ?? [];
        row.push({ x: it.transform[4], s: it.str });
        rows.set(y, row);
      }
      const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
      const chunk = lines.join('\n');
      out.push(chunk);
      total += chunk.length;
      page.cleanup();
    }
    await doc.destroy();
    return { text: out.join('\n').slice(0, MAX_CHARS), pages: doc.numPages };
  })();

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError(422, 'PDF_TIMEOUT', 'This PDF took too long to read')), TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([work, timeout]);
    if (result.text.replace(/\s/g, '').length < 40) {
      throw new AppError(422, 'NO_TEXT', 'No readable text was found. This looks like a scanned or image-only PDF, which needs OCR.');
    }
    return result;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(422, 'UNREADABLE_PDF', 'This file is not a readable PDF');
  } finally {
    clearTimeout(timer);
    void task.destroy().catch(() => undefined);
  }
}
