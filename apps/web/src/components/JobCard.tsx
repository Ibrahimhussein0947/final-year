import { Link } from 'react-router-dom';
import { BadgeCheck, Clock, MapPin, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { EmployerKindBadge } from '@/components/OrgTypeFields';
import type { JobListItem } from '@/lib/jobs';
import type { Fit } from '@/lib/workerHelpers';
import { FitLine } from '@/components/JobInsights';
import { deadlineText, formatPlace, formatSalary, MODE_LABEL, OPEN_TO_LABEL, SENIORITY_LABEL, timeAgo, TYPE_LABEL } from '@/lib/format';

export function JobCard({ job, fit }: { job: JobListItem; fit?: Fit }) {
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.currency, job.payBasis);
  const deadline = deadlineText(job.deadline);
  return (
    <Link
      to={`/jobs/${job.id}`}
      className="block rounded-2xl border border-border bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-lg font-semibold">{job.title}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {job.organization.name}
            {job.organization.verified && (
              <span className="inline-flex items-center gap-0.5 text-success" title="Verified employer">
                <BadgeCheck className="h-4 w-4" aria-hidden /> <span className="sr-only">Verified employer</span>
              </span>
            )}
            <EmployerKindBadge type={job.organization.type} />
          </p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
          {job.featured && <Badge tone="accent">Featured</Badge>}
          {timeAgo(job.publishedAt)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden />{formatPlace(job.locationPath, job.workMode === 'REMOTE')}</span>
        {salary && <span className="inline-flex items-center gap-1"><Wallet className="h-4 w-4" aria-hidden />{salary}</span>}
        <span className={`inline-flex items-center gap-1 ${deadline.urgent ? 'text-warning' : ''}`}><Clock className="h-4 w-4" aria-hidden />{deadline.text}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="accent">{TYPE_LABEL[job.employmentType]}</Badge>
        <Badge>{MODE_LABEL[job.workMode]}</Badge>
        {job.seniority && <Badge>{SENIORITY_LABEL[job.seniority]}</Badge>}
        {job.openTo?.slice(0, 2).map((g) => <Badge key={g} tone="success">{OPEN_TO_LABEL[g]}</Badge>)}
        <Badge>{job.category.name}</Badge>
        {job.skills.slice(0, 3).map((s) => <Badge key={s} tone="info">{s}</Badge>)}
      </div>
      <FitLine fit={fit} />
    </Link>
  );
}
