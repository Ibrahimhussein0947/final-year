import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Search } from 'lucide-react';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { downloadProtected, useAdminQuery } from '@/lib/admin';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

// ───────── Needs attention ─────────

interface AttentionData { items: { key: string; label: string; count: number; to: string }[]; total: number }

export function AttentionCard() {
  const q = useAdminQuery<AttentionData>(['insights', 'attention'], '/insights/attention');
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError || !q.data) return <Alert tone="danger">Could not load the attention list.</Alert>;
  const open = q.data.items.filter((i) => i.count > 0);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Needs attention</h2>
        <Badge tone={q.data.total > 0 ? 'warning' : 'success'}>{q.data.total > 0 ? `${q.data.total} to look at` : 'All clear'}</Badge>
      </div>
      {open.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing is waiting for you.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border text-sm">
          {open.map((i) => (
            <li key={i.key}>
              <Link to={i.to} className="flex items-center justify-between py-2 hover:text-accent">
                <span>{i.label}</span>
                <span className="font-bold text-warning">{i.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ───────── Trends ─────────

interface TrendPoint { date: string; signups: number; jobs: number; applications: number; hires: number }
const SERIES: { key: keyof Omit<TrendPoint, 'date'>; label: string; color: string }[] = [
  { key: 'signups', label: 'Sign-ups', color: 'var(--color-accent, #14b8a6)' },
  { key: 'jobs', label: 'Jobs posted', color: '#f59e0b' },
  { key: 'applications', label: 'Applications', color: '#6366f1' },
  { key: 'hires', label: 'Hires', color: '#22c55e' },
];

function BarChart({ points, field, color }: { points: TrendPoint[]; field: keyof Omit<TrendPoint, 'date'>; color: string }) {
  const max = Math.max(1, ...points.map((p) => p[field]));
  const w = 300;
  const h = 70;
  const bw = w / points.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" role="img" aria-label={`${field} per day`} preserveAspectRatio="none">
      {points.map((p, i) => {
        const bh = (p[field] / max) * (h - 4);
        return (
          <rect key={p.date} x={i * bw + 0.5} y={h - bh} width={Math.max(1, bw - 1)} height={bh} fill={color} rx="1">
            <title>{`${p.date}: ${p[field]}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function TrendsCard() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const q = useAdminQuery<{ points: TrendPoint[] }>(['insights', 'trends', String(days)], `/insights/trends?days=${days}`);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Activity over time</h2>
        <div className="flex gap-1" role="group" aria-label="Period">
          {([7, 30, 90] as const).map((d) => (
            <Button key={d} size="sm" variant={days === d ? 'primary' : 'outline'} onClick={() => setDays(d)}>{d} days</Button>
          ))}
        </div>
      </div>
      {q.isLoading && <Skeleton className="mt-4 h-40" />}
      {q.isError && <Alert tone="danger">Could not load the trends.</Alert>}
      {q.data && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {SERIES.map((s) => {
            const total = q.data.points.reduce((n, p) => n + p[s.key], 0);
            return (
              <div key={s.key}>
                <p className="flex justify-between text-sm"><span className="text-muted">{s.label}</span><span className="font-bold">{total}</span></p>
                <BarChart points={q.data.points} field={s.key} color={s.color} />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ───────── Recent activity ─────────

interface RecentData {
  users: { id: string; name: string; role: string; at: string }[];
  jobs: { id: string; title: string; status: string; organization: string; at: string }[];
  reports: { id: string; target: string; reason: string; status: string; at: string }[];
}

export function RecentCard() {
  const q = useAdminQuery<RecentData>(['insights', 'recent'], '/insights/recent');
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data) return <Alert tone="danger">Could not load recent activity.</Alert>;
  const d = q.data;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="p-5">
        <h2 className="font-semibold">New sign-ups</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {d.users.map((u) => (
            <li key={u.id}><Link to={`/admin/users/${u.id}`} className="font-medium text-accent hover:underline">{u.name}</Link><p className="text-xs text-muted">{u.role.toLowerCase()} · {when(u.at)}</p></li>
          ))}
          {d.users.length === 0 && <li className="text-muted">None yet.</li>}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Newest jobs</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {d.jobs.map((j) => (
            <li key={j.id}><p className="font-medium">{j.title}</p><p className="text-xs text-muted">{j.organization} · {j.status.toLowerCase()} · {when(j.at)}</p></li>
          ))}
          {d.jobs.length === 0 && <li className="text-muted">None yet.</li>}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">Latest reports</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {d.reports.map((r) => (
            <li key={r.id}><Link to="/admin/moderation" className="font-medium hover:text-accent">{r.reason}</Link><p className="text-xs text-muted">{r.target.toLowerCase()} · {r.status.toLowerCase()} · {when(r.at)}</p></li>
          ))}
          {d.reports.length === 0 && <li className="text-muted">No reports.</li>}
        </ul>
      </Card>
    </div>
  );
}

// ───────── Exports ─────────

export function ExportButton({ kind, label }: { kind: 'users' | 'jobs' | 'organizations'; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setErr(false);
          try { await downloadProtected(`/admin/export/${kind}`, `${kind}-${new Date().toISOString().slice(0, 10)}.csv`); } catch { setErr(true); }
          setBusy(false);
        }}
      >
        <Download className="mr-1.5 h-4 w-4" aria-hidden /> {label ?? `Export ${kind} (CSV)`}
      </Button>
      {err && <span role="alert" className="text-xs text-danger">Could not export (your level may not allow it).</span>}
    </span>
  );
}

export function ExportCard() {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Export data</h2>
      <p className="mt-1 text-sm text-muted">Download a spreadsheet (CSV). Each export is recorded in the activity log.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <ExportButton kind="users" label="Users" />
        <ExportButton kind="jobs" label="Jobs" />
        <ExportButton kind="organizations" label="Organizations" />
      </div>
    </Card>
  );
}

// ───────── Global search ─────────

interface Hit { id: string; label: string; detail: string; to: string }
interface SearchData { users: Hit[]; jobs: Hit[]; organizations: Hit[] }

export function GlobalSearch() {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const q = useAdminQuery<SearchData>(['search', debounced], `/search?q=${encodeURIComponent(debounced)}`, debounced.length >= 2);
  const groups: [string, Hit[]][] = q.data ? [['People', q.data.users], ['Jobs', q.data.jobs], ['Organizations', q.data.organizations]] : [];
  const empty = q.data && groups.every(([, h]) => h.length === 0);
  return (
    <div ref={box} className="relative w-full max-w-md">
      <label className="relative block">
        <span className="sr-only">Search users, jobs and organizations</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          placeholder="Search users, jobs, organizations…"
          className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm"
        />
      </label>
      {open && debounced.length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-lg">
          {q.isLoading && <p className="p-2 text-sm text-muted">Searching…</p>}
          {empty && <p className="p-2 text-sm text-muted">No results for “{debounced}”.</p>}
          {groups.filter(([, h]) => h.length > 0).map(([title, hits]) => (
            <div key={title} className="mb-1">
              <p className="px-2 pt-1 text-xs font-semibold uppercase text-muted">{title}</p>
              {hits.map((h) => (
                <button key={h.id} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => { setOpen(false); setText(''); navigate(h.to); }}>
                  <span className="text-sm font-medium">{h.label}</span>
                  <span className="block text-xs text-muted">{h.detail}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
