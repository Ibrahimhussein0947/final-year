import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { api, ApiError } from '@/lib/api';
import { useMyJobs, type JobListItem } from '@/lib/jobs';
import { deadlineText, formatPlace } from '@/lib/format';

const STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_REVIEW: { label: 'Waiting for review', tone: 'warning' },
  ACTIVE: { label: 'Live', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  FILLED: { label: 'Filled', tone: 'info' },
};

function JobRow({ job, onError }: { job: JobListItem; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['my-jobs'] });
  const fail = (e: unknown) => onError(e instanceof ApiError ? e.message : 'Could not reach the server');
  const publish = useMutation({ mutationFn: () => api(`/jobs/${job.id}/publish`, { method: 'POST', body: {} }), onSuccess: refresh, onError: fail });
  const close = useMutation({ mutationFn: (filled: boolean) => api(`/jobs/${job.id}/close`, { method: 'POST', body: { filled } }), onSuccess: refresh, onError: fail });
  const feature = useMutation({ mutationFn: (featured: boolean) => api(`/jobs/${job.id}/feature`, { method: 'POST', body: { featured } }), onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['my-plan'] })]), onError: fail });
  const del = useMutation({ mutationFn: () => api(`/jobs/${job.id}`, { method: 'DELETE' }), onSuccess: refresh, onError: fail });
  const s = STATUS[job.status] ?? STATUS.DRAFT;
  const live = job.status === 'ACTIVE' || job.status === 'PENDING_REVIEW';

  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/jobs/${job.id}`} className="text-lg font-semibold hover:text-accent">{job.title}</Link>
            <p className="mt-0.5 text-sm text-muted">{formatPlace(job.locationPath, job.workMode === 'REMOTE')} · {job.category.name} · {deadlineText(job.deadline).text}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={s.tone}>{s.label}</Badge>
            {job.expired && job.status === 'ACTIVE' && <Badge tone="warning">Deadline passed</Badge>}
            {job.featured && <Badge tone="accent">Featured</Badge>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {job.status !== 'DRAFT' && (
            <LinkButton to={`/employer/jobs/${job.id}/applications`} variant="accent" size="sm">
              Applicants{job.applicationCount ? ` (${job.applicationCount})` : ''}
            </LinkButton>
          )}
          {job.status === 'ACTIVE' && <LinkButton to={`/employer/jobs/${job.id}/recommended`} variant="outline" size="sm">Recommended workers</LinkButton>}
          {job.status !== 'CLOSED' && job.status !== 'FILLED' && <LinkButton to={`/employer/jobs/${job.id}/edit`} variant="outline" size="sm">Edit</LinkButton>}
          {(job.status === 'DRAFT' || job.status === 'CLOSED') && <Button size="sm" variant="accent" loading={publish.isPending} onClick={() => publish.mutate()}>{job.status === 'CLOSED' ? 'Reopen' : 'Publish'}</Button>}
          {job.status === 'ACTIVE' && (
            <Button size="sm" variant="outline" loading={feature.isPending} onClick={() => feature.mutate(!job.featured)} aria-pressed={!!job.featured}>
              {job.featured ? 'Remove feature' : 'Feature this job'}
            </Button>
          )}
          {live && <Button size="sm" variant="outline" loading={close.isPending} onClick={() => close.mutate(false)}>Close</Button>}
          {live && <Button size="sm" variant="ghost" onClick={() => close.mutate(true)}>Mark as filled</Button>}
          {job.status === 'DRAFT' && (
            <Button size="sm" variant="ghost" className="text-danger" loading={del.isPending} onClick={() => { if (window.confirm('Delete this draft? This cannot be undone.')) del.mutate(); }}>Delete</Button>
          )}
        </div>
      </Card>
    </li>
  );
}

export default function MyJobs() {
  const q = useMyJobs();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Your jobs" subtitle="Create, publish and manage your job postings." />
      <PageBody narrow>
        <div className="mb-5 flex justify-end">
          <LinkButton to="/employer/jobs/new" variant="accent"><Plus className="h-4 w-4" aria-hidden />Post a job</LinkButton>
        </div>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
        {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
        {q.isError && <Alert tone="danger">Could not load your jobs.</Alert>}
        {q.data?.length === 0 && (
          <EmptyState icon={Briefcase} title="No jobs yet" body="Post your first job to start receiving matched candidates." action={<LinkButton to="/employer/jobs/new" variant="accent">Post a job</LinkButton>} />
        )}
        {q.data && q.data.length > 0 && <ul className="space-y-3">{q.data.map((j) => <JobRow key={j.id} job={j} onError={setError} />)}</ul>}
      </PageBody>
    </>
  );
}
