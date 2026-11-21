import { useState } from 'react';
import { Alert, Badge, Card, EmptyState, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { downloadProtected, useAdminAction, useAdminQuery, type AdminStats, type AdminUser, type Paged, type PendingJob, type ReportItem, type VerificationItem } from '@/lib/admin';
import { api } from '@/lib/api';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const ErrorLine = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-2 text-sm text-danger">{text}</p> : null);
const select = 'h-9 rounded-lg border border-border bg-surface px-2 text-sm';

// ───────── Overview ─────────

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'warning' }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className={`text-2xl font-extrabold ${tone === 'warning' && value > 0 ? 'text-warning' : ''}`}>{value.toLocaleString('en-US')}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export function AdminOverview() {
  const stats = useAdminQuery<{ stats: AdminStats }>(['stats'], '/stats');
  const sys = useAdminQuery<{ database: { ok: boolean; latencyMs: number }; aiService: { configured: boolean }; sms: { gatewayConfigured: boolean }; activity24h: { logins: number; jobsCreated: number; lastAuditEvent: string | null }; uptimeSeconds: number }>(['system'], '/system');
  const s = stats.data?.stats;
  return (
    <div className="space-y-6">
      {stats.isLoading && <Skeleton className="h-40" />}
      {stats.isError && <Alert tone="danger">Could not load the statistics.</Alert>}
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Total users" value={s.users} /><Tile label="Workers" value={s.workers} /><Tile label="Employers" value={s.employers} /><Tile label="Suspended accounts" value={s.suspendedUsers} />
          <Tile label="Jobs (not removed)" value={s.jobs} /><Tile label="Active jobs" value={s.activeJobs} /><Tile label="Applications" value={s.applications} /><Tile label="Successful recruitments" value={s.successfulRecruitments} />
          <Tile label="Pending verification requests" value={s.pendingVerifications} tone="warning" /><Tile label="Open reports" value={s.openReports} tone="warning" />
          <Tile label="Jobs waiting for review" value={s.suspiciousAds} tone="warning" /><Tile label="Unverified organizations" value={s.unverifiedOrganizations} />
        </div>
      )}
      <Card className="p-5">
        <h2 className="font-semibold">System</h2>
        {sys.isLoading && <Skeleton className="mt-3 h-16" />}
        {sys.data && (
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li>Database: <Badge tone={sys.data.database.ok ? 'success' : 'danger'}>{sys.data.database.ok ? `OK, ${sys.data.database.latencyMs} ms` : 'Down'}</Badge></li>
            <li>AI service (semantic matching): <Badge tone={sys.data.aiService.configured ? 'success' : 'neutral'}>{sys.data.aiService.configured ? 'Connected' : 'Not connected: rule-based only'}</Badge></li>
            <li>SMS gateway: <Badge tone={sys.data.sms.gatewayConfigured ? 'success' : 'neutral'}>{sys.data.sms.gatewayConfigured ? 'Configured' : 'Not configured: no SMS sent'}</Badge></li>
            <li>Last 24 hours: {sys.data.activity24h.logins} logins, {sys.data.activity24h.jobsCreated} jobs created</li>
            <li>Last recorded activity: {when(sys.data.activity24h.lastAuditEvent)}</li>
            <li>Server uptime: {Math.round(sys.data.uptimeSeconds / 60)} min</li>
          </ul>
        )}
      </Card>
    </div>
  );
}

// ───────── Users ─────────

export function AdminUsers() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}), page: String(pageNo) }).toString();
  const list = useAdminQuery<Paged<AdminUser>>(['users', qs], `/users?${qs}`);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const change = useAdminAction((a: { id: string; status: 'ACTIVE' | 'SUSPENDED'; reason?: string }) => api(`/admin/users/${a.id}/status`, { method: 'PATCH', body: { status: a.status, ...(a.reason ? { reason: a.reason } : {}) } }), { invalidate: ['users', 'stats'] });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-4">
        <TextField label="Search name, phone or email" value={q} onChange={(e) => { setQ(e.target.value); setPageNo(1); }} />
        <label className="text-sm font-medium">Role<select className={`${select} mt-1.5 w-full`} value={role} onChange={(e) => { setRole(e.target.value); setPageNo(1); }}><option value="">All</option><option>WORKER</option><option>EMPLOYER</option><option>ADMIN</option></select></label>
        <label className="text-sm font-medium">Status<select className={`${select} mt-1.5 w-full`} value={status} onChange={(e) => { setStatus(e.target.value); setPageNo(1); }}><option value="">All</option><option>ACTIVE</option><option>SUSPENDED</option></select></label>
      </Card>
      {list.isLoading && <Skeleton className="h-64" />}
      {list.isError && <Alert tone="danger">Could not load users.</Alert>}
      <ErrorLine text={change.error} />
      {list.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="border-b border-border text-muted"><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Contact</th><th className="p-3">Joined</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 align-top">
                  <td className="p-3"><p className="font-medium">{u.fullName}</p>{u.organization && <p className="text-xs text-muted">{u.organization.name} · {u.organization.verificationStatus.toLowerCase()}</p>}</td>
                  <td className="p-3">{u.role.toLowerCase()}</td>
                  <td className="p-3 text-xs">{u.phone}{u.phoneVerified ? ' ✓' : ''}<br />{u.email ?? '–'}</td>
                  <td className="p-3 text-xs">{when(u.createdAt)}<br />last login {when(u.lastLoginAt)}</td>
                  <td className="p-3"><Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>{u.status.toLowerCase()}</Badge></td>
                  <td className="p-3">
                    {u.role !== 'ADMIN' && u.status === 'ACTIVE' && (reasonFor === u.id ? (
                      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); change.mutate({ id: u.id, status: 'SUSPENDED', reason }, { onSuccess: () => { setReasonFor(null); setReason(''); } }); }}>
                        <input aria-label="Reason" className="h-9 w-44 rounded-lg border border-border bg-surface px-2 text-sm" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button size="sm" variant="outline" type="submit" disabled={reason.trim().length < 3} loading={change.isPending}>Suspend</Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setReasonFor(null)}>Cancel</Button>
                      </form>
                    ) : <Button size="sm" variant="ghost" className="text-danger" onClick={() => { change.clearError(); setReasonFor(u.id); }}>Suspend</Button>)}
                    {u.role !== 'ADMIN' && u.status === 'SUSPENDED' && <Button size="sm" variant="outline" loading={change.isPending} onClick={() => change.mutate({ id: u.id, status: 'ACTIVE' })}>Reactivate</Button>}
                  </td>
                </tr>
              ))}
              {list.data.items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">No users match.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {list.data && pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="outline" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>Previous</Button>
          <span className="text-muted">Page {pageNo} of {pages} · {list.data.total} users</span>
          <Button size="sm" variant="outline" disabled={pageNo >= pages} onClick={() => setPageNo(pageNo + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

// ───────── Verification ─────────

const KIND: Record<string, string> = { EMPLOYER: 'Employer verification', QUALIFICATION: 'Qualification', SKILL: 'Skill', IDENTITY: 'Identity' };
const OUTCOME = { CONSISTENT: ['success', 'Details match'], PARTIAL: ['warning', 'Mostly matches'], MISMATCH: ['danger', "Details don't match"], UNREADABLE: ['neutral', 'Could not be read'] } as const;
const MARK = { FOUND: '✓', CLOSE: '≈', NOT_FOUND: '✗' } as const;

/** The automatic comparison of an uploaded document with what the person typed. It cannot tell whether the document is genuine. */
function AutoCheckPanel({ c }: { c: NonNullable<VerificationItem['check']> }) {
  const [tone, label] = OUTCOME[c.outcome];
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Automatic comparison</span><Badge tone={tone}>{label}</Badge>
        <span className="text-xs text-muted">{c.ocrConfidence !== null ? `read from a picture, confidence ${c.ocrConfidence}%` : 'read from the PDF text'}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {c.fields.map((f) => (
          <li key={f.field}><span className={f.status === 'FOUND' ? 'text-success' : f.status === 'CLOSE' ? 'text-warning' : 'text-danger'} aria-label={f.status.toLowerCase().replace('_', ' ')}>{MARK[f.status]}</span> <strong>{f.field}</strong>: {f.expected}{f.note ? <span className="text-muted"> ({f.note})</span> : null}{f.read ? <span className="block pl-4 text-xs text-muted">document says: “{f.read}”</span> : null}</li>
        ))}
      </ul>
      {c.reason && <p className="mt-2 text-muted">{c.reason}</p>}
      {c.flags.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-border pt-2" aria-label="Warning signs">
          {c.flags.map((fl) => <li key={fl.code} className={fl.level === 'warn' ? 'text-warning' : 'text-muted'}>{fl.level === 'warn' ? '⚠ ' : 'ℹ '}{fl.message}</li>)}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">This only compares words and dates; it cannot tell a genuine certificate from a good forgery. Open the file and look at it, and approve only what you are satisfied with.</p>
    </div>
  );
}

function VerificationRow({ v }: { v: VerificationItem }) {
  const [note, setNote] = useState('');
  const [dlError, setDlError] = useState<string | null>(null);
  const review = useAdminAction((decision: 'APPROVED' | 'REJECTED') => api(`/admin/verifications/${v.id}/review`, { method: 'POST', body: { decision, note: note.trim() || undefined } }), { invalidate: ['verifications', 'stats'] });
  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{KIND[v.kind] ?? v.kind}: {v.target ?? '–'}</p>
            <p className="text-sm text-muted">{v.requester.name} ({v.requester.role.toLowerCase()}){v.organization ? ` · ${v.organization.name}` : ''} · sent {when(v.createdAt)}</p>
          </div>
          <Badge tone={v.status === 'PENDING' ? 'warning' : v.status === 'APPROVED' ? 'success' : 'danger'}>{v.status.toLowerCase()}</Badge>
        </div>
        {v.check && <AutoCheckPanel c={v.check} />}
        {v.evidenceUrl && (
          <Button className="mt-3" size="sm" variant="outline" onClick={() => downloadProtected(v.evidenceUrl!, 'evidence').catch(() => setDlError('Could not open the evidence file.'))}>Open evidence</Button>
        )}
        <ErrorLine text={dlError} />
        {v.status === 'PENDING' ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1 text-sm"><span className="sr-only">Note</span><input className="h-9 w-full rounded-lg border border-border bg-surface px-2" placeholder="Note to the person (required if rejecting)" value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <Button size="sm" variant="accent" loading={review.isPending} onClick={() => { if (window.confirm('Mark this as verified? Only do this after checking the evidence.')) review.mutate('APPROVED'); }}>Approve</Button>
            <Button size="sm" variant="outline" loading={review.isPending} onClick={() => review.mutate('REJECTED')}>Reject</Button>
          </div>
        ) : v.note && <p className="mt-2 text-sm text-muted">Note: {v.note}</p>}
        <ErrorLine text={review.error} />
      </Card>
    </li>
  );
}

export function AdminVerification() {
  const [status, setStatus] = useState('PENDING');
  const q = useAdminQuery<{ items: VerificationItem[] }>(['verifications', status], `/verifications?status=${status}`);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <label>Show <select className={select} value={status} onChange={(e) => setStatus(e.target.value)}><option value="PENDING">Waiting for review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></label>
        <span className="text-muted">A verified badge is only ever set here, after an administrator has looked at the evidence.</span>
      </div>
      {q.isLoading && <Skeleton className="h-40" />}
      {q.isError && <Alert tone="danger">Could not load requests.</Alert>}
      {q.data?.items.length === 0 && <EmptyState icon={ShieldCheck} title="Nothing here" body={status === 'PENDING' ? 'No requests are waiting for review.' : 'No requests with this status.'} />}
      <ul className="space-y-3">{q.data?.items.map((v) => <VerificationRow key={v.id} v={v} />)}</ul>
    </div>
  );
}

// ───────── Moderation ─────────

const REASON: Record<string, string> = { SCAM: 'Scam or fraud', FALSE_INFO: 'False information', DISCRIMINATION: 'Discrimination', OFFENSIVE: 'Offensive content', DUPLICATE: 'Duplicate', OTHER: 'Other' };

function ReportRow({ r }: { r: ReportItem }) {
  const [note, setNote] = useState('');
  const act = useAdminAction((action: string) => api(`/admin/moderation/reports/${r.id}/resolve`, { method: 'POST', body: { action, note: note.trim() || undefined } }), { invalidate: ['reports', 'stats', 'users'] });
  const strong = r.targetType === 'JOB' ? ['REMOVE_JOB', 'Remove the job'] : r.targetType === 'SERVICE' ? ['REMOVE_SERVICE', 'Remove the listing'] : ['SUSPEND_USER', 'Suspend the user'];
  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-semibold">{r.targetType === 'JOB' ? 'Job' : r.targetType === 'SERVICE' ? 'Service' : 'User'}: {r.target?.label}</p><p className="text-sm text-muted">{REASON[r.reason] ?? r.reason} · reported by {r.reporter} · {when(r.createdAt)}</p></div>
          {r.openReportsOnTarget > 1 && <Badge tone="warning">{r.openReportsOnTarget} open reports</Badge>}
        </div>
        {r.details && <p className="mt-2 rounded-lg bg-surface-2 p-3 text-sm">“{r.details}”</p>}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input aria-label="Note" className="h-9 min-w-56 flex-1 rounded-lg border border-border bg-surface px-2 text-sm" placeholder="Note (required for removing or suspending)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => act.mutate('DISMISS')}>Dismiss</Button>
          <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate('NO_ACTION')}>Resolve, no action</Button>
          <Button size="sm" variant="accent" loading={act.isPending} onClick={() => { if (window.confirm(`${strong[1]}? This affects a real person.`)) act.mutate(strong[0]); }}>{strong[1]}</Button>
        </div>
        <ErrorLine text={act.error} />
      </Card>
    </li>
  );
}

function PendingJobRow({ j }: { j: PendingJob }) {
  const [note, setNote] = useState('');
  const review = useAdminAction((decision: 'APPROVE' | 'REJECT') => api(`/admin/moderation/jobs/${j.id}/review`, { method: 'POST', body: { decision, note: note.trim() || undefined } }), { invalidate: ['pendingJobs', 'stats'] });
  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-semibold">{j.title}</p><p className="text-sm text-muted">{j.organization} · {j.category} · {when(j.createdAt)}</p></div>
          <Badge tone="warning">{j.reason}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted">{j.snippet}{j.snippet.length >= 300 ? '…' : ''}</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input aria-label="Note" className="h-9 min-w-56 flex-1 rounded-lg border border-border bg-surface px-2 text-sm" placeholder="Note to the employer (required if rejecting)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" variant="accent" loading={review.isPending} onClick={() => review.mutate('APPROVE')}><CheckCircle2 className="h-4 w-4" aria-hidden />Approve and publish</Button>
          <Button size="sm" variant="outline" loading={review.isPending} onClick={() => review.mutate('REJECT')}>Reject</Button>
        </div>
        <ErrorLine text={review.error} />
      </Card>
    </li>
  );
}

export function AdminModeration() {
  const reports = useAdminQuery<{ items: ReportItem[] }>(['reports'], '/moderation/reports');
  const jobs = useAdminQuery<{ items: PendingJob[] }>(['pendingJobs'], '/moderation/jobs');
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-bold">Reports</h2>
        {reports.isLoading && <Skeleton className="h-32" />}
        {reports.data?.items.length === 0 && <EmptyState icon={ShieldCheck} title="No open reports" body="Reports from workers and employers appear here." />}
        <ul className="space-y-3">{reports.data?.items.map((r) => <ReportRow key={r.id} r={r} />)}</ul>
      </section>
      <section>
        <h2 className="mb-1 text-lg font-bold">Jobs waiting for review</h2>
        <p className="mb-3 text-sm text-muted">Jobs held because their text was copied from another organization, they came from an unverified organization while the review gate is on, or they were edited after approval.</p>
        {jobs.isLoading && <Skeleton className="h-32" />}
        {jobs.data?.items.length === 0 && <EmptyState icon={CheckCircle2} title="Nothing waiting" body="No jobs are being held for review." />}
        <ul className="space-y-3">{jobs.data?.items.map((j) => <PendingJobRow key={j.id} j={j} />)}</ul>
      </section>
    </div>
  );
}
