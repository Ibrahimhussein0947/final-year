import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Users } from 'lucide-react';
import { Alert, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { InviteButton } from '@/components/InviteButton';
import { MatchBadge, MatchPanel } from '@/components/MatchPanel';
import { ProfileSummary } from '@/pages/employer/Candidate';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useProtectedImage } from '@/lib/profile';
import { useRecommendedWorkers, useWorkerProfileForEmployer, type RecommendedWorker } from '@/lib/matching';
import { useJobInvitations } from '@/lib/talent';
import { cn } from '@/lib/cn';

function WorkerRow({ w, jobId }: { w: RecommendedWorker; jobId: string }) {
  const [open, setOpen] = useState(false);
  const photo = useProtectedImage(w.photoUrl);
  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-sm font-bold text-muted">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : w.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link to={`/employer/workers/${w.workerId}?job=${jobId}`} className="text-lg font-semibold hover:text-accent">{w.name}</Link>
              <MatchBadge match={w.match} />
            </div>
            <p className="text-sm text-muted">{[w.headline ?? w.occupation, `${w.yearsExperience} yr experience`, w.location].filter(Boolean).join(' · ')}</p>
            <p className="mt-2 text-sm text-muted">{w.match.explanation}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>How was this calculated? <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden /></Button>
              <Link to={`/employer/workers/${w.workerId}?job=${jobId}`} className="text-sm font-medium text-accent hover:underline">View profile</Link>
              <InviteButton jobId={jobId} workerId={w.workerId} invitation={w.invitation} />
            </div>
            {open && <div className="mt-3"><MatchPanel match={w.match} title="Score breakdown" /></div>}
          </div>
        </div>
      </Card>
    </li>
  );
}

export default function RecommendedWorkersPage() {
  const { id } = useParams();
  const q = useRecommendedWorkers(id);
  return (
    <>
      <PageHeader title="Recommended workers" subtitle={q.data ? `Best fits for "${q.data.job.title}"` : undefined} />
      <PageBody narrow>
        <Link to={`/employer/jobs/${id}/applications`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden />Applicants</Link>
        {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>}
        {q.isError && <Alert tone="danger">Could not load recommendations for this job.</Alert>}
        {q.data?.items.length === 0 && <EmptyState icon={Users} title="No suitable workers found yet" body="Workers are matched on skills, experience, location and availability. Adding required skills to the job helps, and new workers are matched as they join." />}
        {q.data && q.data.items.length > 0 && <ul className="space-y-3">{q.data.items.map((w) => <WorkerRow key={w.workerId} w={w} jobId={id!} />)}</ul>}
        <p className="mt-6 text-xs text-muted">Only workers who chose to be visible are shown, without contact details or exact location. People who already applied are in your applicant list. Messaging workers directly arrives in a later phase; scores assist your judgement and never decide for you.</p>
      </PageBody>
    </>
  );
}

export function WorkerProfileForEmployer() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const job = params.get('job');
  const q = useWorkerProfileForEmployer(id);
  const invites = useJobInvitations(job ?? undefined);
  const inviteRow = invites.data?.find((i) => i.worker.id === id);
  const invitation = inviteRow?.status ?? null;
  const chatId = inviteRow?.conversationId ?? null;
  return (
    <>
      <PageHeader title="Worker profile" />
      <PageBody narrow>
        <Link to={job ? `/employer/jobs/${job}/recommended` : '/employer/jobs'} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden />Back</Link>
        {q.isLoading && <Skeleton className="h-96" />}
        {q.isError && <Alert tone="warning">This profile is not available. The worker may have hidden it.</Alert>}
        {q.data && job && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <InviteButton jobId={job} workerId={q.data.id} invitation={invitation} />
            {chatId && <Link to={`/messages/${chatId}`} className="text-sm font-medium text-accent hover:underline">Open the worker's chat</Link>}
            {invitation === 'SENT' && !chatId && <span className="text-xs text-muted">They can ask you a question; you can reply once they do.</span>}
          </div>
        )}
        {q.data && <Card className="p-5"><ProfileSummary p={q.data} /></Card>}
      </PageBody>
    </>
  );
}
