import { describe, expect, it } from 'vitest';
import { categories, skills } from '../../prisma/seed/data';
import { criteria } from '../../prisma/seed/criteria';
import { detectDiscrimination } from '../modules/criteria/discrimination';

// Quality checks on the seeded sector criteria. They run without a database. They cannot show that the criteria are
// RIGHT for a sector (that needs sector experts), only that the list is consistent and stays job-related.

const KEY = /^[a-z][a-z0-9_]{1,39}$/;
const OPTION = /^[a-z0-9][a-z0-9_]{0,39}$/;
const slugs = new Set(categories.map((c) => c.slug));

describe('seeded sector criteria: structure', () => {
  it('has a unique key per sector, and valid keys', () => {
    const seen = new Set<string>();
    for (const c of criteria) {
      expect(c.key, c.key).toMatch(KEY);
      const id = `${c.category ?? 'all'}.${c.key}`;
      expect(seen.has(id), `duplicate ${id}`).toBe(false);
      seen.add(id);
    }
  });

  it('refers only to sectors that exist', () => {
    for (const c of criteria) if (c.category) expect(slugs.has(c.category), `${c.key}: unknown sector ${c.category}`).toBe(true);
  });

  it('gives choice questions at least two distinct, well-formed options, and others none', () => {
    for (const c of criteria) {
      const where = `${c.category ?? 'all'}.${c.key}`;
      if (c.type === 'CHOICE' || c.type === 'MULTI_CHOICE') {
        expect(c.options?.length ?? 0, where).toBeGreaterThanOrEqual(2);
        const values = c.options!.map((o) => o.value);
        expect(new Set(values).size, `${where}: duplicate option values`).toBe(values.length);
        for (const o of c.options!) {
          expect(o.value, where).toMatch(OPTION);
          expect(o.labelEn.trim().length, `${where}: empty option label`).toBeGreaterThan(0);
        }
      } else {
        expect(c.options, `${where}: only choice questions have options`).toBeUndefined();
      }
      if (c.type === 'NUMBER') {
        expect(c.min, where).toBeDefined();
        expect(c.max, where).toBeDefined();
        expect(c.min!, where).toBeLessThan(c.max!);
        expect(c.unit, `${where}: a number needs a unit`).toBeTruthy();
      }
    }
  });

  it('has readable labels, and no leading or trailing spaces', () => {
    for (const c of criteria) {
      expect(c.labelEn.length, c.key).toBeGreaterThanOrEqual(8);
      expect(c.labelEn.length, c.key).toBeLessThanOrEqual(150);
      expect(c.labelEn, c.key).toBe(c.labelEn.trim());
    }
  });

  it('covers every sector with enough questions to be useful', () => {
    const per = new Map<string, number>();
    for (const c of criteria) per.set(c.category ?? 'all', (per.get(c.category ?? 'all') ?? 0) + 1);
    for (const s of slugs) expect(per.get(s) ?? 0, `sector ${s} has too few criteria`).toBeGreaterThanOrEqual(5);
    expect(per.get('all')).toBeGreaterThanOrEqual(3);
  });

  it('never offers verification for a single free choice (a document proves a fact, not a preference)', () => {
    for (const c of criteria.filter((x) => x.evidence)) expect(c.type, `${c.key}`).not.toBe('CHOICE');
  });
});

describe('seeded sector criteria: job-related only', () => {
  const text = (c: (typeof criteria)[number]) => [c.labelEn, c.helpEn, ...(c.options ?? []).map((o) => o.labelEn)].filter(Boolean).join(' | ');
  // Who a person IS must never be a criterion. "work at height" and "older people" (a client group) are job-related and allowed.
  const PROTECTED = /\b(gender|sex|age|aged|religion|religious|ethnic|ethnicity|tribe|tribal|marital|married|single|pregnan\w*|nationality|race|racial|appearance|attractive|good-looking|disabled|disability status)\b/i;

  it('contains no wording about gender, age, religion, ethnicity, marital status or appearance', () => {
    for (const c of criteria) {
      // 'People with disabilities' (a client group served) and 'Gender studies' (an academic field) are not requirements on a person
      const t = text(c).replace(/People with disabilities/g, '').replace(/Gender studies/g, '');
      expect(PROTECTED.test(t), `${c.category ?? 'all'}.${c.key}: ${t}`).toBe(false);
    }
  });

  it('passes the same text guard that protects job posts', () => {
    for (const c of criteria) expect(detectDiscrimination(text(c)), `${c.key}`).toEqual([]);
  });
});

describe('sectors added in the second pass have the skills a job needs', () => {
  it('every sector has at least 5 skills, so a job in it can always list a required skill', () => {
    const per = new Map<string, number>();
    for (const [, cat] of skills) per.set(cat, (per.get(cat) ?? 0) + 1);
    for (const s of slugs) expect(per.get(s) ?? 0, `sector ${s}`).toBeGreaterThanOrEqual(5);
  });
});
