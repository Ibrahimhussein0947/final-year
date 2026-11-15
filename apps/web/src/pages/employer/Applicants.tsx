import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, GitCompare, MessageSquare, Users } from 'lucide-react';
import { useOpenConversation } from '@/pages/Messages';
import { Alert, Badge, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { api, ApiError } from '@/lib/api';
import { STATUS_META, useJobApplicants, type AppStatus, type ApplicantRow, type HiringRulesView } from '@/lib/applications';
import { useProtectedImage } from '@/lib/profile';
import { MatchBadge } from '@/components/MatchPanel';
import { cn } from '@/lib/cn';

const ACTION: Record<string, { label: string; variant: 'accent' | 'outline' | 'ghost'; confirm?: string }> = {
  UNDER_REVIEW: { label: 'Start review', variant: 'outline' },
  SHORTLISTED: { label: 'Shortlist', variant: 'accent' },
  ACCEPTED: { label: 'Accept', variant: 'accent', confirm: 'Accept this candidate? They will be notified.' },
  REJECTED: { label: 'Reject', variant: 'ghost', confirm: 'Reject this application? The candidate will be notified. This is final.' },
};

/**
 * Ask the employer to confirm a move to `s`, and for a written reason where their organization type requires one.
 * Returns what to send ({} or {note}), or null if they backed out or the reason was too short.
 */
export function askToMove(s: string, rules: HiringRulesView | undefined, onError: (m: string) => void): { note?: string } | null {
  // Some organization types must write down why they accept or reject someone. The reason is kept with the decision.
  if (rules?.requireDecisionNote && (s === 'ACCEPTED' || s === 'REJECTED')) {
    const note = window.prompt(`Reason for this decision (at least 10 characters). It is kept with the decision${s === 'REJECTED' ? ' and the candidate is told the outcome' : ''}.`);
    if (note === null) return null;
    if (note.trim().length < 10) { onError('Write a reason of at least 10 characters.'); return null; }
    return { note: note.trim() };
  }
  if (ACTION[s]?.confirm && !window.confirm(ACTION[s].confirm!)) return null;
  return {};
}

/** Move one application to a new status. Shared by the list and the board. */
export function useMoveApplication(onError: (m: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { applicationId: string; status: string; note?: string }) =>
      api(`/applications/${v.applicationId}/status`, { method: 'PATCH', body: { status: v.status, ...(v.note ? { note: v.note } : {}) } }),
    onSuccess: async () => {
      await Promise.all(['job-applicants', 'candidate', 'summary', 'compare'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Could not reach the server'),
  });
}

export { ACTION as STATUS_ACTION };

/** Status buttons for the transitions the server says are allowed. */
export function StatusActions({ applicationId, allowed, onChanged, onError, rules }: { applicationId: string; allowed: AppStatus[]; onChanged: () => void; onError: (m: string) => void; rules?: HiringRulesView }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: { status: string; note?: string }) => api(`/applications/${applicationId}/status`, { method: 'PATCH', body: { status: v.status, ...(v.note ? { note: v.note } : {}) } }),
    onSuccess: async () => {
      await Promise.all(['job-applicants', 'candidate', 'summary', 'compare'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onChanged();
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Could not reach the server'),
  });
  const buttons = allowed.filter((s) => ACTION[s]);
  if (!buttons.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((s) => (
        <Button key={s} size="sm" variant={ACTION[s].variant} className={s === 'REJECTED' ? 'text-danger' : ''}
          loading={m.isPending && m.variables?.status === s}
          onClick={() => {
            const ask = askToMove(s, rules, onError);
            if (ask) m.mutate({ status: s, ...ask });
          }}>
          {ACTION[s].label}
        </Button>
      ))}
    </div>
  );
}

function Row({ a, jobId, selected, onToggle, canSelect, onError, rules }: { a: ApplicantRow; jobId: string; selected: boolean; onToggle: () => void; canSelect: boolean; onError: (m: string) => void; rules?: HiringRulesView }) {
  const photo = useProtectedImage(a.candidate.photoUrl);
  const chat = useOpenConversation();
  useEffect(() => { if (chat.error) onError(chat.error); }, [chat.error, onError]);
  const meta = STATUS_META[a.status];
  return (
    <li>
      <Card className={cn('p-4 sm:p-5', selected && 'border-accent')}>
        <div className="flex items-start gap-4">
          <input type="checkbox" className="mt-2 h-4 w-4" aria-label={`Select ${a.candidate.name} to compare`} checked={selected} disabled={!canSelect && !selected} onChange={onToggle} />
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-sm font-bold text-muted">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : a.candidate.name.slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link to={`/employer/applications/${a.id}`} className="text-lg font-semibold hover:text-accent">{a.candidate.name}</Link>
              <span className="flex flex-wrap items-center gap-2"><MatchBadge match={a.match} />{a.qualified && a.status === 'PENDING' && <Badge tone="success">Qualified</Badge>}{a.autoApplied && <Badge tone="neutral">Applied automatically</Badge>}<Badge tone={meta.tone}>{meta.label}</Badge></span>
            </div>
            <p className="text-sm text-muted">
              {[a.candidate.headline ?? a.candidate.occupation, `${a.candidate.yearsExperience} yr experience`, a.candidate.location].filter(Boolean).join(' · ')}
            </p>
            {a.candidate.skills.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{a.candidate.skills.map((s) => <Badge key={s} tone="info">{s}</Badge>)}</div>}
            {a.coverNote && <p className="mt-2 line-clamp-2 text-sm text-muted">“{a.coverNote}”</p>}
            {a.candidate.phone && <p className="mt-2 text-sm">Phone: <a className="font-medium text-accent hover:underline" href={`tel:${a.candidate.phone}`}>{a.candidate.phone}</a></p>}
            {a.interviews[0] && <p className="mt-2 text-sm text-warning">Interview: {new Date(a.interviews[0].scheduledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StatusActions applicationId={a.id} allowed={a.allowedNext} onChanged={() => undefined} onError={onError} rules={rules} />
              {a.status !== 'REJECTED' && a.status !== 'WITHDRAWN' && (
                <Button size="sm" variant="outline" loading={chat.busy === a.id} onClick={() => chat.open(a.id)}><MessageSquare className="h-4 w-4" aria-hidden />Message</Button>
              )}
              <Link to={`/employer/applications/${a.id}`} className="text-sm font-medium text-accent hover:underline">View profile{a.status === 'SHORTLISTED' || a.status === 'UNDER_REVIEW' ? ' and schedule interview' : ''}</Link>
            </div>
          </div>
        </div>
      </Card>
      <span className="sr-only">{jobId}</span>
    </li>
  );
}

const TABS: [string, string][] = [
  ['', 'All'], ['PENDING', 'Pending'], ['UNDER_REVIEW', 'Under review'], ['SHORTLISTED', 'Shortlisted'],
  ['INTERVIEW_SCHEDULED', 'Interview'], ['ACCEPTED', 'Accepted'], ['REJECTED', 'Rejected'], ['WITHDRAWN', 'Withdrawn'],
];

export default function ApplicantsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<'newest' | 'match'>('match');
  const q = useJobApplicants(id, status, sort);
  const all = useJobApplicants(id, '', 'newest');
  const total = Object.values(all.data?.counts ?? {}).reduce((s, n) => s + (n ?? 0), 0);

  const toggle = (appId: string) => setSelected((s) => (s.includes(appId) ? s.filter((x) => x !== appId) : [...s, appId]));

  return (
    <>
      <PageHeader title={all.data ? `Applicants: ${all.data.job.title}` : 'Applicants'} subtitle={all.data ? `${total} application${total === 1 ? '' : 's'} · ${all.data.job.vacancies} vacanc${all.data.job.vacancies === 1 ? 'y' : 'ies'}` : undefined} />
      <PageBody narrow>
        <Link to="/employer/jobs" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden />Your jobs</Link>
        {all.data?.rules && (all.data.rules.requireDecisionNote || all.data.rules.requireInterview || all.data.rules.announcementClosesAt) && (
          <div className="mb-4"><Alert tone="info">
            {all.data.rules.label ?? 'Formal recruitment'}: {[
              all.data.rules.announcementClosesAt && `accepting is possible after the closing date (${new Date(all.data.rules.announcementClosesAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })})`,
              all.data.rules.requireInterview && 'an interview must be recorded before accepting',
              all.data.rules.requireDecisionNote && 'a written reason is required when you accept or reject',
            ].filter(Boolean).join('; ')}.
          </Alert></div>
        )}

        <div role="tablist" aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
          {TABS.map(([value, label]) => {
            const n = value ? all.data?.counts[value as AppStatus] ?? 0 : total;
            return (
              <button key={value} role="tab" aria-selected={status === value} onClick={() => { setStatus(value); setSelected([]); }}
                className={cn('rounded-full border px-3 py-1.5 text-sm', status === value ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface hover:bg-surface-2')}>
                {label} <span className="text-muted">{n}</span>
              </button>
            );
          })}
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Sort by</span>
            <select className="h-9 rounded-lg border border-border bg-surface px-2" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'match')}>
              <option value="match">Best match</option>
              <option value="newest">Newest first</option>
            </select>
          </label>
          <span className="flex flex-wrap gap-4">
            <Link to={`/employer/jobs/${id}/board`} className="text-sm font-medium text-accent hover:underline">Show as a board</Link>
            <Link to={`/employer/jobs/${id}/recommended`} className="text-sm font-medium text-accent hover:underline">Find more candidates: recommended workers →</Link>
          </span>
        </div>

        {selected.length >= 2 && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-accent-soft p-3 text-sm text-accent">
            <span>{selected.length} selected (up to 4)</span>
            <Button size="sm" variant="accent" onClick={() => navigate(`/employer/jobs/${id}/compare?ids=${selected.join(',')}`)}><GitCompare className="h-4 w-4" aria-hidden />Compare</Button>
          </div>
        )}
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

        {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>}
        {q.isError && <Alert tone="danger">Could not load applicants.</Alert>}
        {q.data?.items.length === 0 && (
          <EmptyState icon={Users} title={status ? 'No applicants with this status' : 'No applicants yet'} body={status ? 'Try another tab.' : 'Candidates who apply will appear here.'} />
        )}
        <ul className="space-y-3">
          {q.data?.items.map((a) => (
            <Row key={a.id} a={a} jobId={id!} selected={selected.includes(a.id)} canSelect={selected.length < 4} onToggle={() => toggle(a.id)} onError={setError} rules={all.data?.rules} />
          ))}
        </ul>
        <p className="mt-6 text-xs text-muted">Phone numbers appear after you shortlist a candidate. Match scores are a rule-based aid for ordering the list; open a candidate to see exactly how the score was calculated.</p>
      </PageBody>
    </>
  );
}
