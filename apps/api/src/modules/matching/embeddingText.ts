/**
 * Text that represents a profile or a posting to the embedding model. The model only reads the first ~128 word
 * pieces, so the most informative parts (title, occupation, skills) come first and long text is cut off.
 */
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export const workerText = (w: { headline: string | null; occupation: string | null; bio: string | null; skills: string[] }) =>
  clip(
    [clean(w.headline), clean(w.occupation), w.skills.length ? `Skills: ${w.skills.join(', ')}` : '', clean(w.bio)].filter(Boolean).join('. '),
    1500,
  );

export const jobText = (j: { title: string; description: string; skills: { name: string; required: boolean }[] }) =>
  clip(
    [
      clean(j.title),
      j.skills.length ? `Skills: ${[...j.skills].sort((a, b) => Number(b.required) - Number(a.required)).map((s) => s.name).join(', ')}` : '',
      clean(j.description),
    ].filter(Boolean).join('. '),
    1500,
  );

export const skillText = (s: { nameEn: string; aliases: string[] }) => [s.nameEn, ...s.aliases].join(', ');

/**
 * The multilingual model was measured (apps/ai/evaluation/multilingual_probe.py) and is NOT reliable for Amharic:
 * different occupations written in Amharic scored almost as similar as the same occupation (mean cosine 0.585 vs 0.691,
 * top-1 accuracy 0.25 against 0.875 for English). Letting those similarities lift a match score would add noise, so texts
 * written mostly in Ethiopic script are not embedded and such profiles/jobs are matched by the rules alone.
 * Afaan Oromoo (Latin script, also weak in the probe) cannot be told apart from English by script and is NOT guarded here.
 */
const ETHIOPIC = /[ሀ-᎟ⶀ-⷟꬀-꬯]/g;
const LETTER = /\p{L}/gu;
export function isMostlyEthiopic(...parts: (string | null | undefined)[]): boolean {
  const text = parts.filter(Boolean).join(' ');
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return false;
  return (text.match(ETHIOPIC)?.length ?? 0) / letters > 0.3;
}
