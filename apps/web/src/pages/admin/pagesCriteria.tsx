import { useState } from 'react';
import { Alert, Badge, Card, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAdminAction, useAdminQuery, type CategoryRow } from '@/lib/admin';
import { api } from '@/lib/api';
import type { CriterionDef, CriterionOption, CriterionType } from '@/lib/criteria';

const sel = 'h-9 rounded-lg border border-border bg-surface px-2 text-sm';
const inp = 'h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm';
const ErrorLine = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-2 text-sm text-danger">{text}</p> : null);

type Row = CriterionDef & { usage: { jobs: number; workers: number } };
const TYPE_LABEL: Record<CriterionType, string> = { BOOLEAN: 'Yes / no', NUMBER: 'Number', CHOICE: 'One option', MULTI_CHOICE: 'Several options' };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 39);

interface Form {
  categoryId: string; key: string; type: CriterionType; labelEn: string; labelAm: string; labelOm: string; helpEn: string;
  unit: string; minValue: string; maxValue: string; mustHaveAllowed: boolean; evidenceSuggested: boolean; options: CriterionOption[];
}
const blank: Form = { categoryId: '', key: '', type: 'BOOLEAN', labelEn: '', labelAm: '', labelOm: '', helpEn: '', unit: '', minValue: '', maxValue: '', mustHaveAllowed: true, evidenceSuggested: false, options: [] };
const fromRow = (r: Row): Form => ({
  categoryId: r.category?.id ?? '', key: r.key, type: r.type, labelEn: r.labelEn, labelAm: r.labelAm ?? '', labelOm: r.labelOm ?? '', helpEn: r.helpEn ?? '',
  unit: r.unit ?? '', minValue: r.minValue?.toString() ?? '', maxValue: r.maxValue?.toString() ?? '', mustHaveAllowed: r.mustHaveAllowed, evidenceSuggested: r.evidenceSuggested,
  options: r.options.map((o) => ({ ...o })),
});
const num = (v: string) => (v.trim() === '' ? null : Number(v));

function OptionsEditor({ value, onChange }: { value: CriterionOption[]; onChange: (o: CriterionOption[]) => void }) {
  const set = (i: number, patch: Partial<CriterionOption>) => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Options</p>
      {value.map((o, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_1fr_auto]">
          <input aria-label={`Option ${i + 1} value`} className={inp} placeholder="value" value={o.value} onChange={(e) => set(i, { value: e.target.value })} />
          <input aria-label={`Option ${i + 1} English`} className={inp} placeholder="English" value={o.labelEn} onChange={(e) => set(i, { labelEn: e.target.value })} />
          <input aria-label={`Option ${i + 1} Amharic`} className={inp} placeholder="Amharic (optional)" value={o.labelAm ?? ''} onChange={(e) => set(i, { labelAm: e.target.value || null })} />
          <input aria-label={`Option ${i + 1} Afaan Oromoo`} className={inp} placeholder="Afaan Oromoo (optional)" value={o.labelOm ?? ''} onChange={(e) => set(i, { labelOm: e.target.value || null })} />
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { value: '', labelEn: '' }])}>Add option</Button>
    </div>
  );
}

/** Create (all fields) or edit (key, type and sector are fixed: stored answers and job requirements depend on them). */
function CriterionForm({ initial, editing, cats, onDone }: { initial: Form; editing: Row | null; cats: CategoryRow[]; onDone: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const isChoice = f.type === 'CHOICE' || f.type === 'MULTI_CHOICE';
  const shared = {
    labelEn: f.labelEn, labelAm: f.labelAm || null, labelOm: f.labelOm || null, helpEn: f.helpEn || null,
    mustHaveAllowed: f.mustHaveAllowed, evidenceSuggested: f.evidenceSuggested,
    ...(f.type === 'NUMBER' ? { unit: f.unit || null, minValue: num(f.minValue), maxValue: num(f.maxValue) } : {}),
    ...(isChoice ? { options: f.options.map((o) => ({ value: o.value, labelEn: o.labelEn, labelAm: o.labelAm || null, labelOm: o.labelOm || null })) } : {}),
  };
  const save = useAdminAction(
    () => (editing
      ? api(`/admin/criteria/${editing.id}`, { method: 'PATCH', body: shared })
      : api('/admin/criteria', { method: 'POST', body: { categoryId: f.categoryId || null, key: f.key, type: f.type, ...shared } })),
    { invalidate: ['criteria'] },
  );
  return (
    <form className="mt-3 space-y-3 rounded-xl border border-border p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onDone }); }}>
      {!editing && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">Sector
            <select className={`${sel} mt-1.5 w-full`} value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Every sector</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Type
            <select className={`${sel} mt-1.5 w-full`} value={f.type} onChange={(e) => set('type', e.target.value as CriterionType)}>
              {(Object.keys(TYPE_LABEL) as CriterionType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <TextField label="Key" hint="Lowercase letters, digits and _" value={f.key} onChange={(e) => set('key', slug(e.target.value))} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Question (English)" value={f.labelEn} onChange={(e) => { set('labelEn', e.target.value); if (!editing && !f.key) set('key', slug(e.target.value)); }} />
        <TextField label="Amharic (optional)" value={f.labelAm} onChange={(e) => set('labelAm', e.target.value)} />
        <TextField label="Afaan Oromoo (optional)" value={f.labelOm} onChange={(e) => set('labelOm', e.target.value)} />
      </div>
      <TextField label="Help text (optional)" value={f.helpEn} onChange={(e) => set('helpEn', e.target.value)} />
      {f.type === 'NUMBER' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Unit" placeholder="years" value={f.unit} onChange={(e) => set('unit', e.target.value)} />
          <TextField label="Lowest allowed" inputMode="numeric" value={f.minValue} onChange={(e) => set('minValue', e.target.value)} />
          <TextField label="Highest allowed" inputMode="numeric" value={f.maxValue} onChange={(e) => set('maxValue', e.target.value)} />
        </div>
      )}
      {isChoice && <OptionsEditor value={f.options} onChange={(o) => set('options', o)} />}
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.mustHaveAllowed} onChange={(e) => set('mustHaveAllowed', e.target.checked)} />Can be a must-have for a job</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.evidenceSuggested} onChange={(e) => set('evidenceSuggested', e.target.checked)} />A document can verify it (licence, certificate)</label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="accent" type="submit" loading={save.isPending} disabled={f.labelEn.trim().length < 3 || (!editing && f.key.length < 2)}>{editing ? 'Save changes' : 'Add criterion'}</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onDone}>Cancel</Button>
      </div>
      <ErrorLine text={save.error} />
    </form>
  );
}

function CriterionRow({ r, cats }: { r: Row; cats: CategoryRow[] }) {
  const [open, setOpen] = useState(false);
  const toggle = useAdminAction(() => api(`/admin/criteria/${r.id}`, { method: 'PATCH', body: { isActive: !r.isActive } }), { invalidate: ['criteria'] });
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{r.labelEn}</span>{' '}
          <Badge>{TYPE_LABEL[r.type]}</Badge>
          {!r.isActive && <> <Badge tone="warning">hidden</Badge></>}
          {r.evidenceSuggested && <> <Badge tone="accent">proof can verify</Badge></>}
          {!r.mustHaveAllowed && <> <Badge>preference only</Badge></>}
          <span className="ml-2 text-xs text-muted">{r.usage.jobs} jobs · {r.usage.workers} answers · {r.labelAm ? 'Amharic ✓' : 'no Amharic'} · {r.labelOm ? 'Afaan Oromoo ✓' : 'no Afaan Oromoo'}</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Edit'}</Button>
          <Button size="sm" variant="outline" loading={toggle.isPending} onClick={() => toggle.mutate()}>{r.isActive ? 'Hide' : 'Show'}</Button>
        </div>
      </div>
      {open && <CriterionForm initial={fromRow(r)} editing={r} cats={cats} onDone={() => setOpen(false)} />}
      <ErrorLine text={toggle.error} />
    </li>
  );
}

export function AdminCriteria() {
  const q = useAdminQuery<{ items: Row[] }>(['criteria'], '/criteria');
  const cats = useAdminQuery<{ items: CategoryRow[] }>(['categories'], '/categories');
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = (q.data?.items ?? []).filter((r) => (filter === '' ? true : filter === 'all' ? r.category === null : r.category?.id === filter));
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.category?.name ?? 'Every sector', [...(groups.get(r.category?.name ?? 'Every sector') ?? []), r]);

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="font-semibold">Sector criteria</h2>
        <p className="mt-1 text-sm text-muted">The questions that job forms, worker profiles and matching use for each sector: licences, certificates, shifts, tools. Employers mark them must-have or preferred; workers answer them, and an administrator can verify answers from evidence.</p>
        <div className="mt-3"><Alert tone="warning">Criteria must describe what the work needs. Do not add gender, age, religion, ethnicity or marital status: job text asking for them is blocked by the platform. The starting list was written by the developer, not by sector experts, so please review it. Hiding a criterion keeps all history; nothing is deleted.</Alert></div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">Show
            <select className={`${sel} mt-1.5 block`} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All criteria</option>
              <option value="all">Every sector</option>
              {cats.data?.items.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
            </select>
          </label>
          <Button size="sm" variant="accent" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Add a criterion'}</Button>
        </div>
        {adding && <CriterionForm initial={blank} editing={null} cats={cats.data?.items ?? []} onDone={() => setAdding(false)} />}
      </Card>

      {q.isLoading && <Skeleton className="h-64" />}
      {[...groups.entries()].map(([name, list]) => (
        <Card key={name} className="p-5">
          <h3 className="font-semibold">{name} <span className="text-xs font-normal text-muted">{list.length}</span></h3>
          <ul className="mt-2 divide-y divide-border">{list.map((r) => <CriterionRow key={r.id + r.labelEn + r.isActive} r={r} cats={cats.data?.items ?? []} />)}</ul>
        </Card>
      ))}
      {q.isSuccess && rows.length === 0 && <Card className="p-5 text-sm text-muted">No criteria for this selection.</Card>}
    </div>
  );
}
