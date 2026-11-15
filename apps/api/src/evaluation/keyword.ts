/**
 * Baseline 1: plain keyword retrieval (BM25) over the free text of a job and of each worker profile.
 * It knows nothing about skill relations, experience, location or education: it is what a simple search box would do.
 */
const STOP = new Set('a an and are as at be by for from has have in is it of on or the to with we our you your their will who that this can must should job work worker looking need needed required experience years year good able also not'.split(' '));

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t)).map(stem);
}

/** Very light stemming so "welding" and "welder" meet. */
function stem(t: string): string {
  for (const suf of ['ing', 'ers', 'er', 'ion', 'ed', 's']) if (t.length > suf.length + 3 && t.endsWith(suf)) return t.slice(0, -suf.length);
  return t;
}

export interface Bm25Doc { id: string; text: string }

export function bm25Rank(query: string, docs: Bm25Doc[], k1 = 1.5, b = 0.75): string[] {
  const toks = docs.map((d) => tokenize(d.text));
  const avg = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, toks.length);
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  const q = [...new Set(tokenize(query))];
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const w of toks[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks[i].length) / avg)));
    }
    return { id: d.id, s };
  });
  // ties broken by id so the baseline is deterministic
  return scored.sort((a, c) => c.s - a.s || a.id.localeCompare(c.id)).map((x) => x.id);
}
