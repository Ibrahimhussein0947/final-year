// Checks the built app (dist/) is installable and that the service worker cannot cache private data.
// Run after `vite build`: npm run pwa:verify -w @ethiotalent/web
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };

const manifestPath = join(dist, 'manifest.webmanifest');
need(existsSync(manifestPath), 'manifest.webmanifest missing');
need(existsSync(join(dist, 'sw.js')), 'sw.js missing');

if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'background_color', 'theme_color']) need(m[k], `manifest.${k} missing`);
  need(['standalone', 'fullscreen', 'minimal-ui'].includes(m.display), 'manifest.display must be standalone/fullscreen/minimal-ui');
  const icons = m.icons ?? [];
  const has = (size, purpose) => icons.some((i) => i.sizes === size && (purpose ? (i.purpose ?? '').includes(purpose) : true));
  need(has('192x192'), 'no 192x192 icon');
  need(has('512x512'), 'no 512x512 icon');
  need(has('512x512', 'maskable'), 'no maskable 512x512 icon');
  for (const i of icons) need(existsSync(join(dist, i.src)), `icon file missing: ${i.src}`);
}

if (existsSync(join(dist, 'sw.js'))) {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  need(sw.includes('index.html'), 'index.html is not in the precache list');
  // No API route may be handled by a runtime caching rule.
  const routes = [...sw.matchAll(/registerRoute\(([^\n]{0,200})/g)].map((x) => x[1]);
  for (const r of routes) need(!/api|socket\.io/.test(r) || /NavigationRoute|denylist/.test(r), `a caching route mentions the API: ${r.slice(0, 80)}`);
  const precache = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((x) => x[1]);
  need(precache.length > 0, 'precache list is empty');
  need(!precache.some((u) => u.startsWith('api/') || u.startsWith('/api/')), 'precache contains an API url');
}
need(readdirSync(dist).some((f) => f.startsWith('workbox-')) || existsSync(join(dist, 'sw.js')), 'workbox runtime missing');

if (problems.length) {
  console.error('PWA check failed:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('PWA check passed.');
