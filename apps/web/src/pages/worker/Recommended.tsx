import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Sparkles, UserCog } from 'lucide-react';
import { Alert, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { MatchBadge, MatchPanel } from '@/components/MatchPanel';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useRecommendedJobs, type RecommendedJob } from '@/lib/matching';
import { deadlineText, formatPlace, formatSalary, TYPE_LABEL } from '@/lib/format';
import { cn } from '@/lib/cn';

export function RecommendedJobCard({ item }: { item: RecommendedJob }) {
  const [open, setOpen] = useState(false);
  const { job, match } = item;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.currency, (job as { payBasis?: string | null }).payBasis);
  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/jobs/${job.id}`} className="text-lg font-semibold hover:text-accent">{job.title}</Link>
            <p className="text-sm text-muted">{[job.organization.name, formatPlace(job.locationPath, job.workMode === 'REMOTE'), TYPE_LABEL[job.employmentType], salary, deadlineText(job.deadline).text].filter(Boolean).join(' · ')}</p>
          </div>
          <MatchBadge match={match} />
        </div>
        <p className="mt-3 text-sm text-muted">{match.explanation}</p>
        <Button variant="ghost" size="sm" className="mt-2" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          How was this calculated? <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
        </Button>
        {open && <div className="mt-3"><MatchPanel match={match} title="Score breakdown" /></div>}
      </Card>
    </li>
  );
}

export default function RecommendedJobsPage() {
  const q = useRecommendedJobs(20);
  return (
    <>
      <PageHeader title="Recommended for you" subtitle="Open jobs ranked by how well they fit your skills, experience, location and preferences." />
      <PageBody narrow>
        {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>}
        {q.isError && <Alert tone="danger">Could not load recommendations.</Alert>}
        {q.data?.reason === 'no_profile_data' && (
          <EmptyState icon={UserCog} title="Tell us what you can do" body="Add your skills and occupation to your profile and we will show jobs that fit you." action={<LinkButton to="/profile" variant="accent">Complete my profile</LinkButton>} />
        )}
        {q.data?.reason === 'ok' && q.data.items.length === 0 && (
          <EmptyState icon={Sparkles} title="No matching jobs right now" body="New jobs are matched as they are posted. Adding more skills and a location to your profile can help." action={<LinkButton to="/jobs" variant="outline">Browse all jobs</LinkButton>} />
        )}
        {q.data && q.data.items.length > 0 && <ul className="space-y-3">{q.data.items.map((i) => <RecommendedJobCard key={i.job.id} item={i} />)}</ul>}
        <p className="mt-6 text-xs text-muted">Scores come from a transparent rule-based formula, shown in full under each job. A score is a guide, not a promise or a judgement of you.</p>
      </PageBody>
    </>
  );
}
