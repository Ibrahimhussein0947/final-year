import { EmployerKindBadge } from '@/components/OrgTypeFields';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, CalendarClock, Clock, GraduationCap, Languages, MapPin, Users, Wallet, Briefcase } from 'lucide-react';
import { Alert, Badge, Card, Skeleton, TextAreaField } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody } from '@/pages/PageHeader';
import { useJob, type JobWithViewer } from '@/lib/jobs';
import { STATUS_META, type AppStatus } from '@/lib/applications';
import { useMyMatch } from '@/lib/matching';
import { MatchPanel } from '@/components/MatchPanel';
import { TrainingSuggestions } from '@/components/TrainingSuggestions';
import { ReportButton } from '@/components/ReportButton';
import { useAuth } from '@/app/auth';
import { api, ApiError } from '@/lib/api';
import { deadlineText, EDU_LABEL, formatPlace, formatSalary, MODE_LABEL, TYPE_LABEL } from '@/lib/format';

function Fact({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
      <div><p className="text-xs text-muted">{label}</p><p className="text-sm font-medium">{children}</p></div>
    </div>
  );
}

function MyMatch({ jobId }: { jobId: string }) {
  const q = useMyMatch(jobId, true);
  if (q.isLoading) return <Skeleton className="mt-8 h-48" />;
  if (!q.data) return null;
  return <div className="mt-8"><MatchPanel match={q.data} title="Why this matches you" />
    {q.data.notAssessed.some((n) => n.component === 'skills') && <p className="mt-2 text-sm text-muted">Add your skills on your <Link className="text-accent hover:underline" to="/profile">profile</Link> to get a more accurate score.</p>}
    <TrainingSuggestions jobId={jobId} /></div>;
}

function ApplyPanel({ job, open }: { job: JobWithViewer; open: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => Promise.all(['job', 'my-applications', 'summary', 'saved-jobs'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not reach the server. Try again.');

  const apply = useMutation({
    mutationFn: () => api(`/jobs/${job.id}/apply`, { method: 'POST', body: note.trim() ? { coverNote: note.trim() } : {} }),
    onSuccess: () => { setError(null); void refresh(); },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: () => api(`/jobs/${job.id}/save`, { method: job.viewer?.saved ? 'DELETE' : 'PUT' }),
    onSuccess: () => { setError(null); void refresh(); },
    onError: fail,
  });

  const existing = job.viewer?.application;
  const active = existing && existing.status !== 'WITHDRAWN';
  const meta = existing ? STATUS_META[existing.status as AppStatus] : null;

  return (
    <div className="space-y-4">
      {active && meta ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm">You applied to this job. <Badge tone={meta.tone}>{meta.label}</Badge></p>
          <LinkButton to="/applications" variant="outline" size="sm">Track my applications</LinkButton>
        </div>
      ) : open ? (
        <div>
          <TextAreaField voice label="Message to the employer (optional)" className="min-h-24" maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)}
            hint="Applying shares your name and profile with this employer. Your phone number is only shown if they shortlist you." />
          <Button className="mt-3" variant="accent" loading={apply.isPending} onClick={() => apply.mutate()}>
            {existing?.status === 'WITHDRAWN' ? 'Apply again' : 'Apply for this job'}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">This job is not accepting applications.</p>
      )}
      {job.status === 'ACTIVE' && (
        <Button variant="ghost" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          {job.viewer?.saved ? 'Remove from saved jobs' : 'Save for later'}
        </Button>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

export default function JobDetail() {
  const { id } = useParams();
  const q = useJob(id);
  const { user } = useAuth();

  if (q.isLoading) {
    return <PageBody narrow><div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div></PageBody>;
  }
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <PageBody narrow>
        <Alert tone={notFound ? 'warning' : 'danger'}>{notFound ? 'This job is no longer available. It may have been filled, closed or removed.' : 'Could not load this job.'}</Alert>
        <LinkButton to="/jobs" variant="outline" className="mt-4">Browse other jobs</LinkButton>
      </PageBody>
    );
  }
  const job = q.data!;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.currency);
  const deadline = deadlineText(job.deadline);
  const required = job.allSkills.filter((s) => s.importance === 'REQUIRED');
  const preferred = job.allSkills.filter((s) => s.importance === 'PREFERRED');
  const isOwner = user?.role === 'EMPLOYER' && 'categoryId' in job;

  return (
    <PageBody narrow>
      <Link to="/jobs" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden />All jobs</Link>

      {job.status !== 'ACTIVE' && (
        <div className="mb-4"><Alert tone="warning">
          {job.status === 'DRAFT' && 'This is a draft. Only you can see it.'}
          {job.status === 'PENDING_REVIEW' && 'This job is waiting for review and is not public yet.'}
          {(job.status === 'CLOSED' || job.status === 'FILLED') && 'This job is closed and no longer public.'}
        </Alert></div>
      )}
      {job.expired && job.status === 'ACTIVE' && <div className="mb-4"><Alert tone="warning">The application deadline has passed.</Alert></div>}

      <h1 className="text-3xl font-extrabold tracking-tight">{job.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-muted">
        {job.organization.name}
        {job.organization.verified ? <Badge tone="success"><BadgeCheck className="h-3 w-3" aria-hidden />Verified employer</Badge> : <Badge>Not verified</Badge>}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <EmployerKindBadge type={job.organization.type} label={job.vacancyLabel} />
        <Badge tone="accent">{TYPE_LABEL[job.employmentType]}</Badge>
        <Badge>{MODE_LABEL[job.workMode]}</Badge>
        <Badge>{job.category.name}</Badge>
      </div>

      <Card className="mt-6 grid gap-5 p-5 sm:grid-cols-2">
        <Fact icon={MapPin} label="Location">{formatPlace(job.locationPath, job.workMode === 'REMOTE')}</Fact>
        <Fact icon={Wallet} label="Salary per month">{salary ?? 'Not stated'}</Fact>
        <Fact icon={Users} label="Vacancies">{job.vacancies}</Fact>
        {job.referenceNumber && <Fact icon={Briefcase} label="Vacancy reference">{job.referenceNumber}</Fact>}
        <Fact icon={Clock} label="Application deadline"><span className={deadline.urgent ? 'text-warning' : ''}>{deadline.text}</span></Fact>
        <Fact icon={CalendarClock} label="Experience">{job.minExperienceYears === null ? 'No minimum required' : `${job.minExperienceYears}+ year${job.minExperienceYears === 1 ? '' : 's'}`}</Fact>
        <Fact icon={GraduationCap} label="Qualification">{job.requiredEducationLevel ? EDU_LABEL[job.requiredEducationLevel] : 'No formal qualification required'}</Fact>
        {job.languages.length > 0 && <Fact icon={Languages} label="Languages">{job.languages.join(', ')}</Fact>}
        {job.schedule && <Fact icon={Clock} label="Schedule">{job.schedule}</Fact>}
      </Card>

      <section className="mt-8">
        <h2 className="text-xl font-bold">About the job</h2>
        <p className="mt-2 whitespace-pre-line leading-relaxed text-muted">{job.description}</p>
      </section>

      {(required.length > 0 || preferred.length > 0) && (
        <section className="mt-8">
          <h2 className="text-xl font-bold">Skills</h2>
          {required.length > 0 && <div className="mt-3"><p className="mb-1.5 text-sm text-muted">Required</p><div className="flex flex-wrap gap-1.5">{required.map((s) => <Badge key={s.skillId} tone="accent">{s.name}{s.minProficiency ? ` (level ${s.minProficiency}+)` : ''}</Badge>)}</div></div>}
          {preferred.length > 0 && <div className="mt-3"><p className="mb-1.5 text-sm text-muted">Nice to have</p><div className="flex flex-wrap gap-1.5">{preferred.map((s) => <Badge key={s.skillId}>{s.name}</Badge>)}</div></div>}
        </section>
      )}

      {job.criteria?.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-bold">Sector requirements</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {job.criteria.map((c) => (
              <li key={c.criterionId} className="flex flex-wrap items-center gap-2">
                <Badge tone={c.importance === 'MUST_HAVE' ? 'accent' : 'neutral'}>{c.importance === 'MUST_HAVE' ? 'Must have' : 'Preferred'}</Badge>
                <span className="font-medium">{c.labelEn}</span>
                {c.text && c.type !== 'BOOLEAN' && <span className="text-muted">{c.text}</span>}
              </li>
            ))}
          </ul>
          {user?.role === 'WORKER' && <p className="mt-2 text-xs text-muted">Answer these under "Sector details" in your profile so the match can use them. Unanswered questions are not held against you.</p>}
        </section>
      )}

      {job.benefits && (
        <section className="mt-8"><h2 className="text-xl font-bold">Benefits</h2><p className="mt-2 whitespace-pre-line text-muted">{job.benefits}</p></section>
      )}

      <section className="mt-8">
        <h2 className="text-xl font-bold">About {job.organization.name}</h2>
        <p className="mt-2 text-muted">{job.organization.description ?? 'This employer has not added a description yet.'}</p>
        {job.organization.website && <a className="mt-1 inline-block text-sm text-accent hover:underline" href={job.organization.website} target="_blank" rel="noopener noreferrer nofollow">{job.organization.website}</a>}
      </section>

      {user?.role === 'WORKER' && job.status === 'ACTIVE' && !job.expired && <MyMatch jobId={job.id} />}

      {user && !isOwner && user.role !== 'ADMIN' && <ReportButton targetType="JOB" targetId={job.id} />}

      <Card className="mt-8 p-5">
        {isOwner ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">This is your job posting.</p>
            <div className="flex gap-2">
              <LinkButton to={`/employer/jobs/${job.id}/recommended`} variant="outline">Recommended workers</LinkButton>
              <LinkButton to={`/employer/jobs/${job.id}/applications`} variant="outline">Applicants</LinkButton>
              <LinkButton to={`/employer/jobs/${job.id}/edit`} variant="accent">Edit job</LinkButton>
            </div>
          </div>
        ) : !user ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Create a free account to apply.</p>
            <LinkButton to={`/login`} variant="outline">Log in</LinkButton>
            <LinkButton to="/register?role=worker" variant="accent">Sign up</LinkButton>
          </div>
        ) : user.role === 'WORKER' ? (
          <ApplyPanel job={job} open={job.status === 'ACTIVE' && !job.expired} />
        ) : (
          <p className="text-sm text-muted">Only job seeker accounts can apply for jobs.</p>
        )}
      </Card>
    </PageBody>
  );
}
