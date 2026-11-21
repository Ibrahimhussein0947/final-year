import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Phone, UserRound, Video } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useAuth } from '@/app/auth';
import { cn } from '@/lib/cn';
import { dayKey, downloadIcs, joinLink, MODE_LABEL, respondToInterview, useMyInterviews, type CalendarInterview } from '@/lib/interviews';
import { ApiError } from '@/lib/api';

/** "Join video call" when it is time, otherwise when it opens. The link only comes from the server inside the window. */
function JoinCall({ i }: { i: CalendarInterview }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!i.video || i.status !== 'SCHEDULED') return null;
  if (new Date(i.video.closesAt) < new Date()) return null;
  if (!i.video.canJoinNow) {
    return <p className="mt-1 text-xs text-muted">The call can be joined from {new Date(i.video.opensAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.</p>;
  }
  async function join() {
    setBusy(true);
    setError(null);
    try {
      window.open(await joinLink(i.id), '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the call. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2">
      <Button size="sm" variant="accent" loading={busy} onClick={join}><Video className="h-4 w-4" aria-hidden /> Join video call</Button>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** The candidate's answer. A worker can confirm or say they cannot come; an employer sees the answer and any reason. */
function Answer({ i, isEmployer }: { i: CalendarInterview; isEmployer: boolean }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (i.status !== 'SCHEDULED') return null;
  const upcoming = new Date(i.scheduledAt) > new Date();
  async function send(response: 'CONFIRMED' | 'DECLINED') {
    setBusy(true);
    setError(null);
    try {
      await respondToInterview(i.id, response, note.trim());
      setAsking(false);
      setNote('');
      await qc.invalidateQueries({ queryKey: ['my-interviews'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send your answer. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const badge = i.response === 'CONFIRMED' ? <Badge tone="success">{isEmployer ? 'Candidate confirmed' : 'You confirmed'}</Badge>
    : i.response === 'DECLINED' ? <Badge tone="danger">{isEmployer ? "Candidate can't attend" : "You can't attend"}</Badge>
    : <Badge>{isEmployer ? 'Waiting for the candidate' : 'Please answer'}</Badge>;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">{badge}</div>
      {isEmployer && i.response === 'DECLINED' && (
        <p className="mt-1 text-xs text-muted">{i.declineNote ? `Reason: ${i.declineNote}. ` : ''}Open the candidate to move the interview to another time.</p>
      )}
      {!isEmployer && upcoming && !asking && (
        <div className="mt-2 flex flex-wrap gap-2">
          {i.response !== 'CONFIRMED' && <Button size="sm" variant="accent" loading={busy} onClick={() => send('CONFIRMED')}>I can come</Button>}
          {i.response !== 'DECLINED' && <Button size="sm" variant="outline" onClick={() => setAsking(true)}>I can't come</Button>}
        </div>
      )}
      {!isEmployer && asking && (
        <div className="mt-2 space-y-2">
          <label className="block text-xs text-muted" htmlFor={`note-${i.id}`}>Tell the employer why (optional)</label>
          <input id={`note-${i.id}`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <Button size="sm" variant="accent" loading={busy} onClick={() => send('DECLINED')}>Send</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ModeIcon = ({ mode }: { mode: CalendarInterview['mode'] }) => (mode === 'VIDEO' ? <Video className="h-3.5 w-3.5" aria-hidden /> : mode === 'PHONE' ? <Phone className="h-3.5 w-3.5" aria-hidden /> : <UserRound className="h-3.5 w-3.5" aria-hidden />);

/** Monday-first grid of the weeks that cover a month. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const last = new Date(year, month + 1, 0);
  const days = Math.ceil(((last.getTime() - start.getTime()) / 86_400_000 + 1) / 7) * 7;
  return Array.from({ length: days }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Interviews as a month calendar with a day-by-day list. Works for workers (their interviews) and employers (their organization's). */
export default function InterviewsPage() {
  const { user } = useAuth();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [picked, setPicked] = useState<string | null>(dayKey(today));
  const [error, setError] = useState<string | null>(null);
  const grid = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const q = useMyInterviews(grid[0], new Date(grid[grid.length - 1].getTime() + 86_400_000));

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarInterview[]>();
    for (const i of q.data ?? []) {
      if (i.status === 'CANCELLED') continue;
      const k = dayKey(new Date(i.scheduledAt));
      map.set(k, [...(map.get(k) ?? []), i]);
    }
    return map;
  }, [q.data]);
  const shift = (delta: number) => { const d = new Date(cursor.y, cursor.m + delta, 1); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setPicked(null); };
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const dayItems = picked ? byDay.get(picked) ?? [] : [];
  const upcoming = (q.data ?? []).filter((i) => i.status === 'SCHEDULED' && new Date(i.scheduledAt) >= new Date()).slice(0, 5);
  const isEmployer = user?.role === 'EMPLOYER';
  const link = (i: CalendarInterview) => (isEmployer ? `/employer/applications/${i.applicationId}` : '/applications');

  return (
    <>
      <PageHeader title="Interviews" subtitle={isEmployer ? 'Interviews with your candidates.' : 'Your interviews with employers.'} />
      <PageBody>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
              <h2 className="font-semibold" aria-live="polite">{monthName}</h2>
              <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">{WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}</div>
            <div className="grid grid-cols-7 gap-1" role="grid" aria-label={monthName}>
              {grid.map((d) => {
                const k = dayKey(d);
                const items = byDay.get(k) ?? [];
                const inMonth = d.getMonth() === cursor.m;
                return (
                  <button
                    key={k} type="button" role="gridcell"
                    aria-label={`${d.toLocaleDateString('en-GB', { dateStyle: 'full' })}${items.length ? `, ${items.length} interview${items.length === 1 ? '' : 's'}` : ''}`}
                    aria-pressed={picked === k}
                    onClick={() => setPicked(k)}
                    className={cn(
                      'flex min-h-16 flex-col items-center rounded-lg border p-1 text-sm',
                      picked === k ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-surface-2',
                      !inMonth && 'opacity-40', k === dayKey(today) && 'font-bold ring-1 ring-accent',
                    )}
                  >
                    <span>{d.getDate()}</span>
                    {items.length > 0 && <span className="mt-1 rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{items.length}</span>}
                  </button>
                );
              })}
            </div>
            {q.isLoading && <Skeleton className="mt-3 h-6" />}
            {q.isError && <div className="mt-3"><Alert tone="danger">Could not load interviews.</Alert></div>}
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <h2 className="font-semibold">{picked ? new Date(`${picked}T00:00:00`).toLocaleDateString('en-GB', { dateStyle: 'full' }) : 'Pick a day'}</h2>
              {dayItems.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No interviews on this day.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {dayItems.map((i) => (
                    <li key={i.id} className="rounded-xl bg-warning-soft p-3 text-sm">
                      <p className="flex items-center justify-between gap-2 font-semibold"><span>{time(i.scheduledAt)}–{time(i.endsAt)}</span>{i.status === 'COMPLETED' && <Badge>Done</Badge>}</p>
                      <p><Link to={link(i)} className="font-medium hover:text-accent">{i.with}</Link> · {i.job.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted"><ModeIcon mode={i.mode} />{MODE_LABEL[i.mode]}{i.locationOrLink && !i.video ? ` · ${i.locationOrLink}` : ''}{i.video?.platformRoom ? ' · private room' : ''}</p>
                      <Answer i={i} isEmployer={isEmployer} />
                      <JoinCall i={i} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="font-semibold">Coming up</h2>
              {upcoming.length === 0 ? (
                <EmptyState icon={CalendarDays} title="Nothing scheduled" body={isEmployer ? 'Schedule an interview from a shortlisted candidate.' : 'When an employer books an interview it appears here.'} />
              ) : (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {upcoming.map((i) => (
                    <li key={i.id} className="py-2">
                      <button type="button" className="text-left hover:text-accent" onClick={() => { const d = new Date(i.scheduledAt); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setPicked(dayKey(d)); }}>
                        <span className="font-medium">{new Date(i.scheduledAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}, {time(i.scheduledAt)}</span>
                        <span className="block text-muted">{i.with} · {i.job.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => downloadIcs().catch(() => setError('Could not download the calendar file.'))}>
                <Download className="h-4 w-4" aria-hidden /> Add to my phone or Google calendar (.ics)
              </Button>
              <p className="mt-2 text-xs text-muted">You are reminded in the app about a day before and about an hour before each interview, and workers can confirm or decline each time. Times are shown in your device's time zone.</p>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
