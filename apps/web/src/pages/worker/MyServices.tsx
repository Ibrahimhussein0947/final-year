import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, X } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, SelectField, Skeleton, TextAreaField, TextField } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { LocationLevel } from '@/pages/worker/sections';
import { api, ApiError } from '@/lib/api';
import { useCategories, useSkillSearch } from '@/lib/profile';
import { formatPlace, formatSalary, PAY_BASIS_LABEL } from '@/lib/format';
import { SERVICE_MODE_LABEL, SERVICE_STATUS, useMyServices, useService, type ServiceDetail, type ServiceItem } from '@/lib/services';

const emptyForm = { title: '', description: '', categoryId: '', serviceMode: 'AT_CUSTOMER', payBasis: '', priceMin: '', priceMax: '', toolsIncluded: false, availability: '' };
type Form = typeof emptyForm;
type Picked = { skillId: string; name: string };

const messageOf = (e: unknown) => (e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string | undefined) ?? e.message : 'Could not reach the server');
const num = (v: string) => (v.trim() === '' ? null : Number(v));

function SkillPicker({ value, onChange }: { value: Picked[]; onChange: (v: Picked[]) => void }) {
  const [q, setQ] = useState('');
  const results = useSkillSearch(q);
  const have = new Set(value.map((s) => s.skillId));
  return (
    <div>
      <TextField label="Skills you offer" hint="Search and add at least one" placeholder="e.g. plumbing, welding, tailoring" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Skill search results">
          {results.data?.length === 0 && <li className="text-sm text-muted">No skills found.</li>}
          {results.data?.filter((s) => !have.has(s.id)).map((s) => (
            <li key={s.id}><button type="button" className="rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent hover:text-accent" onClick={() => { onChange([...value, { skillId: s.id, name: s.nameEn }]); setQ(''); }}>+ {s.nameEn}</button></li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex flex-wrap gap-2">
        {value.length === 0 && <li className="text-sm text-muted">No skills added yet.</li>}
        {value.map((s) => (
          <li key={s.skillId} className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
            {s.name}<button type="button" aria-label={`Remove ${s.name}`} onClick={() => onChange(value.filter((x) => x.skillId !== s.skillId))}><X className="h-3.5 w-3.5" aria-hidden /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListingForm({ editing, onDone }: { editing: ServiceDetail | null; onDone: () => void }) {
  const qc = useQueryClient();
  const categories = useCategories();
  const [f, setF] = useState<Form>(editing ? {
    title: editing.title, description: editing.description, categoryId: editing.categoryId ?? editing.category.id, serviceMode: editing.serviceMode,
    payBasis: editing.payBasis ?? '', priceMin: editing.priceMin?.toString() ?? '', priceMax: editing.priceMax?.toString() ?? '', toolsIncluded: editing.toolsIncluded, availability: editing.availability ?? '',
  } : emptyForm);
  const [chain, setChain] = useState<string[]>(editing?.areaPath.map((l) => l.id) ?? []);
  const [skills, setSkills] = useState<Picked[]>(editing?.allSkills.map((k) => ({ skillId: k.skillId, name: k.name })) ?? []);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: f.title, description: f.description, categoryId: f.categoryId, serviceMode: f.serviceMode,
        payBasis: f.payBasis || null, priceMin: num(f.priceMin), priceMax: num(f.priceMax), toolsIncluded: f.toolsIncluded,
        availability: f.availability, locationId: chain[chain.length - 1] ?? null,
        skillIds: skills.map((s) => s.skillId),
      };
      return editing ? api(`/services/${editing.id}`, { method: 'PATCH', body }) : api('/services', { method: 'POST', body });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-services'] }); void qc.invalidateQueries({ queryKey: ['service'] }); onDone(); },
    onError: (e) => setError(messageOf(e)),
  });

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold">{editing ? 'Edit your service' : 'Add a service'}</h2>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div className="sm:col-span-2"><TextField label="Title" placeholder="e.g. Plumbing repairs and installation" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
        <SelectField label="Kind of work" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
          <option value="">–</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
        </SelectField>
        <SelectField label="Where you do the work" value={f.serviceMode} onChange={(e) => set('serviceMode', e.target.value)}>
          {Object.entries(SERVICE_MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
        <div className="sm:col-span-2"><TextAreaField label="Describe what you offer" voice className="min-h-32" hint="What you do, how you work, your experience. Do not put your phone number here: customers reach you through the platform." value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        <div className="sm:col-span-2"><SkillPicker value={skills} onChange={setSkills} /></div>
        <SelectField label="How the price is counted" value={f.payBasis} onChange={(e) => set('payBasis', e.target.value)}>
          <option value="">Not stated</option>{Object.entries(PAY_BASIS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
        <TextField label="Availability" placeholder="e.g. Mon to Sat, 8:00 to 17:00" value={f.availability} onChange={(e) => set('availability', e.target.value)} />
        <TextField label="Price from (ETB)" inputMode="numeric" value={f.priceMin} onChange={(e) => set('priceMin', e.target.value.replace(/\D/g, ''))} />
        <TextField label="Price to (ETB)" inputMode="numeric" value={f.priceMax} onChange={(e) => set('priceMax', e.target.value.replace(/\D/g, ''))} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.toolsIncluded} onChange={(e) => set('toolsIncluded', e.target.checked)} />I bring my own tools</label>
        {f.serviceMode !== 'REMOTE' && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Area you serve</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: Math.min(chain.length + 1, 3) }, (_, i) => (
                <LocationLevel key={i} label={['Region', 'Zone or city', 'Woreda'][i]} parentId={i === 0 ? undefined : chain[i - 1]} value={chain[i] ?? ''} onChange={(id) => setChain((c) => [...c.slice(0, i), ...(id ? [id] : [])])} />
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Customers see the area only, never an exact address.</p>
          </fieldset>
        )}
        {error && <div className="sm:col-span-2"><Alert tone="danger">{error}</Alert></div>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="accent" loading={save.isPending}>{editing ? 'Save changes' : 'Save as draft'}</Button>
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function Row({ item, onEdit, onError }: { item: ServiceItem; onEdit: () => void; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-services'] });
  const fail = (e: unknown) => onError(messageOf(e));
  const publish = useMutation({ mutationFn: () => api(`/services/${item.id}/publish`, { method: 'POST' }), onSuccess: refresh, onError: fail });
  const pause = useMutation({ mutationFn: () => api(`/services/${item.id}/pause`, { method: 'POST' }), onSuccess: refresh, onError: fail });
  const remove = useMutation({ mutationFn: () => api(`/services/${item.id}`, { method: 'DELETE' }), onSuccess: refresh, onError: fail });
  const st = SERVICE_STATUS[item.status] ?? SERVICE_STATUS.DRAFT;
  const price = formatSalary(item.priceMin, item.priceMax, item.currency, item.payBasis);
  return (
    <li>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Link to={`/services/${item.id}`} className="text-lg font-semibold hover:text-accent">{item.title}</Link>
            <p className="mt-0.5 text-sm text-muted">{item.category.name} · {SERVICE_MODE_LABEL[item.serviceMode]}{item.serviceMode !== 'REMOTE' && item.areaPath.length ? ` · ${formatPlace(item.areaPath)}` : ''} · {price ?? 'Price not stated'}</p>
          </div>
          <div className="flex items-center gap-2">
            {!!item.waitingInquiries && <Badge tone="accent">{item.waitingInquiries} waiting</Badge>}
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(item.status === 'DRAFT' || item.status === 'PAUSED') && <Button size="sm" variant="accent" loading={publish.isPending} onClick={() => publish.mutate()}>{item.status === 'PAUSED' ? 'Resume' : 'Publish'}</Button>}
          {item.status === 'ACTIVE' && <Button size="sm" variant="outline" loading={pause.isPending} onClick={() => pause.mutate()}>Pause</Button>}
          <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => { if (window.confirm('Remove this listing? Customers who are waiting for an answer are told it is no longer available.')) remove.mutate(); }}>Remove</Button>
        </div>
      </Card>
    </li>
  );
}

export default function MyServicesPage() {
  const q = useMyServices();
  const [mode, setMode] = useState<'list' | 'new' | { edit: ServiceItem }>('list');
  const [error, setError] = useState<string | null>(null);
  const editId = typeof mode === 'object' ? mode.edit.id : undefined;
  // Editing needs the full listing (description, skills, area), which the list view does not carry.
  const detail = useService(editId);

  return (
    <>
      <PageHeader title="My services" subtitle="Offer what you do directly to customers. They send a request, and you decide whether to answer." />
      <PageBody narrow>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
        <div className="mb-5 flex flex-wrap gap-2">
          {mode === 'list' && <Button variant="accent" onClick={() => setMode('new')}><Plus className="h-4 w-4" aria-hidden />Add a service</Button>}
          <LinkButton to="/service-requests" variant="outline">Requests from customers</LinkButton>
        </div>
        {mode === 'new' && <div className="mb-6"><ListingForm key="new" editing={null} onDone={() => setMode('list')} /></div>}
        {editId && detail.isLoading && <Skeleton className="mb-6 h-64" />}
        {editId && detail.data && <div className="mb-6"><ListingForm key={detail.data.id} editing={detail.data} onDone={() => setMode('list')} /></div>}
        {q.isLoading && <Skeleton className="h-32" />}
        {q.data && q.data.length === 0 && mode === 'list' && <EmptyState icon={Wrench} title="You have not listed a service yet" body="Plumbers, tailors, electricians, cleaners and others can advertise here without waiting for a vacancy." />}
        <ul className="space-y-4">{q.data?.map((i) => <Row key={i.id} item={i} onEdit={() => setMode({ edit: i })} onError={setError} />)}</ul>
        <p className="mt-6 text-xs text-muted">You can have up to 5 listings. Payment is agreed between you and the customer; this site never holds money. Never ask a customer to pay before the work is agreed.</p>
      </PageBody>
    </>
  );
}
