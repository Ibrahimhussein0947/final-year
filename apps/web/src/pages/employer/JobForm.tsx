import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { X } from 'lucide-react';
import { Alert, Badge, SelectField, Skeleton, TextAreaField, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { LocationLevel, SectionCard } from '@/pages/worker/sections';
import { JobAnalysisPanel, type AnalysisSelection } from '@/pages/employer/JobAnalysis';
import { api, ApiError } from '@/lib/api';
import type { JobRequirement } from '@/lib/criteria';
import { SectorRequirements } from '@/pages/employer/SectorRequirements';
import { useCategories, useSkillSearch } from '@/lib/profile';
import { useJob, type JobDetail } from '@/lib/jobs';
import { EDU_LABEL, MODE_LABEL, TYPE_LABEL } from '@/lib/format';
import { HiringRulesNotice } from '@/components/HiringRulesNotice';

const int = (max: number) => z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= max), 'Enter a whole number');

const schema = z
  .object({
    title: z.string().trim().min(5, 'Use at least 5 characters').max(150),
    description: z.string().trim().min(30, 'Describe the job in at least 30 characters').max(10_000),
    categoryId: z.string().min(1, 'Choose a category'),
    employmentType: z.string().min(1),
    workMode: z.string().min(1),
    vacancies: z.string().trim().regex(/^[1-9]\d{0,2}$/, 'Enter 1 or more'),
    salaryMin: int(10_000_000),
    salaryMax: int(10_000_000),
    schedule: z.string().trim().max(300),
    benefits: z.string().trim().max(1000),
    startDate: z.string(),
    deadline: z.string(),
    referenceNumber: z.string().trim().max(40, 'At most 40 characters').refine((v) => v === '' || /^[A-Za-z0-9][A-Za-z0-9 ./_-]*$/.test(v), 'Use letters, digits, spaces and . / _ -'),
    minExperienceYears: int(50),
    requiredEducationLevel: z.string(),
    languages: z.string().trim(),
  })
  .refine((v) => v.salaryMin === '' || v.salaryMax === '' || Number(v.salaryMin) <= Number(v.salaryMax), { path: ['salaryMax'], message: 'Maximum must be at least the minimum' });
type Values = z.infer<typeof schema>;
type PickedSkill = { skillId: string; name: string; importance: 'REQUIRED' | 'PREFERRED' };

const num = (v: string) => (v.trim() === '' ? null : Number(v));

function SkillPicker({ value, onChange }: { value: PickedSkill[]; onChange: (v: PickedSkill[]) => void }) {
  const [q, setQ] = useState('');
  const results = useSkillSearch(q);
  const have = new Set(value.map((s) => s.skillId));
  return (
    <div>
      <TextField label="Search skills to add" placeholder="e.g. welding, driving, cooking" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Skill search results">
          {results.data?.length === 0 && <li className="text-sm text-muted">No skills found.</li>}
          {results.data?.filter((s) => !have.has(s.id)).map((s) => (
            <li key={s.id}>
              <button type="button" className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent hover:text-accent" onClick={() => { onChange([...value, { skillId: s.id, name: s.nameEn, importance: 'REQUIRED' }]); setQ(''); }}>
                + {s.nameEn}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-4 divide-y divide-border">
        {value.length === 0 && <li className="py-2 text-sm text-muted">No skills added yet. At least one required skill is needed to publish.</li>}
        {value.map((s) => (
          <li key={s.skillId} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-36 flex-1 font-medium">{s.name}</span>
            <select
              aria-label={`Importance of ${s.name}`}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
              value={s.importance}
              onChange={(e) => onChange(value.map((x) => (x.skillId === s.skillId ? { ...x, importance: e.target.value as PickedSkill['importance'] } : x)))}
            >
              <option value="REQUIRED">Required</option>
              <option value="PREFERRED">Nice to have</option>
            </select>
            <button type="button" aria-label={`Remove ${s.name}`} className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" onClick={() => onChange(value.filter((x) => x.skillId !== s.skillId))}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Form({ job }: { job?: JobDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const categories = useCategories();
  const [chain, setChain] = useState<string[]>(job?.locationPath.map((l) => l.id) ?? []);
  const [skills, setSkills] = useState<PickedSkill[]>(job?.allSkills.map((s) => ({ skillId: s.skillId, name: s.name, importance: s.importance })) ?? []);
  const [criteria, setCriteria] = useState<JobRequirement[]>(job?.criteria?.map((c) => ({ criterionId: c.criterionId, importance: c.importance, value: c.value })) ?? []);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [error, setError] = useState<{ message: string; details?: string[]; duplicate?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = job?.status === 'CLOSED' || job?.status === 'FILLED';

  const [reviewed, setReviewed] = useState(false);
  const { register, handleSubmit, setValue, watch, getValues, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: job?.title ?? '', description: job?.description ?? '', categoryId: job?.categoryId ?? '',
      employmentType: job?.employmentType ?? 'FULL_TIME', workMode: job?.workMode ?? 'ON_SITE', vacancies: String(job?.vacancies ?? 1),
      salaryMin: job?.salaryMin?.toString() ?? '', salaryMax: job?.salaryMax?.toString() ?? '',
      schedule: job?.schedule ?? '', benefits: job?.benefits ?? '',
      startDate: job?.startDate?.slice(0, 10) ?? '',
      // The server stores the deadline as end of day in Ethiopia (UTC+3); show that calendar day.
      deadline: job?.deadline ? new Date(new Date(job.deadline).getTime() + 3 * 3600_000).toISOString().slice(0, 10) : '',
      referenceNumber: job?.referenceNumber ?? '',
      minExperienceYears: job?.minExperienceYears?.toString() ?? '', requiredEducationLevel: job?.requiredEducationLevel ?? '',
      languages: job?.languages.join(', ') ?? '',
    },
  });

  /** Copy the suggestions the employer ticked into the form. Everything stays editable. */
  function applyAnalysis(a: AnalysisSelection) {
    setSkills((prev) => {
      const map = new Map(prev.map((s) => [s.skillId, s]));
      a.skills.forEach((s) => map.set(s.skillId, { skillId: s.skillId, name: s.name, importance: s.importance }));
      return [...map.values()];
    });
    const opts = { shouldDirty: true } as const;
    if ('minExperienceYears' in a) setValue('minExperienceYears', a.minExperienceYears == null ? '' : String(a.minExperienceYears), opts);
    if ('requiredEducationLevel' in a) setValue('requiredEducationLevel', a.requiredEducationLevel ?? '', opts);
    if (a.employmentType) setValue('employmentType', a.employmentType, opts);
    if (a.workMode) setValue('workMode', a.workMode, opts);
    if (a.categoryId) setValue('categoryId', a.categoryId, opts);
    if (a.languages) {
      const have = getValues('languages').split(',').map((l) => l.trim()).filter(Boolean);
      setValue('languages', [...new Set([...have, ...a.languages])].join(', '), opts);
    }
    if (a.salary) {
      if (a.salary.min != null) setValue('salaryMin', String(a.salary.min), opts);
      if (a.salary.max != null) setValue('salaryMax', String(a.salary.max), opts);
    }
    setReviewed(true); // the employer looked at the suggestions and chose what to keep
  }

  const payload = (v: Values) => ({
    ...(reviewed ? { extractionReviewed: true } : {}),
    title: v.title, description: v.description, categoryId: v.categoryId,
    employmentType: v.employmentType, workMode: v.workMode, vacancies: Number(v.vacancies),
    salaryMin: num(v.salaryMin), salaryMax: num(v.salaryMax), schedule: v.schedule, benefits: v.benefits,
    startDate: v.startDate || null, deadline: v.deadline || null, referenceNumber: v.referenceNumber || null,
    minExperienceYears: num(v.minExperienceYears), requiredEducationLevel: v.requiredEducationLevel || null,
    languages: v.languages.split(',').map((l) => l.trim()).filter(Boolean),
    locationId: chain[chain.length - 1] ?? null,
    skills: skills.map((s) => ({ skillId: s.skillId, importance: s.importance })),
    criteria,
  });

  function showError(e: unknown) {
    if (e instanceof ApiError) {
      const details = Object.values(e.details ?? {}).flat().filter((d) => typeof d === 'string') as string[];
      setError({ message: e.message, details: e.code === 'NEAR_DUPLICATE_JOB' ? [] : details, duplicate: e.code === 'NEAR_DUPLICATE_JOB' });
    } else setError({ message: 'Could not reach the server. Check your connection and try again.' });
  }

  async function save(v: Values): Promise<string> {
    if (job) {
      if (!locked) await api(`/jobs/${job.id}`, { method: 'PATCH', body: payload(v) });
      return job.id;
    }
    return (await api<{ job: { id: string } }>('/jobs', { method: 'POST', body: payload(v) })).job.id;
  }
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['my-jobs'] }), qc.invalidateQueries({ queryKey: ['job'] }), qc.invalidateQueries({ queryKey: ['jobs'] })]);

  const onSave = handleSubmit(async (v) => {
    setBusy('save'); setError(null); setNotice(null);
    try {
      const id = await save(v);
      await refresh();
      if (!job) navigate(`/employer/jobs/${id}/edit`, { replace: true, state: { saved: true } });
      else setNotice('Changes saved.');
    } catch (e) { showError(e); } finally { setBusy(null); }
  });

  const publish = (confirmNotDuplicate: boolean) =>
    handleSubmit(async (v) => {
      setBusy('publish'); setError(null); setNotice(null);
      try {
        const id = await save(v);
        const r = await api<{ job: { status: string } }>(`/jobs/${id}/publish`, { method: 'POST', body: { confirmNotDuplicate } });
        await refresh();
        navigate(r.job.status === 'ACTIVE' ? `/jobs/${id}` : '/employer/jobs', { state: { published: r.job.status } });
      } catch (e) { showError(e); } finally { setBusy(null); }
    });

  const canPublish = !job || job.status === 'DRAFT';

  return (
    <form noValidate className="space-y-5" onSubmit={onSave}>
        <HiringRulesNotice />
      {locked && <Alert tone="warning">This job is closed. Reopen it from your jobs list to make changes.</Alert>}
      <fieldset disabled={locked} className="space-y-5">
        <SectionCard title="The job">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><TextField voice label="Job title" placeholder="e.g. Minibus mechanic" error={errors.title?.message} {...register('title')} /></div>
            <SelectField label="Category" error={errors.categoryId?.message} {...register('categoryId')}>
              <option value="">–</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
            </SelectField>
            <SelectField label="Employment type" {...register('employmentType')}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
            <SelectField label="Work arrangement" {...register('workMode')}>
              {Object.entries(MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
            <TextField label="Number of vacancies" inputMode="numeric" error={errors.vacancies?.message} {...register('vacancies')} />
            <div className="sm:col-span-2"><TextAreaField voice label="Description" className="min-h-40" hint="Duties, working conditions, and anything a candidate should know." error={errors.description?.message} {...register('description')} /></div>
          </div>
          <JobAnalysisPanel title={watch('title')} description={watch('description')} onApply={applyAnalysis} />
        </SectionCard>

        <SectionCard title="Location" description="Required for on-site and hybrid jobs.">
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: Math.min(chain.length + 1, 4) }, (_, i) => (
              <LocationLevel key={i} label={['Region', 'Zone or city', 'Woreda', 'Kebele'][i]} parentId={i === 0 ? undefined : chain[i - 1]} value={chain[i] ?? ''}
                onChange={(id) => setChain((c) => [...c.slice(0, i), ...(id ? [id] : [])])} />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Requirements" description="Be realistic. Leave experience and qualification empty if they are not essential: skilled people without certificates are matched too.">
          <SkillPicker value={skills} onChange={setSkills} />
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <TextField label="Minimum experience (years)" inputMode="numeric" error={errors.minExperienceYears?.message} {...register('minExperienceYears')} />
            <SelectField label="Minimum qualification" {...register('requiredEducationLevel')}>
              <option value="">None required</option>
              {Object.entries(EDU_LABEL).filter(([v]) => v !== 'NONE').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
            <TextField label="Languages" hint="Comma separated" {...register('languages')} />
          </div>
        </SectionCard>

        <SectionCard title="Sector requirements" description="Licences, certificates, shifts and tools that matter in this sector. Only ask for what the work needs. Gender, age, religion, ethnicity and marital-status requirements are not allowed.">
          <SectorRequirements categoryId={watch('categoryId')} value={criteria} onChange={setCriteria} />
        </SectionCard>

        <SectionCard title="Pay, schedule and deadline" description="Salary is per month in Ethiopian birr (ETB).">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Salary from" inputMode="numeric" error={errors.salaryMin?.message} {...register('salaryMin')} />
            <TextField label="Salary to" inputMode="numeric" error={errors.salaryMax?.message} {...register('salaryMax')} />
            <TextField label="Working schedule" placeholder="e.g. Mon-Sat, 8:00-17:00" {...register('schedule')} />
            <TextField label="Start date" type="date" {...register('startDate')} />
            <TextField label="Application deadline" type="date" hint="Leave empty to stay open until filled, unless your organization type needs a closing date" {...register('deadline')} />
            <TextField label="Vacancy reference number" hint="As on a formal announcement. Required for some organization types" error={errors.referenceNumber?.message} {...register('referenceNumber')} />
            <div className="sm:col-span-2"><TextAreaField label="Benefits" className="min-h-20" placeholder="e.g. Lunch, transport, overtime pay" {...register('benefits')} /></div>
          </div>
        </SectionCard>
      </fieldset>

      {error && (
        <Alert tone="danger">
          <p className="font-medium">{error.message}</p>
          {error.details && error.details.length > 0 && <ul className="mt-1 list-disc pl-5">{error.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          {error.duplicate && <Button type="button" size="sm" variant="outline" className="mt-3" loading={busy === 'publish'} onClick={publish(true)}>This is a different position, publish anyway</Button>}
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}

      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant={canPublish ? 'outline' : 'accent'} loading={busy === 'save'}>{canPublish ? 'Save draft' : 'Save changes'}</Button>
          {canPublish && <Button type="button" variant="accent" loading={busy === 'publish'} onClick={publish(false)}>Publish job</Button>}
          <Link to="/employer/jobs" className="text-sm text-muted hover:text-accent">Cancel</Link>
          {job && <Badge>{job.status === 'ACTIVE' ? 'Live' : job.status === 'DRAFT' ? 'Draft' : 'Waiting for review'}</Badge>}
        </div>
      )}
    </form>
  );
}

export default function JobFormPage() {
  const { id } = useParams();
  const q = useJob(id);
  return (
    <>
      <PageHeader title={id ? 'Edit job' : 'Post a job'} subtitle="Clear, honest job posts get better candidates." />
      <PageBody narrow>
        {id && q.isLoading && <div className="space-y-4" aria-busy="true"><Skeleton className="h-64" /><Skeleton className="h-48" /></div>}
        {id && q.isError && <Alert tone="danger">Could not load this job.</Alert>}
        {(!id || q.data) && <Form key={q.data?.id ?? 'new'} job={q.data} />}
      </PageBody>
    </>
  );
}
