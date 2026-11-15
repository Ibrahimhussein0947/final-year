/**
 * Generates docs/api-reference.md from the running Express router (so the list cannot drift from the code):
 *   npm run docs:api -w @ethiotalent/api
 * Lists every route with its access rule. Request and response shapes are NOT generated here: they are the Zod
 * schemas in each module's schema.ts (linked per route group).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Layer { name: string; route?: { path: string; methods: Record<string, boolean>; stack: { name: string }[] }; handle?: { stack?: Layer[] } }

function access(names: string[]): string {
  const roles = names.find((n) => n.startsWith('requireRole:'))?.slice('requireRole:'.length);
  if (roles) return `signed in, ${roles.split('|').join(' or ').toLowerCase()} only`;
  if (names.includes('requireAuth')) return 'signed in';
  if (names.includes('optionalAuth')) return 'public (signed-in users get extra fields)';
  return 'public';
}

export async function buildReference(): Promise<string> {
  const { createApp } = await import('../app');
  const app = createApp() as unknown as { router: { stack: Layer[] } };
  const appSrc = readFileSync(path.join(__dirname, '..', 'app.ts'), 'utf8');
  const mounts = [...appSrc.matchAll(/app\.use\('([^']+)',\s*(\w+Router)\(/g)].map((m) => ({ prefix: m[1], fn: m[2] }));
  const files = Object.fromEntries([...appSrc.matchAll(/import \{ (\w+Router) \} from '\.\/modules\/([\w/]+)'/g)].map((m) => [m[1], `apps/api/src/modules/${m[2]}.ts`]));
  const routerLayers = app.router.stack.filter((l) => l.name === 'router');
  if (routerLayers.length !== mounts.length) throw new Error(`Cannot pair ${routerLayers.length} routers with ${mounts.length} mounts`);

  const out: string[] = [];
  out.push('# API reference');
  out.push('');
  out.push('Generated from the code by `npm run docs:api -w @ethiotalent/api` (a test fails if this file is out of date). Base URL: `/api/v1`. Errors have the shape `{ "error": { "code", "message", "details?" } }`.');
  out.push('');
  out.push('**What is and is not here.** Every route, its method, and who may call it come from the running router. Request and response bodies are defined by the Zod schemas in the module files named below (`schema.ts` next to each `routes.ts`); they are not duplicated here, so they cannot go stale. Authentication: send `Authorization: Bearer <access token>` from `POST /auth/login` or `/auth/register`; tokens last 15 minutes and are renewed with `POST /auth/refresh` (cookie + `X-CSRF-Protection: 1` header). Role checks read the role from the database.');
  out.push('');
  out.push('Also served outside `/api/v1`: `GET /health` (checks the database), and WebSocket (Socket.IO) at `/socket.io` for live messages and notifications (authenticate with `auth: { token }`).');
  out.push('');
  let total = 0;
  routerLayers.forEach((layer, i) => {
    const { prefix, fn } = mounts[i];
    const sub = layer.handle?.stack ?? [];
    const guards = sub.filter((l) => !l.route).map((l) => l.name);
    const rows: string[] = [];
    for (const l of sub) {
      if (!l.route) continue;
      const names = [...guards, ...l.route.stack.map((s) => s.name)];
      for (const method of Object.keys(l.route.methods)) {
        const full = `${prefix}${l.route.path === '/' ? '' : l.route.path}`.replace('/api/v1', '') || '/';
        rows.push(`| ${method.toUpperCase()} | \`${full}\` | ${access(names)} |`);
        total++;
      }
    }
    out.push(`## ${fn.replace('Router', '')} — \`${files[fn] ?? ''}\``);
    out.push('');
    out.push('| Method | Path | Access |');
    out.push('|---|---|---|');
    out.push(...rows);
    out.push('');
  });
  out.push(`Total: ${total} routes.`);
  out.push('');
  return out.join('\n');
}

if (require.main === module) {
  buildReference().then((text) => {
    writeFileSync(path.join(__dirname, '..', '..', '..', '..', 'docs', 'api-reference.md'), text);
    console.log(text.split('\n').slice(-3).join('\n'));
    process.exit(0);
  });
}
