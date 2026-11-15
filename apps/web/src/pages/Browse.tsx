import { useOrgTypeCatalog } from '@/lib/orgTypes';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { useState } from 'react';
import { Briefcase, ChevronLeft, ChevronRight, SearchX, SlidersHorizontal, Users } from 'lucide-react';
import { Alert, Card, EmptyState, SelectField, Skeleton, TextField } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { JobCard } from '@/components/JobCard';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useI18n } from '@/i18n';
import { CATEGORIES, EMPLOYMENT_TYPES, REGIONS } from '@/lib/taxonomy';
import { useJobSearch } from '@/lib/jobs';
import { CategoryTiles } from '@/components/CategoryTiles';
import { SavedSearchesPanel } from '@/components/SavedSearchesPanel';
import { useLocations } from '@/lib/profile';

const TYPE_VALUE: Record<string, string> = {
  'Full-time': 'FULL_TIME', 'Part-time': 'PART_TIME', Temporary: 'TEMPORARY', Contract: 'CONTRACT',
  Freelance: 'FREELANCE', Internship: 'INTERNSHIP', Seasonal: 'SEASONAL', Daily: 'DAILY',
};
const PAGE_SIZE = 10;
const FILTER_KEYS = ['region', 'locationId', 'category', 'type', 'mode', 'minSalary', 'hasSalary', 'flexible', 'maxEducation', 'maxExperience', 'startWithin', 'postedWithin', 'language', 'verifiedOnly', 'employerGroup'];
const LANGUAGES = ['Amharic', 'Afaan Oromoo', 'English', 'Tigrinya', 'Somali', 'Arabic'];

function Filters() {
  const { t } = useI18n();
  const employerGroups = useOrgTypeCatalog().groups.filter((g) => g.group !== 'all');
  const [params, setParams] = useSearchParams();
  // On a phone the filters start collapsed so the results are not pushed two screens down.
  const [open, setOpen] = useState(false);
  const activeCount = FILTER_KEYS.filter((k) => params.get(k)).length;
  const regions = useLocations().data ?? [];
  const regionId = regions.find((r) => r.nameEn.toLowerCase() === (params.get('region') ?? '').toLowerCase())?.id;
  const zones = useLocations(regionId).data ?? [];
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page'); // any filter change goes back to page 1
    setParams(next, { replace: true });
  };
  return (
    <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <TextField voice label={t('common.search')} placeholder="Title, skill or employer" value={params.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} />
      <Button type="button" variant="outline" className="sm:hidden" aria-expanded={open} aria-controls="job-filters" onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden /> {open ? 'Hide filters' : 'Filters'}{activeCount > 0 ? ` (${activeCount})` : ''}
      </Button>
      <div id="job-filters" className={open ? 'contents' : 'hidden sm:contents'}>
      <SelectField label={t('common.region')} value={params.get('region') ?? ''} onChange={(e) => { const next = new URLSearchParams(params); next.delete('locationId'); next.delete('page'); if (e.target.value) next.set('region', e.target.value); else next.delete('region'); setParams(next, { replace: true }); }}>
        <option value="">{t('common.all')}</option>
        {REGIONS.map((r) => <option key={r}>{r}</option>)}
      </SelectField>
      <SelectField label="Zone or city" disabled={!regionId} value={params.get('locationId') ?? ''} onChange={(e) => set('locationId', e.target.value)}>
        <option value="">{t('common.all')}</option>
        {zones.map((z) => <option key={z.id} value={z.id}>{z.nameEn}</option>)}
      </SelectField>
      <SelectField label={t('common.category')} value={params.get('category') ?? ''} onChange={(e) => set('category', e.target.value)}>
        <option value="">{t('common.all')}</option>
        {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
      </SelectField>
      <SelectField label={t('common.employmentType')} value={params.get('type') ?? ''} onChange={(e) => set('type', e.target.value)}>
        <option value="">{t('common.all')}</option>
        {EMPLOYMENT_TYPES.map((x) => <option key={x} value={TYPE_VALUE[x]}>{x}</option>)}
      </SelectField>
      <SelectField label="Work arrangement" value={params.get('mode') ?? ''} onChange={(e) => set('mode', e.target.value)}>
        <option value="">{t('common.all')}</option>
        <option value="ON_SITE">On-site</option>
        <option value="REMOTE">Remote</option>
        <option value="HYBRID">Hybrid</option>
      </SelectField>
      <SelectField label="Kind of employer" value={params.get('employerGroup') ?? ''} onChange={(e) => set('employerGroup', e.target.value)}>
        <option value="">{t('common.all')}</option>
        {employerGroups.map((g) => <option key={g.group} value={g.group}>{g.label}</option>)}
      </SelectField>
      <TextField label="Minimum salary (ETB)" inputMode="numeric" value={params.get('minSalary') ?? ''} onChange={(e) => set('minSalary', e.target.value.replace(/\D/g, ''))} />
      <SelectField label="Schooling I have" value={params.get('maxEducation') ?? ''} onChange={(e) => set('maxEducation', e.target.value)}>
        <option value="">Any</option>
        <option value="NONE">No formal schooling</option>
        <option value="PRIMARY">Primary school</option>
        <option value="SECONDARY">Secondary school</option>
        <option value="VOCATIONAL_CERTIFICATE">Vocational certificate</option>
        <option value="DIPLOMA">Diploma</option>
        <option value="BACHELOR">Bachelor's degree</option>
        <option value="MASTER">Master's degree</option>
      </SelectField>
      <SelectField label="Experience I have" value={params.get('maxExperience') ?? ''} onChange={(e) => set('maxExperience', e.target.value)}>
        <option value="">Any</option>
        <option value="0">None (no experience needed)</option>
        <option value="1">Up to 1 year</option>
        <option value="3">Up to 3 years</option>
        <option value="5">Up to 5 years</option>
      </SelectField>
      <SelectField label="Language" value={params.get('language') ?? ''} onChange={(e) => set('language', e.target.value)}>
        <option value="">Any</option>
        {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
      </SelectField>
      <SelectField label="Starts within" value={params.get('startWithin') ?? ''} onChange={(e) => set('startWithin', e.target.value)}>
        <option value="">Any time</option>
        <option value="7">1 week</option>
        <option value="30">1 month</option>
        <option value="90">3 months</option>
      </SelectField>
      <SelectField label="Posted" value={params.get('postedWithin') ?? ''} onChange={(e) => set('postedWithin', e.target.value)}>
        <option value="">Any time</option>
        <option value="1">Today</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
      </SelectField>
      <SelectField label="Sort by" value={params.get('sort') ?? 'newest'} onChange={(e) => set('sort', e.target.value === 'newest' ? '' : e.target.value)}>
        <option value="newest">Newest</option>
        <option value="deadline">Closing soon</option>
        <option value="salary">Highest salary</option>
      </SelectField>
      <label className="flex items-end gap-2 pb-3 text-sm">
        <input type="checkbox" checked={params.get('flexible') === 'true'} onChange={(e) => set('flexible', e.target.checked ? 'true' : '')} />
        Flexible work (part-time, daily, seasonal, freelance, remote)
      </label>
      <label className="flex items-end gap-2 pb-3 text-sm">
        <input type="checkbox" checked={params.get('hasSalary') === 'true'} onChange={(e) => set('hasSalary', e.target.checked ? 'true' : '')} />
        Salary shown
      </label>
      <label className="flex items-end gap-2 pb-3 text-sm">
        <input type="checkbox" checked={params.get('verifiedOnly') === 'true'} onChange={(e) => set('verifiedOnly', e.target.checked ? 'true' : '')} />
        Verified employers only
      </label>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">There is no gender or age filter: jobs on this platform may not exclude people because of gender, age, religion, ethnicity or marital status. Jobs that do not state a requirement stay in the results when you filter by schooling or experience.</p>
      </div>
    </Card>
  );
}

export function JobsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const api = new URLSearchParams();
  for (const k of ['q', 'sort', ...FILTER_KEYS]) {
    const v = params.get(k);
    if (v) api.set(k, v);
  }
  api.set('page', String(page));
  api.set('pageSize', String(PAGE_SIZE));
  const q = useJobSearch(api.toString());

  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const goto = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };
  const hasFilters = ['q', ...FILTER_KEYS].some((k) => params.get(k));
  const { user } = useAuth();
  const current: Record<string, string> = {};
  for (const k of ['q', ...FILTER_KEYS]) {
    const v = params.get(k);
    if (v) current[k] = v;
  }

  return (
    <>
      <PageHeader title={t('jobs.title')} subtitle={t('jobs.subtitle')} />
      <PageBody>
        <CategoryTiles value={params.get('category')} onChange={(slug) => { const next = new URLSearchParams(params); if (slug) next.set('category', slug); else next.delete('category'); next.delete('page'); setParams(next, { replace: true }); }} />
        <div className="mt-4"><Filters /></div>
        {user?.role === 'WORKER' && (
          <SavedSearchesPanel current={current} onOpen={(f) => setParams(new URLSearchParams(Object.entries(f).map(([k, v]) => [k, String(v)])))} />
        )}
        <div className="mt-6" aria-live="polite">
          {q.isLoading && (
            <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div>
          )}
          {q.isError && <Alert tone="danger">Could not load jobs. Please try again in a moment.</Alert>}
          {q.data && q.data.total === 0 && (
            hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No jobs match your search"
                body="Try removing a filter or searching for a more general skill."
                action={<Button variant="outline" onClick={() => setParams({})}>Clear filters</Button>}
              />
            ) : (
              <EmptyState icon={Briefcase} title={t('jobs.empty.title')} body="No employer has published a job yet. Check back soon." />
            )
          )}
          {q.data && q.data.total > 0 && (
            <>
              <p className="mb-3 text-sm text-muted">{q.data.total} job{q.data.total === 1 ? '' : 's'} found</p>
              <div className="grid gap-3">{q.data.items.map((j) => <JobCard key={j.id} job={j} />)}</div>
              {totalPages > 1 && (
                <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goto(page - 1)}><ChevronLeft className="h-4 w-4" aria-hidden />Previous</Button>
                  <span className="text-sm text-muted">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goto(page + 1)}>Next<ChevronRight className="h-4 w-4" aria-hidden /></Button>
                </nav>
              )}
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}

export function WorkersPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  if (user?.role === 'EMPLOYER') return <Navigate to="/employer/workers" replace />;
  return (
    <>
      <PageHeader title={t('workers.title')} subtitle={t('workers.subtitle')} />
      <PageBody>
        <EmptyState
          icon={Users}
          title={t('workers.empty.title')}
          body={t('workers.empty.body')}
          action={<LinkButton to="/register?role=employer" variant="accent">{t('hero.cta.employer')}</LinkButton>}
        />
      </PageBody>
    </>
  );
}
