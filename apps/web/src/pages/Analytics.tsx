import { TrainingSuggestions } from '@/components/TrainingSuggestions';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Eye, Lightbulb } from 'lucide-react';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/primitives';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useAuth } from '@/app/auth';
import { api } from '@/lib/api';
import { STATUS_META, type AppStatus } from '@/lib/applications';

interface WorkerData {
  profileViews: number;
  applications: { total: number; byStatus: Record<string, number>; interviewInvitations: number; successful: number; decided: number; successRate: number | null };
  mostRequestedSkills: { skillId: string; name: string; openJobs: number; youHaveIt: boolean }[];
  recommendedSkills: { skillId: string; name: string; requiredInOpenJobs: number; closeToYourSkills: boolean }[];
  scope: string; note: string;
}
interface EmployerData {
  jobs: { byStatus: Record<string, number>; openVacancies: number };
  applications: { total: number; byStatus: Record<string, number> };
  funnel: { applied: number; reviewed: number; shortlisted: number; interviewed: number; hired: number };
  candidateMatchQuality: { averageScore: number | null; medianScore: number | null; scored: number; note: string };
  hiring: { hires: number; averageDaysFromApplicationToHire: number | null; averageDaysFromPostingToFirstHire: number | null };
  perJob: { jobId: string; title: string; status: string; applications: number; averageMatchScore: number | null; shortlisted: number; accepted: number }[];
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function WorkerAnalytics() {
  const q = useQuery({ queryKey: ['analytics-worker'], queryFn: () => api<WorkerData>('/analytics/worker') });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <Alert tone="danger">Could not load your analytics.</Alert>;
  const d = q.data;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Profile views by employers" value={d.profileViews} />
        <Stat label="Applications" value={d.applications.total} />
        <Stat label="Interview invitations" value={d.applications.interviewInvitations} />
        <Stat label="Successful applications" value={d.applications.successful} hint={d.applications.successRate === null ? 'Success rate shows after a few decisions' : `${d.applications.successRate}% of decided`} />
      </div>
      {d.applications.total > 0 && (
        <Card className="p-5">
          <h2 className="font-semibold">Your applications by status</h2>
          <div className="mt-3 flex flex-wrap gap-2">{Object.entries(d.applications.byStatus).map(([s, n]) => <Badge key={s} tone={STATUS_META[s as AppStatus]?.tone ?? 'neutral'}>{STATUS_META[s as AppStatus]?.label ?? s}: {n}</Badge>)}</div>
        </Card>
      )}
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Lightbulb className="h-4 w-4 text-warning" aria-hidden />Skills worth adding</h2>
        <p className="mt-1 text-xs text-muted">From {d.scope}. {d.note}</p>
        {d.recommendedSkills.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing to suggest right now. You already list the skills most open jobs in your field ask for, or there are not enough open jobs yet.</p> : (
          <ul className="mt-3 divide-y divide-border">
            {d.recommendedSkills.map((s) => (
              <li key={s.skillId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="font-medium">{s.name}</span>
                <span className="flex items-center gap-2 text-muted">required in {s.requiredInOpenJobs} open job{s.requiredInOpenJobs === 1 ? '' : 's'}{s.closeToYourSkills && <Badge tone="accent">close to skills you have</Badge>}</span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/profile" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">Edit my skills</Link>
      </Card>
      <TrainingSuggestions />
      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Eye className="h-4 w-4 text-muted" aria-hidden />Skills employers ask for most (all open jobs)</h2>
        <ol className="mt-3 space-y-1.5 text-sm">
          {d.mostRequestedSkills.length === 0 && <li className="text-muted">No open jobs yet.</li>}
          {d.mostRequestedSkills.map((s) => <li key={s.skillId} className="flex items-center justify-between"><span className="flex items-center gap-2">{s.youHaveIt && <Check className="h-4 w-4 text-success" aria-label="You have this skill" />}{s.name}</span><span className="text-muted">{s.openJobs} open job{s.openJobs === 1 ? '' : 's'}</span></li>)}
        </ol>
      </Card>
    </div>
  );
}

function EmployerAnalytics() {
  const q = useQuery({ queryKey: ['analytics-employer'], queryFn: () => api<EmployerData>('/analytics/employer') });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <Alert tone="danger">Could not load your analytics.</Alert>;
  const d = q.data;
  const f = d.funnel;
  const steps: [string, number][] = [['Applied', f.applied], ['Reviewed', f.reviewed], ['Shortlisted', f.shortlisted], ['Interviewed', f.interviewed], ['Hired', f.hired]];
  const max = Math.max(1, f.applied);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open vacancies" value={d.jobs.openVacancies} />
        <Stat label="Applications received" value={d.applications.total} />
        <Stat label="Hires" value={d.hiring.hires} />
        <Stat label="Average match score of applicants" value={d.candidateMatchQuality.averageScore ?? 'n/a'} hint={d.candidateMatchQuality.scored ? `median ${d.candidateMatchQuality.medianScore}, ${d.candidateMatchQuality.scored} scored` : undefined} />
      </div>
      <Card className="p-5">
        <h2 className="font-semibold">Recruitment funnel</h2>
        <ul className="mt-3 space-y-2">
          {steps.map(([label, n]) => (
            <li key={label} className="text-sm">
              <div className="mb-1 flex justify-between"><span>{label}</span><span className="text-muted">{n}</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${(n / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Counts people who ever reached each step. {d.candidateMatchQuality.note}</p>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Time to hire</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">From application to hire</dt><dd className="font-medium">{d.hiring.averageDaysFromApplicationToHire === null ? 'No hires yet' : `${d.hiring.averageDaysFromApplicationToHire} days on average`}</dd></div>
          <div><dt className="text-muted">From posting to first hire</dt><dd className="font-medium">{d.hiring.averageDaysFromPostingToFirstHire === null ? 'No hires yet' : `${d.hiring.averageDaysFromPostingToFirstHire} days on average`}</dd></div>
        </dl>
      </Card>
      <Card className="overflow-x-auto p-5">
        <h2 className="font-semibold">By job</h2>
        <table className="mt-3 w-full min-w-[520px] text-left text-sm">
          <thead><tr className="border-b border-border text-muted"><th className="py-2">Job</th><th>Applications</th><th>Avg match</th><th>Shortlisted</th><th>Hired</th></tr></thead>
          <tbody>
            {d.perJob.length === 0 && <tr><td colSpan={5} className="py-3 text-muted">No applications yet.</td></tr>}
            {d.perJob.map((j) => <tr key={j.jobId} className="border-b border-border last:border-0"><td className="py-2"><Link className="font-medium hover:text-accent" to={`/employer/jobs/${j.jobId}/applications`}>{j.title}</Link></td><td>{j.applications}</td><td>{j.averageMatchScore ?? 'n/a'}</td><td>{j.shortlisted}</td><td>{j.accepted}</td></tr>)}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Your analytics" subtitle={user?.role === 'EMPLOYER' ? 'How your recruitment is going.' : 'How your job search is going.'} />
      <PageBody>{user?.role === 'EMPLOYER' ? <EmployerAnalytics /> : <WorkerAnalytics />}</PageBody>
    </>
  );
}
