import { prisma } from '../../lib/prisma';

export interface IndexedSkill {
  id: string;
  name: string;
  categoryId: string;
  /** Names and aliases that can be searched for. */
  terms: string[];
}

export interface SkillHit {
  skillId: string;
  name: string;
  categoryId: string;
  /** The line of text the skill was found in (clipped). */
  evidence: string;
  /** Zero-based line number of the first occurrence. */
  line: number;
  /** Just the sentence around the first occurrence (a line can hold several sentences). */
  sentence: string;
  count: number;
}

let cache: { at: number; value: IndexedSkill[] } | null = null;

/** The skill taxonomy as a searchable list (cached for five minutes). */
export async function loadSkillIndex(): Promise<IndexedSkill[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  const rows = await prisma.skill.findMany({ where: { isActive: true }, select: { id: true, nameEn: true, aliases: true, categoryId: true } });
  const value = rows.map((r) => ({ id: r.id, name: r.nameEn, categoryId: r.categoryId, terms: [r.nameEn, ...r.aliases] }));
  cache = { at: Date.now(), value };
  return value;
}
export const clearSkillIndexCache = () => {
  cache = null;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A match must not sit inside a longer word: "weld" must not match inside "welder's", and "HR" not inside "shrub".
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

interface Compiled { skill: IndexedSkill; normal: RegExp | null; short: RegExp | null }
const compiledCache = new WeakMap<IndexedSkill[], Compiled[]>();

function compile(index: IndexedSkill[]): Compiled[] {
  const hit = compiledCache.get(index);
  if (hit) return hit;
  const out = index.map((skill) => {
    const terms = [...new Set(skill.terms.map((t) => t.trim()).filter((t) => t.length >= 2))];
    // Very short terms ("HR", "JS", "QC", "POS") only count when written in capitals, to avoid false hits.
    const long = terms.filter((t) => t.length > 3);
    const short = terms.filter((t) => t.length <= 3).map((t) => t.toUpperCase());
    return {
      skill,
      // optional plural "s" so "plasterers"/"brakes" still match
      normal: long.length ? new RegExp(`${B}(?:${long.map(escape).join('|')})s?${E}`, 'iu') : null,
      short: short.length ? new RegExp(`${B}(?:${short.map(escape).join('|')})${E}`, 'u') : null,
    };
  });
  compiledCache.set(index, out);
  return out;
}

/** The sentence of `line` that contains position `at` (sentences end at . ; ! ? followed by a space). */
function sentenceAt(line: string, at: number): string {
  const before = line.slice(0, at);
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '), before.lastIndexOf('! '), before.lastIndexOf('? '));
  const rest = line.slice(at);
  const m = rest.match(/[.;!?]\s/);
  return line.slice(start < 0 ? 0 : start + 2, m && m.index !== undefined ? at + m.index + 1 : line.length);
}

const clip = (s: string, n = 140) => (s.trim().length > n ? `${s.trim().slice(0, n - 1)}…` : s.trim());

/** Every taxonomy skill that is mentioned in the text, with the line it was found in. Pure: no database access. */
export function findSkills(text: string, index: IndexedSkill[]): SkillHit[] {
  const lines = text.split(/\r?\n/);
  const hits: SkillHit[] = [];
  for (const c of compile(index)) {
    let first = -1;
    let firstAt = 0;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = (c.normal && lines[i].match(c.normal)) || (c.short && lines[i].match(c.short));
      if (m) {
        if (first < 0) { first = i; firstAt = m.index ?? 0; }
        count++;
      }
    }
    if (first >= 0) {
      hits.push({ skillId: c.skill.id, name: c.skill.name, categoryId: c.skill.categoryId, evidence: clip(lines[first]), line: first, sentence: sentenceAt(lines[first], firstAt), count });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}
