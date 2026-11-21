import { useI18n } from '@/i18n';
import { Link } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BadgeCheck, Crosshair, FileText, Paperclip, Trash2, Upload, User } from 'lucide-react';
import { Alert, Badge, Card, SelectField, TextAreaField, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import {
  ACTIVITY_LABEL, placeLabel, useCategories, useLocations, useProfileAction, useProtectedImage, useSkillSearch,
  LANGUAGE_LEVEL_LABEL, type ActivityKind, type LanguageLevel, type SaveState, type WorkerProfile,
} from '@/lib/profile';
import { cn } from '@/lib/cn';
import { VerifyControl } from '@/pages/worker/VerifyControl';
import { CvCheckPanel } from '@/components/CvCheckPanel';
import { useCvUpload } from '@/lib/cvCheck';

export function SectionCard({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <div id={id} className="scroll-mt-20">
      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        <div className="mt-5">{children}</div>
      </Card>
    </div>
  );
}

export function SaveStatus({ state }: { state: SaveState }) {
  if (state.status === 'saved') return <span role="status" className="text-sm font-medium text-success">Saved</span>;
  if (state.status === 'error') return <span role="alert" className="text-sm text-danger">{state.message}</span>;
  return null;
}

const toNum = (v: string | undefined) => (v === undefined || v.trim() === '' ? null : Number(v));
const numField = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 10_000_000), 'Enter a whole number');

// ───────── Basics ─────────

const basicsSchema = z.object({
  headline: z.string().trim().max(120),
  occupation: z.string().trim().max(100),
  categoryId: z.string(),
  yearsExperience: numField,
  bio: z.string().trim().max(2000),
  languages: z.string().trim(),
});
type BasicsValues = z.infer<typeof basicsSchema>;

export function BasicsForm({ profile }: { profile: WorkerProfile }) {
  const categories = useCategories();
  const save = useProfileAction((body: Record<string, unknown>) => api('/workers/me', { method: 'PATCH', body }));
  const { register, handleSubmit, formState: { errors } } = useForm<BasicsValues>({
    resolver: zodResolver(basicsSchema),
    defaultValues: {
      headline: profile.headline ?? '',
      occupation: profile.occupation ?? '',
      categoryId: profile.categoryId ?? '',
      yearsExperience: String(profile.yearsExperience),
      bio: profile.bio ?? '',
      languages: profile.languages.join(', '),
    },
  });
  return (
    <SectionCard id="section-about" title="About you" description="Employers see this first. Be specific about what you can do.">
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={handleSubmit((v) =>
          save.mutate({
            headline: v.headline,
            occupation: v.occupation,
            categoryId: v.categoryId || null,
            yearsExperience: toNum(v.yearsExperience) ?? 0,
            bio: v.bio,
            languages: v.languages.split(',').map((l) => l.trim()).filter(Boolean),
          }),
        )}
      >
        <div className="sm:col-span-2">
          <TextField voice label="Professional headline" placeholder="e.g. Experienced minibus mechanic" error={errors.headline?.message} {...register('headline')} />
        </div>
        <TextField label="Occupation" placeholder="e.g. Mechanic" error={errors.occupation?.message} {...register('occupation')} />
        <SelectField label="Professional category" {...register('categoryId')}>
          <option value="">–</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
        </SelectField>
        <TextField label="Years of experience" inputMode="numeric" error={errors.yearsExperience?.message} {...register('yearsExperience')} />
        <TextField label="Languages" hint="Separate with commas, e.g. Afaan Oromoo, Amharic, English" {...register('languages')} />
        <div className="sm:col-span-2">
          <TextAreaField voice label="Biography" hint="At least 20 characters to count towards completion" error={errors.bio?.message} {...register('bio')} />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="accent" loading={save.isPending}>Save</Button>
          <SaveStatus state={save.state} />
        </div>
      </form>
    </SectionCard>
  );
}

// ───────── More CV details ─────────

const cvDetailsSchema = z.object({
  objective: z.string().trim().max(600),
  website: z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Start with http:// or https://'),
  addressLine: z.string().trim().max(150),
  nationality: z.string().trim().max(60),
});

/** Extra details that only appear on the worker's own CV (and the objective, website and language levels on the profile employers see). */
export function CvDetailsForm({ profile }: { profile: WorkerProfile }) {
  const save = useProfileAction((body: Record<string, unknown>) => api('/workers/me', { method: 'PATCH', body }));
  const [levels, setLevels] = useState<Record<string, LanguageLevel | ''>>(() => ({ ...profile.languageLevels }));
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof cvDetailsSchema>>({
    resolver: zodResolver(cvDetailsSchema),
    defaultValues: { objective: profile.objective ?? '', website: profile.website ?? '', addressLine: profile.addressLine ?? '', nationality: profile.nationality ?? '' },
  });
  return (
    <SectionCard id="section-cvdetails" title="More CV details" description="These make your CV fuller. Your address and nationality appear only on the CV you build yourself, never on the profile employers see.">
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={handleSubmit((v) => {
          const kept = Object.fromEntries(profile.languages.flatMap((l) => (levels[l] ? [[l, levels[l]]] : [])));
          save.mutate({ objective: v.objective, website: v.website || null, addressLine: v.addressLine, nationality: v.nationality, languageLevels: kept });
        })}
      >
        <div className="sm:col-span-2">
          <TextAreaField label="Career objective" hint="One or two sentences on the work you want next" rows={2} error={errors.objective?.message} {...register('objective')} />
        </div>
        <TextField label="Website or LinkedIn link (optional)" placeholder="https://" error={errors.website?.message} {...register('website')} />
        <TextField label="Nationality (optional)" {...register('nationality')} />
        <div className="sm:col-span-2"><TextField label="Address (optional, CV only)" placeholder="e.g. Bole Sub City, House 12" {...register('addressLine')} /></div>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold">How well do you speak each language?</legend>
          {profile.languages.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Add your languages in “About you” first, then choose a level for each here.</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {profile.languages.map((l) => (
                <label key={l} className="flex items-center justify-between gap-3 text-sm">
                  <span>{l}</span>
                  <select aria-label={`Level for ${l}`} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={levels[l] ?? ''} onChange={(e) => setLevels({ ...levels, [l]: e.target.value as LanguageLevel | '' })}>
                    <option value="">Not stated</option>
                    {(Object.keys(LANGUAGE_LEVEL_LABEL) as LanguageLevel[]).map((k) => <option key={k} value={k}>{LANGUAGE_LEVEL_LABEL[k]}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="accent" loading={save.isPending}>Save</Button>
          <SaveStatus state={save.state} />
        </div>
      </form>
    </SectionCard>
  );
}

// ───────── Location ─────────

export function LocationPicker({ profile }: { profile: WorkerProfile }) {
  const save = useProfileAction((body: Record<string, unknown>) => api('/workers/me', { method: 'PATCH', body }));
  const [chain, setChain] = useState<string[]>(profile.locationPath.map((l) => l.id));
  useEffect(() => {
    setChain(profile.locationPath.map((l) => l.id));
  }, [profile.locationPath]);

  const labels = ['Region', 'Zone or city', 'Woreda', 'Kebele'];
  const levels = Math.min(chain.length + 1, 4);

  return (
    <SectionCard id="section-location" title="Where you can work" description="Pick the most specific area you know. Employers only see down to woreda.">
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: levels }, (_, i) => (
          <LocationLevel key={i} label={labels[i]} parentId={i === 0 ? undefined : chain[i - 1]} value={chain[i] ?? ''} onChange={(id) => setChain((c) => [...c.slice(0, i), ...(id ? [id] : [])])} />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="accent" loading={save.isPending} disabled={!chain.length} onClick={() => save.mutate({ locationId: chain[chain.length - 1] })}>
          Save location
        </Button>
        <SaveStatus state={save.state} />
      </div>
    </SectionCard>
  );
}

export function LocationLevel({ label, parentId, value, onChange }: { label: string; parentId?: string; value: string; onChange: (id: string) => void }) {
  const q = useLocations(parentId);
  const { locale } = useI18n();
  if (parentId && q.isSuccess && q.data.length === 0) return null;
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">–</option>
      {q.data?.map((l) => <option key={l.id} value={l.id}>{placeLabel(l, locale)}</option>)}
    </SelectField>
  );
}

// ───────── Preferences, availability and GPS ─────────

const TYPES: [string, string][] = [
  ['FULL_TIME', 'Full-time'], ['PART_TIME', 'Part-time'], ['TEMPORARY', 'Temporary'], ['CONTRACT', 'Contract'],
  ['FREELANCE', 'Freelance'], ['INTERNSHIP', 'Internship'], ['SEASONAL', 'Seasonal'], ['DAILY', 'Daily work'],
  ['PERMANENT', 'Permanent'], ['CASUAL', 'Casual'], ['APPRENTICESHIP', 'Apprenticeship'], ['VOLUNTEER', 'Volunteer (unpaid)'], ['GIG', 'Gig (short task)'], ['ON_CALL', 'On-call'],
];
const MODES: [string, string][] = [['ON_SITE', 'On-site'], ['REMOTE', 'Remote'], ['HYBRID', 'Hybrid']];
const AVAIL: [string, string][] = [
  ['IMMEDIATELY', 'Available immediately'], ['WITHIN_TWO_WEEKS', 'Within two weeks'], ['WITHIN_ONE_MONTH', 'Within a month'],
  ['FLEXIBLE', 'Flexible'], ['NOT_AVAILABLE', 'Not available right now'],
];

function CheckGroup({ legend, options, value, onChange }: { legend: string; options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, label]) => {
          const on = value.includes(v);
          return (
            <label key={v} className={cn('cursor-pointer select-none rounded-full border px-3 py-1.5 text-sm', on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface hover:bg-surface-2')}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])} />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const prefSchema = z
  .object({ min: numField, max: numField, maxTravel: numField, availableFrom: z.string(), availability: z.string() })
  .refine((v) => v.min === '' || v.max === '' || Number(v.min) <= Number(v.max), { path: ['max'], message: 'Maximum must be at least the minimum' });
type PrefValues = z.infer<typeof prefSchema>;

export function PreferencesForm({ profile }: { profile: WorkerProfile }) {
  const save = useProfileAction((body: Record<string, unknown>) => api('/workers/me', { method: 'PATCH', body }));
  const [types, setTypes] = useState(profile.preferredTypes);
  const [modes, setModes] = useState(profile.preferredWorkModes);
  const [relocate, setRelocate] = useState(profile.willingToRelocate);
  const [visible, setVisible] = useState(profile.isVisible);
  const { register, handleSubmit, formState: { errors } } = useForm<PrefValues>({
    resolver: zodResolver(prefSchema),
    defaultValues: {
      min: profile.expectedSalaryMin?.toString() ?? '',
      max: profile.expectedSalaryMax?.toString() ?? '',
      maxTravel: profile.maxTravelKm?.toString() ?? '',
      availableFrom: profile.availableFrom?.slice(0, 10) ?? '',
      availability: profile.availability,
    },
  });
  return (
    <SectionCard id="section-preferences" title="Job preferences and availability" description="Used to match you with suitable jobs. Salary is in Ethiopian birr (ETB) per month.">
      <form
        noValidate
        className="space-y-5"
        onSubmit={handleSubmit((v) =>
          save.mutate({
            expectedSalaryMin: toNum(v.min), expectedSalaryMax: toNum(v.max), maxTravelKm: toNum(v.maxTravel),
            availability: v.availability, availableFrom: v.availableFrom || null,
            preferredTypes: types, preferredWorkModes: modes, willingToRelocate: relocate, isVisible: visible,
          }),
        )}
      >
        <CheckGroup legend="Employment types you want" options={TYPES} value={types} onChange={setTypes} />
        <CheckGroup legend="Work arrangement" options={MODES} value={modes} onChange={setModes} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Expected salary from" inputMode="numeric" {...register('min')} error={errors.min?.message} />
          <TextField label="Expected salary to" inputMode="numeric" {...register('max')} error={errors.max?.message} />
          <TextField label="Willing to travel (km)" inputMode="numeric" {...register('maxTravel')} error={errors.maxTravel?.message} />
          <SelectField label="Availability" {...register('availability')}>
            {AVAIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <TextField label="Available from" type="date" {...register('availableFrom')} />
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={relocate} onChange={(e) => setRelocate(e.target.checked)} /> I am willing to relocate</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Let employers find my profile in search</label>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="accent" loading={save.isPending}>Save preferences</Button>
          <SaveStatus state={save.state} />
        </div>
      </form>
    </SectionCard>
  );
}

export function GpsCard({ profile }: { profile: WorkerProfile }) {
  const save = useProfileAction((body: Record<string, unknown>) => api('/workers/me', { method: 'PATCH', body }));
  const [geoError, setGeoError] = useState<string | null>(null);
  const has = profile.lat !== null && profile.lng !== null;

  function locate() {
    setGeoError(null);
    if (!navigator.geolocation) return setGeoError('This device does not support location.');
    navigator.geolocation.getCurrentPosition(
      (pos) => save.mutate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeoError('Location permission was denied or unavailable. You can skip this.'),
      { timeout: 10_000 },
    );
  }
  return (
    <SectionCard title="GPS location (optional)" description="Lets us rank nearby jobs by real distance. Employers only ever see an approximate area (about 1 km), never your exact position.">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={locate} loading={save.isPending}><Crosshair className="h-4 w-4" aria-hidden /> {has ? 'Update my location' : 'Use my current location'}</Button>
        {has && <Button variant="ghost" onClick={() => save.mutate({ lat: null, lng: null })}>Remove</Button>}
        {has && <Badge tone="success">Location saved</Badge>}
        <SaveStatus state={save.state} />
      </div>
      {geoError && <p className="mt-3 text-sm text-warning">{geoError}</p>}
    </SectionCard>
  );
}

// ───────── Skills ─────────

function SourceBadge({ source }: { source: string }) {
  return source === 'VERIFIED' ? (
    <Badge tone="success"><BadgeCheck className="h-3 w-3" aria-hidden /> Verified</Badge>
  ) : (
    <Badge>Self-reported</Badge>
  );
}

export function SkillsSection({ profile }: { profile: WorkerProfile }) {
  const [q, setQ] = useState('');
  const results = useSkillSearch(q);
  const upsert = useProfileAction((a: { skillId: string; proficiency: number }) =>
    api(`/workers/me/skills/${a.skillId}`, { method: 'PUT', body: { proficiency: a.proficiency } }),
  );
  const remove = useProfileAction((skillId: string) => api(`/workers/me/skills/${skillId}`, { method: 'DELETE' }));
  const owned = new Set(profile.skills.map((s) => s.skillId));

  return (
    <SectionCard id="section-skills" title="Skills" description="Add what you can actually do. Skills are marked self-reported until an administrator verifies them. Three or more skills count towards completion.">
      <TextField label="Search skills" placeholder="e.g. welding, cooking, driving" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Skill search results">
          {results.isLoading && <li className="text-sm text-muted">Searching…</li>}
          {results.data?.length === 0 && <li className="text-sm text-muted">No skills found. Try a different word.</li>}
          {results.data?.filter((s) => !owned.has(s.id)).map((s) => (
            <li key={s.id}>
              <button type="button" className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent hover:text-accent" onClick={() => { upsert.mutate({ skillId: s.id, proficiency: 3 }); setQ(''); }}>
                + {s.nameEn}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-5 divide-y divide-border">
        {profile.skills.length === 0 && <li className="py-3 text-sm text-muted">No skills yet. Search above to add your first one.</li>}
        {profile.skills.length > 0 && <li className="py-3 text-sm"><Link to="/skill-tests" className="font-medium text-accent hover:underline">Take a skill test</Link> <span className="text-muted">to show employers what you know. A passed test adds a Tested mark.</span></li>}
        {profile.skills.map((s) => (
          <li key={s.skillId} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-40 flex-1 font-medium">{s.name}</span>
            <SourceBadge source={s.source} />
            {s.tested && <Badge tone="info">Tested {s.tested.score}%</Badge>}
            {s.source !== 'VERIFIED' && <VerifyControl targetType="SKILL" targetId={s.skillId} />}
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">Level</span>
              <select
                aria-label={`Proficiency for ${s.name}`}
                className="h-9 rounded-lg border border-border bg-surface px-2"
                value={s.proficiency}
                onChange={(e) => upsert.mutate({ skillId: s.skillId, proficiency: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {['', 'Beginner', 'Basic', 'Competent', 'Advanced', 'Expert'][n]}</option>)}
              </select>
            </label>
            <button type="button" aria-label={`Remove ${s.name}`} className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => remove.mutate(s.skillId)}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 h-5"><SaveStatus state={upsert.state.status !== 'idle' ? upsert.state : remove.state} /></div>
    </SectionCard>
  );
}

// ───────── Work history, education, certifications ─────────

export const EDU_LEVELS: [string, string][] = [
  ['NONE', 'No formal education'], ['PRIMARY', 'Primary'], ['SECONDARY', 'Secondary'], ['VOCATIONAL_CERTIFICATE', 'Vocational certificate (TVET)'],
  ['DIPLOMA', 'Diploma'], ['BACHELOR', "Bachelor's degree"], ['MASTER', "Master's degree"], ['DOCTORATE', 'Doctorate'],
];

function ListShell({ id, title, description, empty, items, form }: { id?: string; title: string; description?: string; empty: string; items: ReactNode[]; form: ReactNode }) {
  return (
    <SectionCard id={id} title={title} description={description}>
      {items.length === 0 ? <p className="mb-4 text-sm text-muted">{empty}</p> : <ul className="mb-5 divide-y divide-border">{items}</ul>}
      {form}
    </SectionCard>
  );
}

function Row({ children, onDelete, label }: { children: ReactNode; onDelete: () => void; label: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex-1 text-sm">{children}</div>
      <button type="button" aria-label={label} className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" onClick={onDelete}>
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}

const expSchema = z.object({ title: z.string().trim().min(2, 'Enter a job title'), employer: z.string().trim(), startDate: z.string().min(1, 'Choose a start date'), endDate: z.string(), description: z.string().trim(), location: z.string().trim().max(120), employmentType: z.string(), reasonLeft: z.string().trim().max(200), achievements: z.string().trim().max(1000) });
export function ExperienceSection({ profile }: { profile: WorkerProfile }) {
  const add = useProfileAction((body: Record<string, unknown>) => api('/workers/me/experience', { method: 'POST', body }));
  const del = useProfileAction((id: string) => api(`/workers/me/experience/${id}`, { method: 'DELETE' }));
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof expSchema>>({ resolver: zodResolver(expSchema), defaultValues: { title: '', employer: '', startDate: '', endDate: '', description: '', location: '', employmentType: '', reasonLeft: '', achievements: '' } });
  return (
    <ListShell
      id="section-experience"
      title="Work history"
      empty="No work history yet. Informal and daily work counts too."
      items={profile.experiences.map((e) => (
        <Row key={e.id} label={`Delete ${e.title}`} onDelete={() => del.mutate(e.id)}>
          <p className="flex flex-wrap items-center gap-2 font-medium">{e.title}{e.employer ? ` · ${e.employer}` : ''} <SourceBadge source={e.source} /> {e.source !== 'VERIFIED' && <VerifyControl targetType="EXPERIENCE" targetId={e.id} />}</p>
          <p className="text-muted">{[`${e.startDate.slice(0, 7)} to ${e.endDate ? e.endDate.slice(0, 7) : 'present'}`, e.location, e.employmentType && (TYPES.find(([k]) => k === e.employmentType)?.[1] ?? e.employmentType)].filter(Boolean).join(' · ')}</p>
          {e.description && <p className="mt-1">{e.description}</p>}
          {e.achievements && <p className="mt-1"><span className="font-medium">Achievements:</span> {e.achievements}</p>}
          {e.reasonLeft && <p className="mt-1 text-muted">Reason for leaving: {e.reasonLeft}</p>}
        </Row>
      ))}
      form={
        <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => add.mutate({ title: v.title, employer: v.employer, startDate: v.startDate, endDate: v.endDate || null, description: v.description, location: v.location, employmentType: v.employmentType || null, reasonLeft: v.endDate ? v.reasonLeft : '', achievements: v.achievements }, { onSuccess: () => reset() }))}>
          <TextField label="Job title" error={errors.title?.message} {...register('title')} />
          <TextField label="Employer or place" {...register('employer')} />
          <TextField label="Start" type="month" error={errors.startDate?.message} {...register('startDate')} />
          <TextField label="End (leave empty if current)" type="month" {...register('endDate')} />
          <TextField label="Where was the job? (town or city)" {...register('location')} />
          <SelectField label="Type of work" {...register('employmentType')}>
            <option value="">–</option>
            {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </SelectField>
          <div className="sm:col-span-2"><TextAreaField label="What did you do?" className="min-h-20" {...register('description')} /></div>
          <div className="sm:col-span-2"><TextAreaField label="What did you achieve? (optional)" hint="For example: trained 3 new workers, finished 40 gates, never missed a delivery" rows={2} {...register('achievements')} /></div>
          <div className="sm:col-span-2"><TextField label="Why did you leave? (optional, only for jobs that ended)" {...register('reasonLeft')} /></div>
          <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" variant="outline" loading={add.isPending}>Add work history</Button><SaveStatus state={add.state.status !== 'idle' ? add.state : del.state} /></div>
        </form>
      }
    />
  );
}

const eduSchema = z
  .object({
    level: z.string().min(1), field: z.string().trim(), institution: z.string().trim(), department: z.string().trim(),
    gpa: z.string().refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0), 'Enter a number'),
    gpaScale: z.string().refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) > 0), 'Enter a number'),
    year: z.string().refine((v) => v === '' || /^\d{4}$/.test(v), 'Enter a 4-digit year'),
  })
  .superRefine((v, ctx) => {
    if (v.gpa !== '' && v.gpaScale === '') ctx.addIssue({ code: 'custom', path: ['gpaScale'], message: 'Scale, for example 4 or 100' });
    if (v.gpa !== '' && v.gpaScale !== '' && Number(v.gpa) > Number(v.gpaScale)) ctx.addIssue({ code: 'custom', path: ['gpa'], message: 'Cannot be above the scale' });
  });

/** Attach a supporting document (PDF, JPG or PNG up to 5 MB) to an education, certificate or activity row. */
function DocumentControl({ section, id, documentUrl }: { section: 'education' | 'certifications' | 'activities'; id: string; documentUrl: string | null }) {
  const up = useProfileAction((file: File) => {
    const body = new FormData();
    body.append('file', file);
    return api(`/workers/me/${section}/${id}/document`, { method: 'POST', body });
  });
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <label className="inline-flex cursor-pointer items-center gap-1 text-accent hover:underline">
        <Paperclip className="h-3.5 w-3.5" aria-hidden />
        {up.isPending ? 'Uploading…' : documentUrl ? 'Replace document' : 'Add document'}
        <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} />
      </label>
      {documentUrl && <span className="text-success">Document attached</span>}
      {up.state.status === 'error' && <span role="alert" className="text-danger">{up.state.message}</span>}
    </span>
  );
}
export function EducationSection({ profile }: { profile: WorkerProfile }) {
  const add = useProfileAction((body: Record<string, unknown>) => api('/workers/me/education', { method: 'POST', body }));
  const del = useProfileAction((id: string) => api(`/workers/me/education/${id}`, { method: 'DELETE' }));
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof eduSchema>>({ resolver: zodResolver(eduSchema), defaultValues: { level: 'SECONDARY', field: '', institution: '', department: '', gpa: '', gpaScale: '4', year: '' } });
  return (
    <ListShell
      title="Education"
      description="Optional. No school or GPA? Leave this empty: practical skills, apprenticeships and references count too."
      empty="No education added."
      items={profile.education.map((e) => (
        <Row key={e.id} label="Delete education" onDelete={() => del.mutate(e.id)}>
          <p className="flex flex-wrap items-center gap-2 font-medium">{EDU_LEVELS.find(([v]) => v === e.level)?.[1]}{e.field ? ` · ${e.field}` : ''} <SourceBadge source={e.source} /> {e.source !== 'VERIFIED' && <VerifyControl targetType="EDUCATION" targetId={e.id} />}</p>
          <p className="text-muted">{[e.institution, e.department, e.year].filter(Boolean).join(' · ')}{e.gpa != null ? ` · GPA ${e.gpa}/${e.gpaScale}` : ''}</p>
          <DocumentControl section="education" id={e.id} documentUrl={e.documentUrl} />
        </Row>
      ))}
      form={
        <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => add.mutate({ level: v.level, field: v.field, institution: v.institution, department: v.department, gpa: v.gpa ? Number(v.gpa) : null, gpaScale: v.gpa ? Number(v.gpaScale) : null, year: v.year ? Number(v.year) : null }, { onSuccess: () => reset() }))}>
          <SelectField label="Level" {...register('level')}>{EDU_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
          <TextField label="Field of study" {...register('field')} />
          <TextField label="University, college or school" {...register('institution')} />
          <TextField label="Department" {...register('department')} />
          <TextField label="GPA (optional)" inputMode="decimal" error={errors.gpa?.message} {...register('gpa')} />
          <TextField label="GPA scale (for example 4 or 100)" inputMode="decimal" error={errors.gpaScale?.message} {...register('gpaScale')} />
          <TextField label="Year" inputMode="numeric" error={errors.year?.message} {...register('year')} />
          <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" variant="outline" loading={add.isPending}>Add education</Button><SaveStatus state={add.state.status !== 'idle' ? add.state : del.state} /></div>
        </form>
      }
    />
  );
}

const certSchema = z.object({ name: z.string().trim().min(2, 'Enter the certificate name'), issuer: z.string().trim(), year: z.string().refine((v) => v === '' || /^\d{4}$/.test(v), 'Enter a 4-digit year') });
export function CertificationsSection({ profile }: { profile: WorkerProfile }) {
  const add = useProfileAction((body: Record<string, unknown>) => api('/workers/me/certifications', { method: 'POST', body }));
  const del = useProfileAction((id: string) => api(`/workers/me/certifications/${id}`, { method: 'DELETE' }));
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof certSchema>>({ resolver: zodResolver(certSchema), defaultValues: { name: '', issuer: '', year: '' } });
  return (
    <ListShell
      title="Certifications and training"
      empty="No certifications added."
      items={profile.certifications.map((c) => (
        <Row key={c.id} label={`Delete ${c.name}`} onDelete={() => del.mutate(c.id)}>
          <p className="flex flex-wrap items-center gap-2 font-medium">{c.name} <SourceBadge source={c.source} /> {c.source !== 'VERIFIED' && <VerifyControl targetType="CERTIFICATION" targetId={c.id} />}</p>
          <p className="text-muted">{[c.issuer, c.year].filter(Boolean).join(' · ')}</p>
          <DocumentControl section="certifications" id={c.id} documentUrl={c.documentUrl} />
        </Row>
      ))}
      form={
        <form noValidate className="grid gap-3 sm:grid-cols-3" onSubmit={handleSubmit((v) => add.mutate({ name: v.name, issuer: v.issuer, year: v.year ? Number(v.year) : null }, { onSuccess: () => reset() }))}>
          <TextField label="Certificate" error={errors.name?.message} {...register('name')} />
          <TextField label="Issued by" {...register('issuer')} />
          <TextField label="Year" inputMode="numeric" error={errors.year?.message} {...register('year')} />
          <div className="flex items-center gap-3 sm:col-span-3"><Button type="submit" variant="outline" loading={add.isPending}>Add certification</Button><SaveStatus state={add.state.status !== 'idle' ? add.state : del.state} /></div>
        </form>
      }
    />
  );
}

const actSchema = z.object({
  kind: z.string().min(1), title: z.string().trim().min(2, 'Enter at least 2 characters'), organization: z.string().trim(),
  startDate: z.string(), endDate: z.string(), hours: z.string().refine((v) => v === '' || /^\d+$/.test(v), 'Whole number'), description: z.string().trim(),
}).refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'End must be after the start' });

/** Internships, volunteering, training, apprenticeships (learning a trade) and references: especially useful with little formal schooling. */
export function ActivitiesSection({ profile }: { profile: WorkerProfile }) {
  const add = useProfileAction((body: Record<string, unknown>) => api('/workers/me/activities', { method: 'POST', body }));
  const del = useProfileAction((id: string) => api(`/workers/me/activities/${id}`, { method: 'DELETE' }));
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<z.infer<typeof actSchema>>({
    resolver: zodResolver(actSchema), defaultValues: { kind: 'TRAINING', title: '', organization: '', startDate: '', endDate: '', hours: '', description: '' },
  });
  const isRef = watch('kind') === 'REFERENCE';
  const isAward = watch('kind') === 'AWARD';
  return (
    <ListShell
      title="Internships, volunteering, training, awards and references"
      description="For everyone, and especially if you learned your work outside a school: an apprenticeship with a master, a training course, volunteer service, a prize or award you won, or a person who can vouch for your skills. We do not store the reference's phone number."
      empty="Nothing added yet."
      items={profile.activities.map((a) => (
        <Row key={a.id} label={`Delete ${a.title}`} onDelete={() => del.mutate(a.id)}>
          <p className="flex flex-wrap items-center gap-2 font-medium">{a.title} <Badge tone="neutral">{ACTIVITY_LABEL[a.kind as ActivityKind].split(' (')[0]}</Badge> <SourceBadge source={a.source} /></p>
          <p className="text-muted">{[a.organization, a.startDate && `${a.startDate.slice(0, 7)} to ${a.endDate ? a.endDate.slice(0, 7) : 'now'}`, a.hours && `${a.hours} hours`].filter(Boolean).join(' · ')}</p>
          {a.kind !== 'REFERENCE' && <DocumentControl section="activities" id={a.id} documentUrl={a.documentUrl} />}
        </Row>
      ))}
      form={
        <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => add.mutate({
          kind: v.kind, title: v.title, organization: v.organization, startDate: v.startDate || null, endDate: v.endDate || null, hours: v.hours ? Number(v.hours) : null, description: v.description,
        }, { onSuccess: () => reset() }))}>
          <SelectField label="Type" {...register('kind')}>{(Object.keys(ACTIVITY_LABEL) as ActivityKind[]).map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}</SelectField>
          <TextField label={isRef ? "Person's name" : isAward ? 'Name of the award' : 'What (role, course or trade)'} error={errors.title?.message} {...register('title')} />
          <TextField label={isRef ? 'Who they are to you (former employer, master, village elder…)' : isAward ? 'Given by' : 'Where (company, NGO, training centre, workshop)'} {...register('organization')} />
          {!isRef && <TextField label="Hours (optional)" inputMode="numeric" error={errors.hours?.message} {...register('hours')} />}
          {!isRef && <TextField label="Start" type="date" {...register('startDate')} />}
          {!isRef && <TextField label="End" type="date" error={errors.endDate?.message} {...register('endDate')} />}
          <div className="sm:col-span-2"><TextAreaField label="Details (optional)" rows={2} {...register('description')} /></div>
          <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" variant="outline" loading={add.isPending}>Add</Button><SaveStatus state={add.state.status !== 'idle' ? add.state : del.state} /></div>
        </form>
      }
    />
  );
}

// ───────── Photo and CV ─────────

function UploadButton({ label, accept, onFile, busy }: { label: string; accept: string; onFile: (f: File) => void; busy: boolean }) {
  return (
    <label className={cn('inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-semibold hover:bg-surface-2', busy && 'pointer-events-none opacity-60')}>
      <Upload className="h-4 w-4" aria-hidden /> {busy ? 'Uploading…' : label}
      <input type="file" accept={accept} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </label>
  );
}

export function FilesSection({ profile }: { profile: WorkerProfile }) {
  const photo = useProtectedImage(profile.photoUrl);
  const up = useProfileAction((a: { kind: 'photo' | 'cv'; file: File }) => {
    const body = new FormData();
    body.append('file', a.file);
    return api(`/workers/me/${a.kind}`, { method: 'POST', body });
  });
  const del = useProfileAction((kind: 'photo' | 'cv') => api(`/workers/me/${kind}`, { method: 'DELETE' }));
  // A CV is compared with the profile when it is uploaded: it is accepted (and the jobs that fit are shown) or declined with the reasons.
  const cvUp = useCvUpload();
  const [dlError, setDlError] = useState<string | null>(null);

  async function downloadCv() {
    setDlError(null);
    try {
      const { fetchBlobUrl } = await import('@/lib/api');
      const url = await fetchBlobUrl(profile.cvUrl!);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-cv.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setDlError('Could not download the CV.');
    }
  }

  return (
    <SectionCard id="photo-and-cv" title="Photo and CV" description="Photo: JPG or PNG up to 2 MB. CV: PDF up to 5 MB. Your CV is checked against your profile when you upload it, and is private until you apply.">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-muted">
            {photo ? <img src={photo} alt="Your profile" className="h-full w-full object-cover" /> : <User className="h-8 w-8" aria-hidden />}
          </div>
          <div className="space-y-2">
            <UploadButton label={profile.photoUrl ? 'Change photo' : 'Upload photo'} accept="image/jpeg,image/png" busy={up.isPending} onFile={(file) => up.mutate({ kind: 'photo', file })} />
            {profile.photoUrl && <button type="button" className="block text-sm text-danger hover:underline" onClick={() => del.mutate('photo')}>Remove photo</button>}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-muted" aria-hidden /> {profile.cvUrl ? 'CV uploaded' : 'No CV uploaded'}</div>
          <div className="flex flex-wrap items-center gap-3">
            <UploadButton label={profile.cvUrl ? 'Replace CV' : 'Upload CV (PDF or photo)'} accept="application/pdf,image/jpeg,image/png" busy={cvUp.isPending} onFile={(file) => cvUp.mutate(file)} />
            {profile.cvUrl && <Button variant="ghost" size="sm" onClick={downloadCv}>Download</Button>}
            {profile.cvUrl && <button type="button" className="text-sm text-danger hover:underline" onClick={() => del.mutate('cv')}>Remove</button>}
          </div>
        </div>
      </div>
      {cvUp.isPending && <p role="status" className="mt-3 text-sm text-muted">Reading your CV and comparing it with your profile. A photo can take up to a minute.</p>}
      <CvCheckPanel opportunities={cvUp.data?.opportunities} error={cvUp.error} />
      <div className="mt-3 min-h-5">
        <SaveStatus state={up.state.status !== 'idle' ? up.state : del.state} />
        {dlError && <Alert tone="danger">{dlError}</Alert>}
      </div>
    </SectionCard>
  );
}
