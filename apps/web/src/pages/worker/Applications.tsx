import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, CalendarClock, ChevronDown, FileText, MapPin, MessageSquare } from 'lucide-react';
import { useOpenConversation } from '@/pages/Messages';
import { Alert, Badge, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { api, ApiError } from '@/lib/api';
import { STATUS_META, useMyApplications, useSavedJobs, type MyApplication } from '@/lib/applications';
import { formatSalary, TYPE_LABEL } from '@/lib/format';
import { cn } from '@/lib/cn';
import { RateEmployer } from '@/components/JobInsights';
import { WorkerOffers } from '@/components/OfferPanels';

const MODE = { IN_PERSON: 'In person', PHONE: 'Phone call', VIDEO: 'Video call' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function ApplicationCard({ a, onError }: { a: MyApplication; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const chat = useOpenConversation();
  useEffect(() => { if (chat.error) onError(chat.error); }, [chat.error, onError]);
  const meta = STATUS_META[a.status];
  const withdraw = useMutation({
    mutationFn: () => api(`/applications/${a.id}/withdraw`, { method: 'POST' }),
    onSuccess: () => Promise.all(['my-applications', 'summary', 'job'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Could not reach the server'),
  });
  const upcoming = a.interviews.filter((i) => i.status === 'SCHEDULED');

  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/jobs/${a.job.id}`} className="text-lg font-semibold hover:text-accent">{a.job.title}</Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted">
              <span>{a.job.organization}</span>
              {a.job.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{a.job.location}</span>}
              <span>Applied {new Date(a.appliedAt).toLocaleDateString('en-GB')}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {a.qualified && a.status === 'PENDING' && <Badge tone="success">Qualified</Badge>}
            {a.autoApplied && <Badge tone="neutral">Applied automatically</Badge>}
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
        </div>
        {a.status === 'REJECTED' && (
          <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
            <p className="font-medium">You were not selected for this position.</p>
            {a.notSelectedReasons.length > 0 && (
              <>
                <p className="mt-1 text-muted">Where your profile fell short of the requirements:</p>
                <ul className="mt-1 list-disc pl-5">{a.notSelectedReasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </>
            )}
            {a.notSelectedTips.length > 0 && (
              <>
                <p className="mt-2 font-medium">What you can do to be stronger next time:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">{a.notSelectedTips.map((t) => <li key={t.key}>{t.text} <Link to={t.link} className="text-accent hover:underline">Open</Link></li>)}</ul>
              </>
            )}
            <p className="mt-1 text-muted">This is an automatic summary of the match, not the employer's reasoning. Your profile stays available for other jobs.</p>
            <Link to="/recommended" className="mt-1 inline-block text-accent hover:underline">See other jobs that fit you</Link>
          </div>
        )}

        {a.canReview && <RateEmployer applicationId={a.id} organization={a.job.organization} />}
        {a.review && <p className="mt-3 text-sm text-muted">You rated this employer {a.review.rating} out of 5. Thank you.</p>}

        {upcoming.length > 0 && (
          <ul className="mt-3 space-y-2">
            {upcoming.map((i) => (
              <li key={i.id} className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span><strong>{when(i.scheduledAt)}</strong> · {MODE[i.mode]}{i.locationOrLink ? ` · ${i.locationOrLink}` : ''}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            Progress <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
          </Button>
          {a.status !== 'REJECTED' && a.status !== 'WITHDRAWN' && (
            <Button variant="outline" size="sm" loading={chat.busy === a.id} onClick={() => chat.open(a.id)}><MessageSquare className="h-4 w-4" aria-hidden />Message employer</Button>
          )}
          {a.canWithdraw && (
            <Button variant="ghost" size="sm" className="text-danger" loading={withdraw.isPending}
              onClick={() => { if (window.confirm('Withdraw this application?')) withdraw.mutate(); }}>
              Withdraw
            </Button>
          )}
        </div>

        {open && (
          <ol className="mt-3 space-y-2 border-l-2 border-border pl-4 text-sm">
            {a.history.map((h, i) => (
              <li key={i}>
                <span className="font-medium">{STATUS_META[h.to].label}</span>
                <span className="ml-2 text-muted">{when(h.at)}</span>
                {h.note && <p className="text-muted">“{h.note}”</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </li>
  );
}

export function MyApplicationsPage() {
  const q = useMyApplications();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="My applications" subtitle="Track every job you applied for." />
      <PageBody narrow>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
        <WorkerOffers />
        {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
        {q.isError && <Alert tone="danger">Could not load your applications.</Alert>}
        {q.data?.length === 0 && (
          <EmptyState icon={FileText} title="No applications yet" body="When you apply for a job it will show up here with its progress." action={<LinkButton to="/jobs" variant="accent">Browse jobs</LinkButton>} />
        )}
        {q.data && q.data.length > 0 && <ul className="space-y-3">{q.data.map((a) => <ApplicationCard key={a.id} a={a} onError={setError} />)}</ul>}
      </PageBody>
    </>
  );
}

export function SavedJobsPage() {
  const q = useSavedJobs();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api(`/jobs/${id}/save`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-jobs'] }),
  });
  return (
    <>
      <PageHeader title="Saved jobs" subtitle="Jobs you bookmarked to come back to." />
      <PageBody narrow>
        {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>}
        {q.isError && <Alert tone="danger">Could not load your saved jobs.</Alert>}
        {q.data?.length === 0 && <EmptyState icon={Bookmark} title="Nothing saved yet" body="Use “Save for later” on a job page to keep it here." action={<LinkButton to="/jobs" variant="accent">Browse jobs</LinkButton>} />}
        <ul className="space-y-3">
          {q.data?.map(({ job }) => {
            const salary = formatSalary(job.salaryMin, job.salaryMax, job.currency);
            return (
              <li key={job.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <Link to={`/jobs/${job.id}`} className="font-semibold hover:text-accent">{job.title}</Link>
                    <p className="text-sm text-muted">{[job.organization, job.location, TYPE_LABEL[job.employmentType], salary].filter(Boolean).join(' · ')}</p>
                    {!job.open && <Badge tone="warning">No longer open</Badge>}
                  </div>
                  <Button variant="ghost" size="sm" loading={remove.isPending && remove.variables === job.id} onClick={() => remove.mutate(job.id)}>Remove</Button>
                </Card>
              </li>
            );
          })}
        </ul>
      </PageBody>
    </>
  );
}
