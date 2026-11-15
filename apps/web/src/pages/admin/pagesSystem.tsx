import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { downloadProtected, useAdminAction, useAdminQuery, type AuditItem, type CategoryRow, type Paged, type SkillRow } from '@/lib/admin';
import { api } from '@/lib/api';
import { LOCALES, type Locale } from '@/i18n';
import en from '@/i18n/en.json';
import am from '@/i18n/am.json';
import om from '@/i18n/om.json';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const ErrorLine = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-2 text-sm text-danger">{text}</p> : null);
const sel = 'h-9 rounded-lg border border-border bg-surface px-2 text-sm';
const inp = 'h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm';

// ───────── Skills and categories ─────────

function SkillEditor({ s, cats }: { s: SkillRow; cats: CategoryRow[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ nameEn: s.nameEn, nameAm: s.nameAm ?? '', nameOm: s.nameOm ?? '', aliases: s.aliases.join(', '), categoryId: s.categoryId });
  const save = useAdminAction(() => api(`/admin/skills/${s.id}`, { method: 'PATCH', body: { nameEn: f.nameEn, nameAm: f.nameAm || null, nameOm: f.nameOm || null, categoryId: f.categoryId, aliases: f.aliases.split(',').map((a) => a.trim()).filter(Boolean) } }), { invalidate: ['skills'] });
  const toggle = useAdminAction(() => api(`/admin/skills/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } }), { invalidate: ['skills'] });
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><span className="font-medium">{s.nameEn}</span> <span className="text-xs text-muted">{s.category} · {s.workers} workers · {s.jobs} jobs</span>{!s.isActive && <> <Badge tone="warning">hidden</Badge></>}</div>
        <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Edit'}</Button><Button size="sm" variant="outline" loading={toggle.isPending} onClick={() => toggle.mutate()}>{s.isActive ? 'Hide' : 'Show'}</Button></div>
      </div>
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input aria-label="Name" className={inp} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
          <select aria-label="Category" className={sel} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select>
          <input aria-label="Amharic name" className={inp} placeholder="Amharic name" value={f.nameAm} onChange={(e) => setF({ ...f, nameAm: e.target.value })} />
          <input aria-label="Afaan Oromoo name" className={inp} placeholder="Afaan Oromoo name" value={f.nameOm} onChange={(e) => setF({ ...f, nameOm: e.target.value })} />
          <input aria-label="Aliases" className={`${inp} sm:col-span-2`} placeholder="Other words people use, separated by commas" value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} />
          <div className="sm:col-span-2"><Button size="sm" variant="accent" loading={save.isPending} onClick={() => save.mutate()}>Save skill</Button><ErrorLine text={save.error} /></div>
        </div>
      )}
      <ErrorLine text={toggle.error} />
    </li>
  );
}

export function AdminTaxonomy() {
  const cats = useAdminQuery<{ items: CategoryRow[] }>(['categories'], '/categories');
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(catFilter ? { categoryId: catFilter } : {}), page: String(pageNo), pageSize: '15' }).toString();
  const skills = useAdminQuery<Paged<SkillRow>>(['skills', qs], `/skills?${qs}`);
  const [newCat, setNewCat] = useState('');
  const [newSkill, setNewSkill] = useState({ nameEn: '', categoryId: '', aliases: '' });
  const addCat = useAdminAction(() => api('/admin/categories', { method: 'POST', body: { nameEn: newCat } }), { invalidate: ['categories'] });
  const addSkill = useAdminAction(() => api('/admin/skills', { method: 'POST', body: { nameEn: newSkill.nameEn, categoryId: newSkill.categoryId, aliases: newSkill.aliases.split(',').map((a) => a.trim()).filter(Boolean) } }), { invalidate: ['skills', 'categories'] });
  const toggleCat = useAdminAction((c: CategoryRow) => api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }), { invalidate: ['categories'] });
  const pages = skills.data ? Math.max(1, Math.ceil(skills.data.total / skills.data.pageSize)) : 1;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-semibold">Categories</h2>
        <p className="text-xs text-muted">Hiding a category removes it from search filters and job forms; existing jobs keep working.</p>
        {cats.isLoading && <Skeleton className="mt-3 h-32" />}
        <ul className="mt-3 divide-y divide-border">
          {cats.data?.items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>{c.nameEn} <span className="text-xs text-muted">{c.skills} skills · {c.jobs} jobs</span>{!c.isActive && <> <Badge tone="warning">hidden</Badge></>}</span>
              <Button size="sm" variant="outline" onClick={() => toggleCat.mutate(c)}>{c.isActive ? 'Hide' : 'Show'}</Button>
            </li>
          ))}
        </ul>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addCat.mutate(undefined, { onSuccess: () => setNewCat('') }); }}>
          <input aria-label="New category name" className={inp} placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <Button size="sm" variant="accent" type="submit" disabled={newCat.trim().length < 2} loading={addCat.isPending}>Add</Button>
        </form>
        <ErrorLine text={addCat.error ?? toggleCat.error} />
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Skills</h2>
        <p className="text-xs text-muted">Aliases are other words people use for the same skill; they are used to recognise skills in job texts and CVs.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <TextField label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPageNo(1); }} />
          <label className="text-sm font-medium">Category<select className={`${sel} mt-1.5 w-full`} value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPageNo(1); }}><option value="">All</option>{cats.data?.items.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select></label>
        </div>
        {skills.isLoading && <Skeleton className="mt-3 h-40" />}
        <ul className="mt-3 divide-y divide-border">{skills.data?.items.map((s) => <SkillEditor key={s.id + s.nameEn + s.aliases.join()} s={s} cats={cats.data?.items ?? []} />)}</ul>
        {skills.data && pages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <Button size="sm" variant="outline" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>Previous</Button>
            <span className="text-muted">{pageNo} / {pages}</span>
            <Button size="sm" variant="outline" disabled={pageNo >= pages} onClick={() => setPageNo(pageNo + 1)}>Next</Button>
          </div>
        )}
        <form className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); addSkill.mutate(undefined, { onSuccess: () => setNewSkill({ nameEn: '', categoryId: newSkill.categoryId, aliases: '' }) }); }}>
          <input aria-label="New skill name" className={inp} placeholder="New skill" value={newSkill.nameEn} onChange={(e) => setNewSkill({ ...newSkill, nameEn: e.target.value })} />
          <select aria-label="Category for the new skill" className={sel} value={newSkill.categoryId} onChange={(e) => setNewSkill({ ...newSkill, categoryId: e.target.value })}><option value="">Category…</option>{cats.data?.items.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}</select>
          <input aria-label="Aliases" className={`${inp} sm:col-span-2`} placeholder="Aliases, separated by commas (optional)" value={newSkill.aliases} onChange={(e) => setNewSkill({ ...newSkill, aliases: e.target.value })} />
          <div className="sm:col-span-2"><Button size="sm" variant="accent" type="submit" disabled={newSkill.nameEn.trim().length < 2 || !newSkill.categoryId} loading={addSkill.isPending}>Add skill</Button><ErrorLine text={addSkill.error} /></div>
        </form>
      </Card>
    </div>
  );
}

// ───────── Translations ─────────

const BUNDLED: Record<Locale, Record<string, string>> = { en: en as Record<string, string>, am: am as Record<string, string>, om: om as Record<string, string> };

export function AdminTranslations() {
  const [locale, setLocale] = useState<Locale>('am');
  const list = useAdminQuery<{ items: { key: string; locale: string; value: string; updatedAt: string }[] }>(['translations', locale], `/translations?locale=${locale}`);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const save = useAdminAction(() => api('/admin/translations', { method: 'PUT', body: { key: key.trim(), locale, value } }), { invalidate: ['translations'] });
  const del = useAdminAction((k: string) => api(`/admin/translations/${locale}/${encodeURIComponent(k)}`, { method: 'DELETE' }), { invalidate: ['translations'] });
  const bundled = BUNDLED[locale][key] ?? BUNDLED.en[key];
  const keys = Object.keys(BUNDLED.en).filter((k) => !k.startsWith('_'));
  useEffect(() => { setKey(''); setValue(''); }, [locale]);

  return (
    <div className="space-y-4">
      <Alert tone="info">Text saved here replaces the built-in text for that language everywhere in the app, without a new release. Missing text falls back to the built-in text, then to English. Amharic and Afaan Oromoo built-in text is a draft and needs native-speaker review.</Alert>
      <div className="flex gap-2">{LOCALES.map((l) => <Button key={l.code} size="sm" variant={locale === l.code ? 'accent' : 'outline'} onClick={() => setLocale(l.code)}>{l.label}</Button>)}</div>
      <Card className="p-5">
        <h2 className="font-semibold">Add or change a text</h2>
        <form className="mt-3 grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: () => { setKey(''); setValue(''); } }); }}>
          <label className="text-sm font-medium">Text key<input list="translation-keys" className={`${inp} mt-1.5`} value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. hero.title" /></label>
          <datalist id="translation-keys">{keys.map((k) => <option key={k} value={k} />)}</datalist>
          {bundled && <p className="text-xs text-muted">Built-in text: “{bundled}”</p>}
          <label className="text-sm font-medium">New text<input className={`${inp} mt-1.5`} value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} lang={locale} /></label>
          <div><Button size="sm" variant="accent" type="submit" disabled={!key.trim() || !value.trim()} loading={save.isPending}>Save</Button><ErrorLine text={save.error} /></div>
        </form>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Saved overrides ({LOCALES.find((l) => l.code === locale)?.label})</h2>
        {list.isLoading && <Skeleton className="mt-3 h-20" />}
        {list.data?.items.length === 0 && <p className="mt-2 text-sm text-muted">None yet.</p>}
        <ul className="mt-3 divide-y divide-border text-sm">
          {list.data?.items.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><code className="text-xs">{t.key}</code> → <span lang={locale}>{t.value}</span></span>
              <span className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => { setKey(t.key); setValue(t.value); }}>Edit</Button><Button size="sm" variant="ghost" className="text-danger" onClick={() => del.mutate(t.key)}>Remove</Button></span>
            </li>
          ))}
        </ul>
        <ErrorLine text={del.error} />
      </Card>
    </div>
  );
}

// ───────── Matching weights and recommendation performance ─────────

const COMPONENTS: [string, string][] = [['skills', 'Skills'], ['experience', 'Experience'], ['location', 'Location'], ['qualification', 'Qualification'], ['availability', 'Availability'], ['preferences', 'Pay and preferences'], ['criteria', 'Sector requirements']];
type Weights = Record<string, number>;
interface WeightsResponse { defaults: Weights; global: { weights: Weights; version: number | null }; overrides: { categoryId: string; category: string; version: number; weights: Weights }[] }
interface PerfRow { engineVersion: string; direction: string; recommendations: number; averageScore: number | null; averageConfidence: number | null; appliedPct: number | null; shortlistedPct: number | null; hiredPct: number | null }

function PerfTable({ title, rows }: { title: string; rows: (PerfRow & { label: string })[] }) {
  const pctText = (n: number | null) => (n === null ? 'n/a' : `${n}%`);
  return (
    <div className="mt-4 overflow-x-auto">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead><tr className="border-b border-border text-muted"><th className="py-2">Group</th><th>Shown</th><th>Avg score</th><th>Applied</th><th>Shortlisted</th><th>Hired</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="py-3 text-muted">No recommendations logged yet.</td></tr>}
          {rows.map((r) => <tr key={r.label} className="border-b border-border last:border-0"><td className="py-2">{r.label}</td><td>{r.recommendations}</td><td>{r.averageScore ?? 'n/a'}</td><td>{pctText(r.appliedPct)}</td><td>{pctText(r.shortlistedPct)}</td><td>{pctText(r.hiredPct)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

export function AdminMatching() {
  const cats = useAdminQuery<{ items: CategoryRow[] }>(['categories'], '/categories');
  const w = useAdminQuery<WeightsResponse>(['weights'], '/match-weights');
  const [scope, setScope] = useState('');
  const [pct, setPct] = useState<Weights>({});
  const current = w.data ? (scope ? w.data.overrides.find((o) => o.categoryId === scope)?.weights : undefined) ?? w.data.global.weights : null;
  useEffect(() => {
    if (current) setPct(Object.fromEntries(COMPONENTS.map(([k]) => [k, Math.round((current[k] ?? 0) * 1000) / 10])));
  }, [current, scope]);
  const total = Math.round(Object.values(pct).reduce((s, n) => s + (Number(n) || 0), 0) * 10) / 10;
  const save = useAdminAction(() => api('/admin/match-weights', { method: 'PUT', body: { categoryId: scope || null, weights: Object.fromEntries(COMPONENTS.map(([k]) => [k, (Number(pct[k]) || 0) / 100])) } }), { invalidate: ['weights'] });
  const remove = useAdminAction(() => api(`/admin/match-weights/${scope}`, { method: 'DELETE' }), { invalidate: ['weights'] });
  const perf = useAdminQuery<{ byEngine: PerfRow[]; byScoreBand: (PerfRow & { band: string })[]; feedbackTotals: Record<string, number>; caveats: string[] }>(['ai'], '/analytics/recommendations');
  const hasOverride = !!scope && !!w.data?.overrides.some((o) => o.categoryId === scope);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="font-semibold">Matching weights</h2>
        <p className="mt-1 text-sm text-muted">How much each factor counts in a match score. Changes apply immediately to every new score and are recorded in the activity log. They should add up to 100%.</p>
        <label className="mt-3 block text-sm font-medium">Applies to<select className={`${sel} mt-1.5 w-full max-w-sm`} value={scope} onChange={(e) => setScope(e.target.value)}><option value="">All job categories (default)</option>{cats.data?.items.map((c) => <option key={c.id} value={c.id}>Only: {c.nameEn}{w.data?.overrides.some((o) => o.categoryId === c.id) ? ' (customized)' : ''}</option>)}</select></label>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {COMPONENTS.map(([k, label]) => (
            <label key={k} className="text-sm font-medium">{label} (%)
              <input type="number" min={0} max={100} step={1} className={`${inp} mt-1.5`} value={pct[k] ?? ''} onChange={(e) => setPct({ ...pct, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <p className={`mt-3 text-sm ${Math.abs(total - 100) <= 1 ? 'text-success' : 'text-danger'}`}>Total: {total}%</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="accent" disabled={Math.abs(total - 100) > 1} loading={save.isPending} onClick={() => save.mutate()}>Save weights</Button>
          {hasOverride && <Button size="sm" variant="outline" loading={remove.isPending} onClick={() => remove.mutate()}>Remove this override</Button>}
          <Button size="sm" variant="ghost" onClick={() => w.data && setPct(Object.fromEntries(COMPONENTS.map(([k]) => [k, Math.round(w.data.defaults[k] * 1000) / 10])))}>Use the project defaults</Button>
          {w.data?.global.version && <span className="text-xs text-muted">Default set: version {w.data.global.version}</span>}
        </div>
        <ErrorLine text={save.error ?? remove.error} />
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">How recommendations are performing</h2>
        {perf.isLoading && <Skeleton className="mt-3 h-32" />}
        {perf.data && (
          <>
            <PerfTable title="By engine version" rows={perf.data.byEngine.map((r) => ({ ...r, label: `${r.engineVersion} (${r.direction === 'JOB_TO_WORKER' ? 'workers for a job' : 'jobs for a worker'})` }))} />
            <PerfTable title="By score band" rows={perf.data.byScoreBand.map((r) => ({ ...r, label: r.band }))} />
            <p className="mt-3 text-sm">Logged outcomes: {Object.entries(perf.data.feedbackTotals).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ') || 'none yet'}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">{perf.data.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          </>
        )}
      </Card>
    </div>
  );
}

// ───────── National analytics and exports ─────────

interface National {
  privacy: string; k: number;
  regions: { region: string; openJobs: number | null; vacancies: number | null; visibleWorkers: number | null }[];
  categories: { category: string; openJobs: number | null }[];
  mostRequiredSkills: { skill: string; openJobs: number | null }[];
  popularOccupations: { occupation: string; workers: number }[];
  applicationOutcomes: { decided: number; successRate: number | null; byCategory: { category: string; decided: number | null; successRate: number | null }[]; note: string };
}
const cell = (n: number | null) => (n === null ? <span className="text-muted" title="Hidden: fewer than 5">&lt;5</span> : n);

export function AdminAnalytics() {
  const q = useAdminQuery<National>(['national'], '/analytics/national');
  const [dlError, setDlError] = useState<string | null>(null);
  const exp = (kind: string) => downloadProtected(`/api/v1/admin/export/${kind}`, `${kind}.csv`).catch(() => setDlError('Could not download the report.'));
  const n = q.data;
  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="font-semibold">Reports (CSV)</h2>
        <p className="mt-1 text-sm text-muted">Downloads open in Excel or Google Sheets. They contain totals only, no personal data, and small groups are hidden.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => exp('platform-summary')}>Platform summary</Button>
          <Button size="sm" variant="outline" onClick={() => exp('jobs-by-region')}>Jobs and workers by region</Button>
          <Button size="sm" variant="outline" onClick={() => exp('applications-by-status')}>Applications by status</Button>
        </div>
        <ErrorLine text={dlError} />
      </Card>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isError && <Alert tone="danger">Could not load analytics.</Alert>}
      {n && (
        <>
          <Alert tone="info">{n.privacy}</Alert>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-x-auto p-5"><h2 className="font-semibold">By region</h2>
              <table className="mt-3 w-full text-left text-sm"><thead><tr className="border-b border-border text-muted"><th className="py-2">Region</th><th>Open jobs</th><th>Vacancies</th><th>Visible workers</th></tr></thead>
                <tbody>{n.regions.map((r) => <tr key={r.region} className="border-b border-border last:border-0"><td className="py-2">{r.region}</td><td>{cell(r.openJobs)}</td><td>{cell(r.vacancies)}</td><td>{cell(r.visibleWorkers)}</td></tr>)}</tbody></table></Card>
            <Card className="overflow-x-auto p-5"><h2 className="font-semibold">Job categories</h2>
              <table className="mt-3 w-full text-left text-sm"><thead><tr className="border-b border-border text-muted"><th className="py-2">Category</th><th>Open jobs</th></tr></thead>
                <tbody>{n.categories.map((c) => <tr key={c.category} className="border-b border-border last:border-0"><td className="py-2">{c.category}</td><td>{cell(c.openJobs)}</td></tr>)}</tbody></table></Card>
            <Card className="p-5"><h2 className="font-semibold">Most requested skills</h2>
              <ol className="mt-3 space-y-1 text-sm">{n.mostRequiredSkills.length === 0 && <li className="text-muted">No data yet.</li>}{n.mostRequiredSkills.map((s) => <li key={s.skill} className="flex justify-between"><span>{s.skill}</span><span>{cell(s.openJobs)}</span></li>)}</ol></Card>
            <Card className="p-5"><h2 className="font-semibold">Popular occupations (workers)</h2>
              <ol className="mt-3 space-y-1 text-sm">{n.popularOccupations.length === 0 && <li className="text-muted">Not enough workers share an occupation yet (minimum {n.k}).</li>}{n.popularOccupations.map((o) => <li key={o.occupation} className="flex justify-between"><span>{o.occupation}</span><span>{o.workers}</span></li>)}</ol></Card>
          </div>
          <Card className="overflow-x-auto p-5"><h2 className="font-semibold">Application outcomes</h2>
            <p className="mt-1 text-sm">Overall success rate: <strong>{n.applicationOutcomes.successRate === null ? 'not enough decided applications yet' : `${n.applicationOutcomes.successRate}%`}</strong> ({n.applicationOutcomes.decided} decided)</p>
            <table className="mt-3 w-full text-left text-sm"><thead><tr className="border-b border-border text-muted"><th className="py-2">Category</th><th>Decided</th><th>Success rate</th></tr></thead>
              <tbody>{n.applicationOutcomes.byCategory.map((c) => <tr key={c.category} className="border-b border-border last:border-0"><td className="py-2">{c.category}</td><td>{cell(c.decided)}</td><td>{c.successRate === null ? cell(null) : `${c.successRate}%`}</td></tr>)}</tbody></table>
            <p className="mt-2 text-xs text-muted">{n.applicationOutcomes.note}</p></Card>
        </>
      )}
    </div>
  );
}

// ───────── Activity log ─────────

export function AdminAudit() {
  const [action, setAction] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const qs = new URLSearchParams({ ...(action ? { action } : {}), page: String(pageNo), pageSize: '25' }).toString();
  const q = useAdminQuery<Paged<AuditItem>>(['audit', qs], `/audit?${qs}`);
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <div className="space-y-4">
      <Card className="p-4"><label className="block max-w-sm text-sm font-medium">Show actions starting with<input className={`${inp} mt-1.5`} placeholder="e.g. admin. or auth.login or job." value={action} onChange={(e) => { setAction(e.target.value); setPageNo(1); }} /></label></Card>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isError && <Alert tone="danger">Could not load the activity log.</Alert>}
      {q.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="border-b border-border text-muted"><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">Action</th><th className="p-3">About</th><th className="p-3">Details</th></tr></thead>
            <tbody>
              {q.data.items.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 align-top">
                  <td className="p-3 text-xs">{when(a.at)}</td>
                  <td className="p-3">{a.actor ? `${a.actor.name} (${a.actor.role.toLowerCase()})` : 'system / anonymous'}</td>
                  <td className="p-3"><code className="text-xs">{a.action}</code></td>
                  <td className="p-3 text-xs">{a.entityType}{a.entityId ? ` ${a.entityId.slice(0, 8)}` : ''}</td>
                  <td className="p-3 text-xs text-muted">{a.meta ? JSON.stringify(a.meta).slice(0, 120) : ''}</td>
                </tr>
              ))}
              {q.data.items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">No activity matches.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {q.data && pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="outline" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>Previous</Button>
          <span className="text-muted">Page {pageNo} of {pages} · {q.data.total} events</span>
          <Button size="sm" variant="outline" disabled={pageNo >= pages} onClick={() => setPageNo(pageNo + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
