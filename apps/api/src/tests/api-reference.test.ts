import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReference } from '../scripts/api-reference';

describe('docs/api-reference.md', () => {
  it('is up to date with the routes in the code (run `npm run docs:api -w @ethiotalent/api` to refresh)', async () => {
    const file = readFileSync(path.join(__dirname, '..', '..', '..', '..', 'docs', 'api-reference.md'), 'utf8');
    expect(file.replace(/\r\n/g, '\n')).toBe((await buildReference()).replace(/\r\n/g, '\n'));
  });

  it('marks every admin route as admin-only and no route under /admin as public', async () => {
    const text = await buildReference();
    const adminRows = text.split('\n').filter((l) => l.startsWith('| ') && l.includes('`/admin/'));
    expect(adminRows.length).toBeGreaterThan(20);
    for (const row of adminRows) expect(row, row).toContain('admin only');
  });
});
