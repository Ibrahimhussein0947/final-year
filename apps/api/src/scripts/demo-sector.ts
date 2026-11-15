/**
 * Creates demo accounts and one sector-criteria job in a LOCAL development API, so the Phase 15 screens can be tried:
 *   npm run demo:sector -w @ethiotalent/api        (the API must be running: npm run dev -w @ethiotalent/api)
 *
 * Safe to run twice (it signs in when an account exists). It refuses to talk to anything but localhost.
 * DEV ONLY: the password below is a throwaway for local demo accounts; never use it anywhere real.
 */
const API = process.env.DEMO_API_URL ?? 'http://localhost:4100/api/v1';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(API)) {
  console.error('Refusing to run: the demo script only talks to a local API.');
  process.exit(1);
}
const DEMO_PASSWORD = 'DemoPass123';

const ACCOUNTS = {
  employer: { phone: '0911000101', name: 'Selam Logistics HR' },
  licensed: { phone: '0911000102', name: 'Kebede Alemu' },
  unlicensed: { phone: '0911000103', name: 'Mulu Tesfaye' },
};

async function call<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; data: T }> {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}
const ok = async <T = any>(p: Promise<{ status: number; data: T }>, what: string): Promise<T> => {
  const r = await p;
  if (r.status >= 400) throw new Error(`${what} failed (${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
};

async function account(role: 'WORKER' | 'EMPLOYER', phone: string, fullName: string, extra: Record<string, unknown> = {}): Promise<string> {
  const reg = await call('POST', '/auth/register', { fullName, phone, password: DEMO_PASSWORD, role, region: 'Oromia', zone: 'Adama', language: 'en', ...extra });
  if (reg.status === 201) return reg.data.accessToken;
  const login = await ok(call('POST', '/auth/login', { phone, password: DEMO_PASSWORD }), `sign in ${phone}`);
  return login.accessToken;
}

async function main() {
  const [defs, cats, adama, heavy] = await Promise.all([
    ok(call('GET', '/criteria'), 'criteria'),
    ok(call('GET', '/categories'), 'categories'),
    (async () => {
      const regions = (await ok(call('GET', '/locations'), 'regions')).items as { id: string; nameEn: string }[];
      const zones = (await ok(call('GET', `/locations?parentId=${regions.find((r) => r.nameEn === 'Oromia')!.id}`), 'zones')).items as { id: string; nameEn: string }[];
      return zones.find((z) => z.nameEn === 'Adama')!.id;
    })(),
    ok(call('GET', '/skills?q=heavy'), 'skills').then((r) => r.items[0].id as string),
  ]);
  const id = (key: string) => (defs.items as { id: string; key: string; category: { slug: string } | null }[]).find((d) => `${d.category?.slug ?? 'all'}.${d.key}` === key)!.id;
  const transport = (cats.items as { id: string; slug: string }[]).find((c) => c.slug === 'transport')!.id;

  const employer = await account('EMPLOYER', ACCOUNTS.employer.phone, ACCOUNTS.employer.name, { organizationName: 'Selam Logistics', organizationType: 'SME' });
  for (const [who, headline, answers] of [
    [ACCOUNTS.licensed, 'Long-distance truck driver', [{ criterionId: id('transport.vehicle_types'), value: ['truck', 'trailer'] }, { criterionId: id('transport.licence_years'), value: 8 }, { criterionId: id('all.shifts'), value: ['day', 'night'] }]],
    [ACCOUNTS.unlicensed, 'Taxi and minibus driver', [{ criterionId: id('transport.vehicle_types'), value: ['light', 'minibus'] }, { criterionId: id('transport.licence_years'), value: 4 }]],
  ] as const) {
    const token = await account('WORKER', who.phone, who.name);
    await ok(call('PATCH', '/workers/me', { categoryId: transport, headline, yearsExperience: 6, availability: 'IMMEDIATELY', locationId: adama }, token), 'profile');
    await ok(call('PUT', `/workers/me/skills/${heavy}`, { proficiency: 4 }, token), 'skill');
    await ok(call('PUT', '/workers/me/criteria', { items: answers }, token), 'sector answers');
  }

  const title = 'Heavy truck driver, Adama to Djibouti';
  const mine = (await ok(call('GET', '/jobs/mine', undefined, employer), 'my jobs')).items as { id: string; title: string }[];
  let jobId = mine.find((j) => j.title === title)?.id;
  if (!jobId) {
    const created = await ok(call('POST', '/jobs', {
      title, description: 'We need an experienced heavy truck driver for regular trips from Adama to Djibouti. You will drive, check and report on the truck and cargo. Night driving is part of the work. Apply with your references.',
      categoryId: transport, employmentType: 'FULL_TIME', locationId: adama, minExperienceYears: 3,
      deadline: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10), skills: [{ skillId: heavy, importance: 'REQUIRED' }],
      criteria: [
        { criterionId: id('transport.vehicle_types'), importance: 'MUST_HAVE', value: ['truck'] },
        { criterionId: id('transport.licence_years'), importance: 'PREFERRED', value: 3 },
        { criterionId: id('all.shifts'), importance: 'PREFERRED', value: ['night'] },
      ],
    }, employer), 'create job');
    jobId = created.job.id as string;
    await ok(call('POST', `/jobs/${jobId}/publish`, {}, employer), 'publish job');
  }

  console.log('Demo ready (local only).');
  console.log(`  Employer:           ${ACCOUNTS.employer.phone}   (${ACCOUNTS.employer.name})`);
  console.log(`  Worker with licence: ${ACCOUNTS.licensed.phone}   (${ACCOUNTS.licensed.name}) -> eligible, recommended`);
  console.log(`  Worker without it:   ${ACCOUNTS.unlicensed.phone}   (${ACCOUNTS.unlicensed.name}) -> not eligible`);
  console.log(`  Password for all three: see DEMO_PASSWORD in apps/api/src/scripts/demo-sector.ts`);
  console.log(`  Job page: http://localhost:5173/jobs/${jobId}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
