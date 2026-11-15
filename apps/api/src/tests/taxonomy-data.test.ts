import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { categories, relations, skills } from '../../prisma/seed/data';

describe('seeded categories, skills and relations', () => {
  it('has unique category and skill slugs', () => {
    expect(new Set(categories.map((c) => c.slug)).size).toBe(categories.length);
    expect(new Set(skills.map((s) => s[0])).size).toBe(skills.length);
  });

  it('gives every category at least 4 skills, so employers can name a required skill and workers can list one', () => {
    const count = new Map<string, number>();
    for (const s of skills) count.set(s[1], (count.get(s[1]) ?? 0) + 1);
    for (const c of categories) expect(count.get(c.slug) ?? 0, c.slug).toBeGreaterThanOrEqual(4);
    for (const slug of count.keys()) expect(categories.some((c) => c.slug === slug), `skill category ${slug}`).toBe(true);
  });

  it('only relates skills that exist, with weights between 0 and 1 and no skill related to itself', () => {
    const slugs = new Set(skills.map((s) => s[0]));
    for (const [a, b, , w] of relations) {
      expect(slugs.has(a), a).toBe(true);
      expect(slugs.has(b), b).toBe(true);
      expect(a).not.toBe(b);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('is mirrored by the category list the web app shows (same slugs, same names)', () => {
    const web = readFileSync(join(__dirname, '../../../web/src/lib/taxonomy.ts'), 'utf8');
    const entries = [...web.matchAll(/\{ slug: '([a-z-]+)', name: '([^']+)', icon:/g)].map((m) => [m[1], m[2]]);
    expect(entries.map((e) => e[0]).sort()).toEqual(categories.map((c) => c.slug).sort());
    for (const [slug, name] of entries) expect(categories.find((c) => c.slug === slug)?.en).toBe(name);
  });
});
