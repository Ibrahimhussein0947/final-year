import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, MapPin, Wrench } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, SelectField, Skeleton, TextAreaField, TextField } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { TrustBadge } from '@/components/TrustBadge';
import { ReportButton } from '@/components/ReportButton';
import { useAuth } from '@/app/auth';
import { api, ApiError } from '@/lib/api';
import { useProtectedImage } from '@/lib/profile';
import { formatPlace, formatSalary, PAY_BASIS_LABEL, timeAgo } from '@/lib/format';
import { CATEGORIES, REGIONS } from '@/lib/taxonomy';
import { askForService, SERVICE_MODE_LABEL, useService, useServiceSearch, type ServiceItem, type Understood } from '@/lib/services';

const PAGE_SIZE = 12;
const FILTER_KEYS = ['category', 'region', 'mode', 'payBasis', 'verifiedOnly'];

function Provider({ item }: { item: Pick<ServiceItem, 'provider'> }) {
  const photo = useProtectedImage(item.provider.photoUrl);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-xs font-bold text-muted">
        {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : item.provider.name.slice(0, 1)}
      </span>
      <span className="font-medium">{item.provider.name}</span>
      <TrustBadge trust={item.provider.trust} />
    </div>
  );
}

export function ServiceCard({ item }: { item: ServiceItem }) {
  const price = formatSalary(item.priceMin, item.priceMax, item.currency, item.payBasis);
  return (
    <li>
      <Card className="h-full p-5">
        <Link to={`/services/${item.id}`} className="text-lg font-semibold hover:text-accent">{item.title}</Link>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>{item.category.name}</span>
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{item.serviceMode === 'REMOTE' ? 'Remote' : formatPlace(item.areaPath)}</span>
        </p>
        <div className="mt-3"><Provider item={item} /></div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="accent">{SERVICE_MODE_LABEL[item.serviceMode]}</Badge>
          {item.toolsIncluded && <Badge>Own tools</Badge>}
          {item.matchedSkills ? <Badge tone="success">{item.matchedSkills} matching {item.matchedSkills === 1 ? 'skill' : 'skills'}</Badge> : null}
          {item.skills.slice(0, 4).map((s) => <Badge key={s} tone="info">{s}</Badge>)}
        </div>
        <p className="mt-3 text-sm font-medium">{price ?? 'Price: ask the provider'}</p>
      </Card>
    </li>
  );
}

function AskBox({ onResult, onClear, active }: { onResult: (r: { understood: Understood; items: ServiceItem[] }) => void; onClear: () => void; active: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => askForService(text.trim()),
    onSuccess: (r) => { setError(null); onResult(r); },
    onError: (e) => setError(e instanceof ApiError ? Object.values(e.details ?? {}).flat()[0] as string ?? e.message : 'Could not reach the server'),
  });
  return (
    <Card className="p-5">
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 10) ask.mutate(); else setError('Write a little more, at least 10 characters.'); }} noValidate>
        <TextAreaField label="Tell us what you need" voice className="min-h-20" placeholder="For example: a leaking pipe under my kitchen sink needs fixing this week" value={text} onChange={(e) => setText(e.target.value)} />
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="submit" variant="accent" size="sm" loading={ask.isPending}>Find providers</Button>
          {active && <Button type="button" variant="ghost" size="sm" onClick={() => { setText(''); onClear(); }}>Back to all services</Button>}
        </div>
      </form>
    </Card>
  );
}

export function ServicesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [asked, setAsked] = useState<{ understood: Understood; items: ServiceItem[] } | null>(null);
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const api = new URLSearchParams();
  for (const k of ['q', ...FILTER_KEYS]) { const v = params.get(k); if (v) api.set(k, v); }
  api.set('page', String(page));
  api.set('pageSize', String(PAGE_SIZE));
  const q = useServiceSearch(api.toString());
  const set = (k: string, v: string) => { const next = new URLSearchParams(params); if (v) next.set(k, v); else next.delete(k); next.delete('page'); setParams(next, { replace: true }); };
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Find a service" subtitle="Plumbers, tailors, electricians, cleaners and more. Ask a provider directly: no vacancy, no waiting." />
      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <AskBox active={!!asked} onResult={setAsked} onClear={() => setAsked(null)} />
          {user?.role === 'WORKER' && (
            <Card className="p-5"><p className="text-sm font-medium">Do you offer a service?</p><LinkButton to="/my-services" variant="outline" size="sm" className="mt-2">Add your service</LinkButton></Card>
          )}
        </div>

        {asked ? (
          <section className="mt-6" aria-live="polite">
            <Alert tone="info">
              {asked.understood.category || asked.understood.skills.length ? (
                <>We read this as <strong>{asked.understood.category?.name ?? 'general work'}</strong>{asked.understood.skills.length ? <> needing <strong>{asked.understood.skills.map((s) => s.name).join(', ')}</strong></> : null}. Providers are ranked by how many of these skills they offer. This is a keyword match, so check each listing.</>
              ) : 'We could not tell what kind of work this is. Try naming the work, for example "plumbing", "tailoring" or "wiring".'}
            </Alert>
            {asked.items.length === 0 ? (
              <div className="mt-4"><EmptyState icon={Wrench} title="No provider matches yet" body="Try the filters below, or describe the work in other words." /></div>
            ) : (
              <ul className="mt-4 grid gap-4 md:grid-cols-2">{asked.items.map((i) => <ServiceCard key={i.id} item={i} />)}</ul>
            )}
          </section>
        ) : (
          <>
            <Card className="mt-6 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="lg:col-span-2"><TextField label="Search" placeholder="Title, skill or name" value={params.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} /></div>
                <SelectField label="Kind of work" value={params.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}>
                  <option value="">All</option>{CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                </SelectField>
                <SelectField label="Region" value={params.get('region') ?? ''} onChange={(e) => set('region', e.target.value)}>
                  <option value="">All</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}
                </SelectField>
                <SelectField label="Where it is done" value={params.get('mode') ?? ''} onChange={(e) => set('mode', e.target.value)}>
                  <option value="">All</option>{Object.entries(SERVICE_MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </SelectField>
                <SelectField label="How the price is counted" value={params.get('payBasis') ?? ''} onChange={(e) => set('payBasis', e.target.value)}>
                  <option value="">All</option>{Object.entries(PAY_BASIS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </SelectField>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={params.get('verifiedOnly') === 'true'} onChange={(e) => set('verifiedOnly', e.target.checked ? 'true' : '')} />Only providers whose ID was checked</label>
            </Card>
            <div className="mt-6" aria-live="polite">
              {q.isLoading && <div className="grid gap-4 md:grid-cols-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div>}
              {q.isError && <Alert tone="danger">Could not load services. Please try again in a moment.</Alert>}
              {q.data && q.data.items.length === 0 && <EmptyState icon={Wrench} title="No services found" body="Try fewer filters. New providers join every day." />}
              {q.data && q.data.items.length > 0 && (
                <>
                  <p className="mb-3 text-sm text-muted">{q.data.total} {q.data.total === 1 ? 'service' : 'services'}</p>
                  <ul className="grid gap-4 md:grid-cols-2">{q.data.items.map((i) => <ServiceCard key={i.id} item={i} />)}</ul>
                  {totalPages > 1 && (
                    <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pages">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { const n = new URLSearchParams(params); n.set('page', String(page - 1)); setParams(n); }}>Previous</Button>
                      <span className="text-sm text-muted">Page {page} of {totalPages}</span>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => { const n = new URLSearchParams(params); n.set('page', String(page + 1)); setParams(n); }}>Next</Button>
                    </nav>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}

function InquiryForm({ serviceId, providerName }: { serviceId: string; providerName: string }) {
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api(`/services/${serviceId}/inquiries`, { method: 'POST', body: { message: message.trim(), ...(date ? { preferredDate: date } : {}) } }),
    onError: (e) => setError(e instanceof ApiError ? Object.values(e.details ?? {}).flat()[0] as string ?? e.message : 'Could not reach the server'),
  });
  if (send.isSuccess) {
    return <Alert tone="success">Sent. {providerName} will answer when they can, and you will be notified. Their phone number and a chat open only if they accept. <Link to="/service-requests" className="font-medium underline">See your requests</Link></Alert>;
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); send.mutate(); }} noValidate className="space-y-3">
      <TextAreaField label={`Ask ${providerName}`} voice className="min-h-28" placeholder="Say what you need, where, and when." value={message} onChange={(e) => setMessage(e.target.value)} />
      <TextField label="Preferred day (optional)" type="date" min={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="accent" loading={send.isPending}>Send request</Button>
    </form>
  );
}

export function ServiceDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const q = useService(id);
  if (q.isLoading) return <PageBody narrow><Skeleton className="h-64" /></PageBody>;
  if (q.isError || !q.data) return <PageBody narrow><Alert tone="danger">This service could not be found. It may have been paused or removed.</Alert><Link to="/services" className="mt-3 inline-block text-accent hover:underline">Back to services</Link></PageBody>;
  const s = q.data;
  const price = formatSalary(s.priceMin, s.priceMax, s.currency, s.payBasis);
  const canAsk = user && (user.role === 'WORKER' || user.role === 'EMPLOYER') && !s.isOwner;

  return (
    <PageBody narrow>
      <Link to="/services" className="text-sm text-muted hover:text-accent">← All services</Link>
      <Card className="mt-3 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">{s.title}</h1>
            <p className="mt-1 text-muted">{s.category.name}</p>
          </div>
          {s.status !== 'ACTIVE' && <Badge tone="warning">{s.status === 'DRAFT' ? 'Draft: only you can see this' : 'Paused'}</Badge>}
        </div>
        <div className="mt-4"><Provider item={s} /></div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Price</dt><dd className="font-medium">{price ?? 'Ask the provider'}</dd></div>
          <div><dt className="text-muted">Where it is done</dt><dd className="font-medium">{SERVICE_MODE_LABEL[s.serviceMode]}</dd></div>
          <div><dt className="text-muted">Area</dt><dd className="font-medium">{s.serviceMode === 'REMOTE' && !s.areaPath.length ? 'Remote' : formatPlace(s.areaPath)}</dd></div>
          <div><dt className="text-muted">Availability</dt><dd className="font-medium">{s.availability ?? 'Ask the provider'}</dd></div>
          <div><dt className="text-muted">Tools</dt><dd className="font-medium">{s.toolsIncluded ? 'Provider brings their own tools' : 'Not stated'}</dd></div>
          {s.publishedAt && <div><dt className="text-muted">Listed</dt><dd className="font-medium">{timeAgo(s.publishedAt)}</dd></div>}
        </dl>
        <p className="mt-5 whitespace-pre-line text-sm">{s.description}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">{s.allSkills.map((k) => <Badge key={k.skillId} tone="info">{k.name}</Badge>)}</div>
        {s.provider.trust && s.provider.trust.level > 0 && <p className="mt-4 flex items-center gap-1 text-xs text-muted"><BadgeCheck className="h-4 w-4" aria-hidden />An administrator checked this provider against real documents.</p>}
      </Card>

      <Card className="mt-5 p-6">
        {s.isOwner ? (
          <p className="text-sm">This is your listing. <Link to="/my-services" className="font-medium text-accent hover:underline">Manage it</Link></p>
        ) : canAsk && s.status === 'ACTIVE' ? (
          <InquiryForm serviceId={s.id} providerName={s.provider.name.split(' ')[0]} />
        ) : user ? (
          <p className="text-sm text-muted">Only workers and employers can send requests.</p>
        ) : (
          <p className="text-sm">To ask this provider, <Link to="/login" className="font-medium text-accent hover:underline">sign in</Link> or <Link to="/register" className="font-medium text-accent hover:underline">create an account</Link>. It is free.</p>
        )}
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="font-semibold">Stay safe</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Never pay money before the work is agreed and started. This site does not handle payments.</li>
          <li>Agree the price and what is included before work begins.</li>
          <li>For work at your home, tell someone you trust when the provider is coming.</li>
          <li>Report listings that ask for money first or look false.</li>
        </ul>
      </Card>
      {user && !s.isOwner && user.role !== 'ADMIN' && <div className="mt-4"><ReportButton targetType="SERVICE" targetId={s.id} label="Report this listing" /></div>}
    </PageBody>
  );
}
