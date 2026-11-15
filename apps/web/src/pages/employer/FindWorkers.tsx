import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ShieldCheck, Users, X } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, SelectField, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { InviteButton } from '@/components/InviteButton';
import { BULK_MAX, BulkInviteBar } from '@/components/BulkInviteBar';
import { MatchBadge, MatchPanel } from '@/components/MatchPanel';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { SectorRequirements } from '@/pages/employer/SectorRequirements';
import { cn } from '@/lib/cn';
import { EDU_LABEL } from '@/lib/format';
import { useMyJobs } from '@/lib/jobs';
import { type JobRequirement } from '@/lib/criteria';
import { useCategories, useLocations, useProtectedImage, useSkillSearch, type Option } from '@/lib/profile';
import { AVAILABILITY_LABEL, useTalentSearch, type TalentItem } from '@/lib/talent';

const PAGE_SIZE = 12;

function ZoneSelect({ regionId, value, onChange }: { regionId: string; value: string; onChange: (v: string) => void }) {
  const zones = useLocations(regionId);
  return (
    <SelectField label="Zone or city" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Whole region</option>
      {zones.data?.map((z) => <option key={z.id} value={z.id}>{z.nameEn}</option>)}
    </SelectField>
  );
}

function SkillFilter({ value, onChange }: { value: Option[]; onChange: (v: Option[]) => void }) {
  const [q, setQ] = useState('');
  const results = useSkillSearch(q);
  return (
    <div>
      <TextField label="Skills" placeholder="Search a skill to add, e.g. welding, copywriting" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && (
        <ul className="mt-1 max-h-40 overflow-auto rounded-xl border border-border bg-surface">
          {results.data?.filter((s) => !value.some((v) => v.id === s.id)).slice(0, 8).map((s) => (
            <li key={s.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => { onChange([...value, s]); setQ(''); }}>{s.nameEn}</button></li>
          ))}
          {results.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted">No skills found.</li>}
        </ul>
      )}
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-sm">
              {s.nameEn}
              <button type="button" aria-label={`Remove ${s.nameEn}`} className="text-muted hover:text-danger" onClick={() => onChange(value.filter((x) => x.id !== s.id))}><X className="h-3.5 w-3.5" aria-hidden /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkerCard({ w, jobId, selected, onToggle }: { w: TalentItem; jobId: string; selected: boolean; onToggle?: () => void }) {
  const [open, setOpen] = useState(false);
  const photo = useProtectedImage(w.photoUrl);
  const v = w.verified;
  const verifiedText = [v.skills && `${v.skills} skill${v.skills > 1 ? 's' : ''}`, v.qualifications && `${v.qualifications} qualification${v.qualifications > 1 ? 's' : ''}`, v.answers && `${v.answers} sector answer${v.answers > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          {onToggle && (
            <input type="checkbox" className="mt-3 h-5 w-5 shrink-0" checked={selected} onChange={onToggle} aria-label={`Select ${w.name} to invite`} />
          )}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-sm font-bold text-muted">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : w.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link to={`/employer/workers/${w.workerId}${jobId ? `?job=${jobId}` : ''}`} className="text-lg font-semibold hover:text-accent">{w.name}</Link>
              {w.match && <MatchBadge match={w.match} />}
            </div>
            <p className="text-sm text-muted">{[w.headline ?? w.occupation, `${w.yearsExperience} yr experience`, w.location, AVAILABILITY_LABEL[w.availability]].filter(Boolean).join(' · ')}</p>
            {w.skills.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{w.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>}
            {verifiedText && <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-success"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Verified by an administrator: {verifiedText}</p>}
            {w.match && <p className="mt-2 text-sm text-muted">{w.match.explanation}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {w.match && (
                <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
                  How was this calculated? <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
                </Button>
              )}
              <Link to={`/employer/workers/${w.workerId}${jobId ? `?job=${jobId}` : ''}`} className="text-sm font-medium text-accent hover:underline">View profile</Link>
              {jobId && <InviteButton jobId={jobId} workerId={w.workerId} invitation={w.invitation} applied={w.applied} />}
            </div>
            {open && w.match && <div className="mt-3"><MatchPanel match={w.match} title="Score breakdown" /></div>}
          </div>
        </div>
      </Card>
    </li>
  );
}

const blank = { q: '', categoryId: '', regionId: '', zoneId: '', minYears: '', availableWithin: '', minEducation: '', verified: false, jobId: '', skillsMode: 'all' };

/** Employer search for workers: filter by words, sector, skills, place, experience, availability, education, verified evidence and sector answers. */
export default function FindWorkersPage() {
  const categories = useCategories();
  const regions = useLocations();
  const myJobs = useMyJobs();
  const [f, setF] = useState(blank);
  const [skills, setSkills] = useState<Option[]>([]);
  const [crit, setCrit] = useState<JobRequirement[]>([]);
  const [applied, setApplied] = useState(`pageSize=${PAGE_SIZE}`);
  const [picked, setPicked] = useState<string[]>([]);
  const result = useTalentSearch(applied);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }));
  const openJobs = (myJobs.data ?? []).filter((j) => j.status === 'ACTIVE');

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const sp = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: '1' });
    if (f.q.trim()) sp.set('q', f.q.trim());
    if (f.categoryId) sp.set('categoryId', f.categoryId);
    if (skills.length) { sp.set('skills', skills.map((s) => s.id).join(',')); if (skills.length > 1) sp.set('skillsMode', f.skillsMode); }
    if (f.zoneId || f.regionId) sp.set('locationId', f.zoneId || f.regionId);
    if (f.minYears) sp.set('minYears', f.minYears);
    if (f.availableWithin) sp.set('availableWithin', f.availableWithin);
    if (f.minEducation) sp.set('minEducation', f.minEducation);
    if (f.verified) sp.set('verified', 'true');
    if (f.jobId) sp.set('jobId', f.jobId);
    if (crit.length) sp.set('criteria', JSON.stringify(crit.map((c) => ({ criterionId: c.criterionId, value: c.value }))));
    setApplied(sp.toString());
    setPicked([]);
  }
  const goto = (page: number) => { const sp = new URLSearchParams(applied); sp.set('page', String(page)); setApplied(sp.toString()); window.scrollTo({ top: 0 }); };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= BULK_MAX ? p : [...p, id]));
  const reset = () => { setF(blank); setSkills([]); setCrit([]); setApplied(`pageSize=${PAGE_SIZE}`); };

  const d = result.data;
  const jobId = d?.job?.id ?? '';
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Find workers" subtitle="Search workers who chose to be visible. Choose one of your open jobs to rank them by match and invite them to apply." />
      <PageBody>
        <form onSubmit={submit} className="space-y-4">
          <Card className="p-5">
            <div className="grid gap-4 md:grid-cols-3">
              <TextField label="Search words" placeholder="e.g. truck driver, copywriter, nurse" value={f.q} onChange={(e) => set('q', e.target.value)} />
              <SelectField label="Sector" value={f.categoryId} onChange={(e) => { set('categoryId', e.target.value); setCrit([]); }}>
                <option value="">Any sector</option>
                {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
              </SelectField>
              <SelectField label="Rank by my job" value={f.jobId} onChange={(e) => set('jobId', e.target.value)}>
                <option value="">No job (list by profile completeness)</option>
                {openJobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
              </SelectField>
              <SelectField label="Region" value={f.regionId} onChange={(e) => { set('regionId', e.target.value); set('zoneId', ''); }}>
                <option value="">Anywhere in Ethiopia</option>
                {regions.data?.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
              </SelectField>
              {f.regionId ? <ZoneSelect regionId={f.regionId} value={f.zoneId} onChange={(v) => set('zoneId', v)} /> : <div />}
              <TextField label="At least (years of experience)" inputMode="numeric" value={f.minYears} onChange={(e) => set('minYears', e.target.value.replace(/\D/g, ''))} />
              <SelectField label="Available" value={f.availableWithin} onChange={(e) => set('availableWithin', e.target.value)}>
                <option value="">Any time</option>
                <option value="immediate">Right now</option>
                <option value="two_weeks">Within 2 weeks</option>
                <option value="month">Within a month</option>
              </SelectField>
              <SelectField label="Education at least" value={f.minEducation} onChange={(e) => set('minEducation', e.target.value)}>
                <option value="">No minimum</option>
                {Object.entries(EDU_LABEL).filter(([k]) => k !== 'NONE').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </SelectField>
              <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium"><input type="checkbox" checked={f.verified} onChange={(e) => set('verified', e.target.checked)} />Has something verified by an administrator</label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
              <SkillFilter value={skills} onChange={setSkills} />
              {skills.length > 1 && (
                <SelectField label="Skills" value={f.skillsMode} onChange={(e) => set('skillsMode', e.target.value)}>
                  <option value="all">Must have all of them</option>
                  <option value="any">Any of them</option>
                </SelectField>
              )}
            </div>
          </Card>

          {f.categoryId && (
            <Card className="p-5">
              <h2 className="font-semibold">Sector answers</h2>
              <p className="mb-3 text-sm text-muted">Keep only workers who answered these questions the way you tick. People who have not answered a question are not shown.</p>
              <SectorRequirements categoryId={f.categoryId} value={crit} onChange={setCrit} filterMode />
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="accent" loading={result.isFetching}>Search</Button>
            <Button type="button" variant="ghost" onClick={reset}>Clear filters</Button>
          </div>
        </form>

        <section className="mt-8" aria-live="polite">
          {result.isLoading && <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
          {result.isError && <Alert tone="danger">{(result.error as Error)?.message || 'Could not search. Try again.'}</Alert>}
          {d && (
            <>
              <p className="mb-3 text-sm text-muted">
                {d.total === 0 ? 'No workers found.' : `${d.total} worker${d.total === 1 ? '' : 's'} found${d.job ? `, ranked by match to "${d.job.title}"` : ''}.`}
                {d.job && ' People who clearly lack a must-have for this job are left out.'}
              </p>
              {d.capped && <div className="mb-3"><Alert tone="info">Many workers match your filters; only the best-completed profiles were examined. Add filters (sector, skills, region) to see the rest.</Alert></div>}
              {d.items.length === 0 && result.isSuccess && (
                <EmptyState icon={Users} title="No workers match these filters" body="Try fewer filters, a wider region, or remove sector answers: workers who have not answered a question are not shown when you filter on it." />
              )}
              <ul className="space-y-3">
                {d.items.map((w) => {
                  const canPick = !!jobId && !w.applied && !w.invitation;
                  return <WorkerCard key={w.workerId} w={w} jobId={jobId} selected={picked.includes(w.workerId)} onToggle={canPick ? () => toggle(w.workerId) : undefined} />;
                })}
              </ul>
              {jobId && <BulkInviteBar jobId={jobId} selected={picked} names={Object.fromEntries(d.items.map((w) => [w.workerId, w.name]))} onClear={() => setPicked([])} />}
              {pages > 1 && (
                <div className="mt-5 flex items-center justify-center gap-3 text-sm">
                  <Button size="sm" variant="outline" disabled={d.page <= 1} onClick={() => goto(d.page - 1)}>Previous</Button>
                  <span>Page {d.page} of {pages}</span>
                  <Button size="sm" variant="outline" disabled={d.page >= pages} onClick={() => goto(d.page + 1)}>Next</Button>
                </div>
              )}
              <p className="mt-6 text-xs text-muted">Only workers who chose to be visible are shown, without contact details or exact location. A phone number is shown only if you shortlist someone who applied. Scores assist your judgement and never decide for you.</p>
            </>
          )}
        </section>
      </PageBody>
    </>
  );
}
