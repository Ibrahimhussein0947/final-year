import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, GripVertical, List } from 'lucide-react';
import { Alert, Badge, Skeleton } from '@/components/ui/primitives';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { MatchBadge } from '@/components/MatchPanel';
import { askToMove, STATUS_ACTION, useMoveApplication } from '@/pages/employer/Applicants';
import { STATUS_META, useJobApplicants, type AppStatus, type ApplicantRow } from '@/lib/applications';
import { cn } from '@/lib/cn';

// The stages of a hiring process, left to right. Withdrawn applications are not a stage you act on, so they are
// listed below the board instead.
const COLUMNS: AppStatus[] = ['PENDING', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'ACCEPTED', 'REJECTED'];
const SCHEDULE_HINT = 'Interviews are set up from the candidate page (pick a date and place).';

function Card({ a, onMove, onSchedule, dragging, setDragging }: {
  a: ApplicantRow; onMove: (a: ApplicantRow, to: AppStatus) => void; onSchedule: (a: ApplicantRow) => void; dragging: string | null; setDragging: (id: string | null) => void;
}) {
  // INTERVIEW_SCHEDULED is never set by hand; the server only lists it as a next step through scheduling.
  const moves = a.allowedNext.filter((s) => STATUS_ACTION[s]);
  const canSchedule = a.status === 'UNDER_REVIEW' || a.status === 'SHORTLISTED' || a.status === 'INTERVIEW_SCHEDULED';
  const draggable = moves.length > 0 || canSchedule;
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; setDragging(a.id); }}
      onDragEnd={() => setDragging(null)}
      className={cn('rounded-xl border border-border bg-surface p-3 text-sm shadow-sm', draggable && 'cursor-grab', dragging === a.id && 'opacity-40')}
    >
      <div className="flex items-start gap-1.5">
        {draggable && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />}
        <div className="min-w-0 flex-1">
          <Link to={`/employer/applications/${a.id}`} className="block truncate font-semibold hover:text-accent">{a.candidate.name}</Link>
          <p className="truncate text-xs text-muted">{[a.candidate.headline ?? a.candidate.occupation, `${a.candidate.yearsExperience} yr`].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <MatchBadge match={a.match} />
        {a.qualified && a.status === 'PENDING' && <Badge tone="success">Qualified</Badge>}
      </div>
      {a.interviews[0] && (
        <p className="mt-2 flex items-center gap-1 text-xs text-warning"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{new Date(a.interviews[0].scheduledAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      )}
      {draggable && (
        <label className="mt-2 block text-xs">
          <span className="sr-only">Move {a.candidate.name} to</span>
          <select
            className="h-8 w-full rounded-lg border border-border bg-surface px-1.5"
            value=""
            onChange={(e) => {
              const to = e.target.value;
              e.target.value = '';
              if (to === 'SCHEDULE') onSchedule(a);
              else if (to) onMove(a, to as AppStatus);
            }}
          >
            <option value="">Move to…</option>
            {moves.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            {canSchedule && <option value="SCHEDULE">{a.status === 'INTERVIEW_SCHEDULED' ? 'Reschedule interview…' : 'Schedule interview…'}</option>}
          </select>
        </label>
      )}
    </li>
  );
}

/** A kanban view of one job's applicants: drag a card (or use its menu) to move it to the next stage. */
export default function HiringBoardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useJobApplicants(id, '', 'match');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<AppStatus | null>(null);
  const move = useMoveApplication(setError);

  const items = q.data?.items ?? [];
  const byStatus = (s: AppStatus) => items.filter((a) => a.status === s);
  const withdrawn = byStatus('WITHDRAWN');

  function moveTo(a: ApplicantRow, to: AppStatus) {
    setError(null);
    if (to === a.status) return;
    if (to === 'INTERVIEW_SCHEDULED') return onSchedule(a);
    if (!a.allowedNext.includes(to)) {
      setError(`${a.candidate.name} cannot be moved from “${STATUS_META[a.status].label}” to “${STATUS_META[to].label}”. ${a.allowedNext.length ? `Allowed: ${a.allowedNext.filter((s) => STATUS_ACTION[s]).map((s) => STATUS_META[s].label).join(', ')}.` : 'This decision is final.'}`);
      return;
    }
    const ask = askToMove(to, q.data?.rules, setError);
    if (ask) move.mutate({ applicationId: a.id, status: to, ...ask });
  }
  function onSchedule(a: ApplicantRow) {
    if (a.status === 'PENDING') {
      setError(`Start the review of ${a.candidate.name} first, then schedule an interview.`);
      return;
    }
    navigate(`/employer/applications/${a.id}`);
  }

  return (
    <>
      <PageHeader title={q.data ? `Hiring board: ${q.data.job.title}` : 'Hiring board'} subtitle="Drag a candidate to the next stage, or use the menu on the card." />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link to="/employer/jobs" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"><ArrowLeft className="h-4 w-4" aria-hidden />Your jobs</Link>
          <Link to={`/employer/jobs/${id}/applications`} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"><List className="h-4 w-4" aria-hidden />Show as a list</Link>
        </div>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
        {q.isLoading && <Skeleton className="h-64" />}
        {q.isError && <Alert tone="danger">Could not load applicants.</Alert>}
        {q.data && (
          <>
            <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Hiring stages">
              {COLUMNS.map((s) => {
                const col = byStatus(s);
                return (
                  <section
                    key={s}
                    aria-label={`${STATUS_META[s].label}, ${col.length}`}
                    onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(s); } }}
                    onDragLeave={() => setOver((o) => (o === s ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOver(null);
                      const a = items.find((x) => x.id === (e.dataTransfer.getData('text/plain') || dragging));
                      setDragging(null);
                      if (a) moveTo(a, s);
                    }}
                    className={cn('flex w-64 shrink-0 flex-col rounded-2xl border bg-surface-2 p-2.5', over === s ? 'border-accent ring-2 ring-accent/30' : 'border-border')}
                  >
                    <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-semibold">
                      <span>{STATUS_META[s].label}</span>
                      <Badge tone={STATUS_META[s].tone}>{col.length}</Badge>
                    </h2>
                    {s === 'INTERVIEW_SCHEDULED' && <p className="px-1 pb-2 text-xs text-muted">{SCHEDULE_HINT}</p>}
                    <ul className="min-h-16 space-y-2">
                      {col.map((a) => <Card key={a.id} a={a} onMove={moveTo} onSchedule={onSchedule} dragging={dragging} setDragging={setDragging} />)}
                      {col.length === 0 && <li className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted">Empty</li>}
                    </ul>
                  </section>
                );
              })}
            </div>
            {withdrawn.length > 0 && (
              <p className="mt-4 text-sm text-muted">{withdrawn.length} candidate{withdrawn.length === 1 ? '' : 's'} withdrew: {withdrawn.map((a) => a.candidate.name).join(', ')}.</p>
            )}
            <p className="mt-4 text-xs text-muted">
              Only moves the process allows are accepted, the same as on the list. Accepting or rejecting is final and the candidate is told. Phone numbers appear after you shortlist someone. Match scores assist your judgement and never decide for you.
            </p>
          </>
        )}
      </PageBody>
    </>
  );
}
