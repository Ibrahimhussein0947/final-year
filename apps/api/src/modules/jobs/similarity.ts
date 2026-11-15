import { createHash } from 'node:crypto';

export const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Stable fingerprint of a posting, used to spot exact copy-paste duplicates. */
export const jobFingerprint = (title: string, description: string) =>
  createHash('sha256').update(`${normalize(title)}\n${normalize(description)}`).digest('hex');

const words = (s: string) => new Set(normalize(s).split(' ').filter((w) => w.length > 2));

/** Jaccard similarity of word sets, 0..1. Cheap and good enough to catch lightly edited reposts. */
export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
