import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Card, Skeleton, TextAreaField, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAdminAction, useAdminQuery, type Paged } from '@/lib/admin';
import { api } from '@/lib/api';
import { useLocations } from '@/lib/profile';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const ErrorLine = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-2 text-sm text-danger">{text}</p> : null);
const select = 'h-9 rounded-lg border border-border bg-surface px-2 text-sm';

// ───────── Announcements ─────────

interface AnnouncementRow {
  id: string; title: string; body: string; audience: 'ALL' | 'WORKERS' | 'EMPLOYERS'; region: string | null; startsAt: string; endsAt: string | null;
  status: 'active' | 'scheduled' | 'ended' | 'withdrawn'; notifiedCount: number;
}
const AUDIENCE = { ALL: 'Everyone', WORKERS: 'Workers', EMPLOYERS: 'Employers' } as const;
const STATUS_TONE = { active: 'success', scheduled: 'info', ended: 'neutral', withdrawn: 'neutral' } as const;
const blank = { title: '', body: '', audience: 'ALL', regionId: '', startsAt: '', endsAt: '', notify: false };

/** Notices to workers and employers: a banner while active, optionally also sent to each person's notifications once. */
export function AdminAnnouncements() {
  const list = useAdminQuery<{ items: AnnouncementRow[] }>(['announcements'], '/announcements');
  const regions = useLocations();
  const [form, setForm] = useState(blank);
  const [done, setDone] = useState<string | null>(null);
  const create = useAdminAction(
    () => api<{ announcement: { notifiedCount: number } }>('/admin/announcements', {
      method: 'POST',
      body: {
        title: form.title, body: form.body, audience: form.audience, regionId: form.regionId || null,
        ...(form.startsAt ? { startsAt: new Date(form.startsAt).toISOString() } : {}),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null, notify: form.notify,
      },
    }),
    { invalidate: ['announcements'] },
  );
  const withdraw = useAdminAction((id: string) => api(`/admin/announcements/${id}/withdraw`, { method: 'POST', body: {} }), { invalidate: ['announcements'] });

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="font-semibold">New announcement</h2>
        <p className="mt-1 text-sm text-muted">Shown as a banner to the people you choose while it is active. Only administrators can write these. Keep it short and never include personal details.</p>
        <form
          noValidate
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(null);
            create.mutate(undefined, {
              onSuccess: (r) => { setDone(form.notify ? `Published and sent to ${(r as { announcement: { notifiedCount: number } }).announcement.notifiedCount} people.` : 'Published.'); setForm(blank); },
            });
          }}
        >
          <div className="sm:col-span-2"><TextField label="Title" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="sm:col-span-2"><TextAreaField label="Message" rows={3} maxLength={1000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
          <label className="text-sm font-medium">Who sees it
            <select className={`${select} mt-1.5 w-full`} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              {Object.entries(AUDIENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Region
            <select className={`${select} mt-1.5 w-full`} value={form.regionId} onChange={(e) => setForm({ ...form, regionId: e.target.value })}>
              <option value="">All regions</option>
              {regions.data?.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
            </select>
          </label>
          <TextField label="Starts (empty = now)" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          <TextField label="Ends (empty = until withdrawn)" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.notify} disabled={!!form.startsAt} onChange={(e) => setForm({ ...form, notify: e.target.checked })} />
            Also add it to each person&apos;s notifications now (only when it starts now)
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" loading={create.isPending} disabled={form.title.trim().length < 3 || form.body.trim().length < 3}>Publish announcement</Button>
            <ErrorLine text={create.error} />
            {done && <p role="status" className="mt-2 text-sm text-success">{done}</p>}
          </div>
        </form>
      </Card>

      {list.isLoading && <Skeleton className="h-32" />}
      {list.isError && <Alert tone="danger">Could not load announcements.</Alert>}
      <ErrorLine text={withdraw.error} />
      {list.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="border-b border-border text-muted"><th className="p-3">Announcement</th><th className="p-3">Audience</th><th className="p-3">When</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id} className="border-b border-border align-top last:border-0">
                  <td className="p-3"><p className="font-medium">{a.title}</p><p className="text-xs text-muted">{a.body}</p></td>
                  <td className="p-3 text-xs">{AUDIENCE[a.audience]}<br />{a.region ?? 'All regions'}{a.notifiedCount > 0 && <><br />{a.notifiedCount} notified</>}</td>
                  <td className="p-3 text-xs">from {when(a.startsAt)}<br />until {a.endsAt ? when(a.endsAt) : 'withdrawn'}</td>
                  <td className="p-3"><Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge></td>
                  <td className="p-3">{(a.status === 'active' || a.status === 'scheduled') && <Button size="sm" variant="ghost" className="text-danger" loading={withdraw.isPending} onClick={() => withdraw.mutate(a.id)}>Withdraw</Button>}</td>
                </tr>
              ))}
              {list.data.items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">No announcements yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ───────── Jobs and applications ─────────

interface JobRow {
  id: string; title: string; status: string; deadline: string | null; createdAt: string; featured: boolean; vacancies: number;
  organization: { id: string; name: string; verificationStatus: string }; applications: number; flags: ('expired' | 'noApplicants' | 'held')[];
}
interface AppRow { id: string; status: string; createdAt: string; job: { id: string; title: string; organization: string }; worker: { userId: string; name: string } }
type JobsPage = Paged<JobRow> & { problems: { expired: number; noApplicants: number; held: number } };
const FLAG_LABEL = { expired: 'Past deadline', noApplicants: 'No applicants in 7 days', held: 'Waiting for review' } as const;
const JOB_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'CLOSED', 'FILLED', 'REMOVED'];
const APP_STATUSES = ['PENDING', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'];

function Pager({ page, total, pageSize, set, noun }: { page: number; total: number; pageSize: number; set: (n: number) => void; noun: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set(page - 1)}>Previous</Button>
      <span className="text-muted">Page {page} of {pages} · {total} {noun}</span>
      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => set(page + 1)}>Next</Button>
    </div>
  );
}

/** Every job and application on the platform. Problem lists first; closing or featuring a job is logged. Removal is in Moderation. */
export function AdminJobs() {
  const [view, setView] = useState<'jobs' | 'applications'>('jobs');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [flag, setFlag] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [closing, setClosing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(view === 'jobs' && flag ? { flag } : {}), page: String(pageNo) }).toString();
  const jobs = useAdminQuery<JobsPage>(['jobs', qs], `/jobs?${qs}`, view === 'jobs');
  const apps = useAdminQuery<Paged<AppRow>>(['applications', qs], `/applications?${qs}`, view === 'applications');
  const close = useAdminAction((a: { id: string; reason: string }) => api(`/admin/jobs/${a.id}/close`, { method: 'POST', body: { reason: a.reason } }), { invalidate: ['jobs'] });
  const feature = useAdminAction((a: { id: string; featured: boolean }) => api(`/admin/jobs/${a.id}/feature`, { method: 'POST', body: { featured: a.featured } }), { invalidate: ['jobs'] });
  const reset = (fn: () => void) => { fn(); setPageNo(1); };
  const p = jobs.data?.problems;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['jobs', 'applications'] as const).map((v) => (
          <Button key={v} size="sm" variant={view === v ? 'accent' : 'outline'} onClick={() => reset(() => { setView(v); setStatus(''); setFlag(''); })}>{v === 'jobs' ? 'Jobs' : 'Applications'}</Button>
        ))}
      </div>
      {view === 'jobs' && p && (
        <div className="grid gap-3 sm:grid-cols-3">
          {(['expired', 'noApplicants', 'held'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={flag === f} onClick={() => reset(() => setFlag(flag === f ? '' : f))}
              className={`rounded-xl border p-4 text-left ${flag === f ? 'border-accent bg-accent-soft' : 'border-border bg-surface'}`}>
              <p className={`text-2xl font-extrabold ${p[f] > 0 ? 'text-warning' : ''}`}>{p[f]}</p>
              <p className="text-xs text-muted">{FLAG_LABEL[f]}</p>
            </button>
          ))}
        </div>
      )}
      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <TextField label={view === 'jobs' ? 'Search title or organization' : 'Search job, organization or worker'} value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        <label className="text-sm font-medium">Status
          <select className={`${select} mt-1.5 w-full`} value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
            <option value="">Any</option>
            {(view === 'jobs' ? JOB_STATUSES : APP_STATUSES).map((s) => <option key={s} value={s}>{s.toLowerCase().replace('_', ' ')}</option>)}
          </select>
        </label>
      </Card>
      <ErrorLine text={close.error ?? feature.error} />

      {view === 'jobs' && (
        <>
          {jobs.isLoading && <Skeleton className="h-64" />}
          {jobs.isError && <Alert tone="danger">Could not load jobs.</Alert>}
          {jobs.data && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead><tr className="border-b border-border text-muted"><th className="p-3">Job</th><th className="p-3">Status</th><th className="p-3">Applications</th><th className="p-3">Dates</th><th className="p-3" /></tr></thead>
                <tbody>
                  {jobs.data.items.map((j) => (
                    <tr key={j.id} className="border-b border-border align-top last:border-0">
                      <td className="p-3">
                        <Link to={`/jobs/${j.id}`} className="font-medium text-accent hover:underline">{j.title}</Link>
                        <p className="text-xs text-muted">{j.organization.name}{j.organization.verificationStatus === 'VERIFIED' ? ' ✓' : ''}</p>
                        <div className="mt-1 flex flex-wrap gap-1">{j.flags.map((f) => <Badge key={f} tone="warning">{FLAG_LABEL[f]}</Badge>)}{j.featured && <Badge tone="info">featured</Badge>}</div>
                      </td>
                      <td className="p-3"><Badge tone={j.status === 'ACTIVE' ? 'success' : 'neutral'}>{j.status.toLowerCase().replace('_', ' ')}</Badge></td>
                      <td className="p-3">{j.applications}</td>
                      <td className="p-3 text-xs">posted {when(j.createdAt)}<br />deadline {when(j.deadline)}</td>
                      <td className="p-3">
                        {closing === j.id ? (
                          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); close.mutate({ id: j.id, reason }, { onSuccess: () => { setClosing(null); setReason(''); } }); }}>
                            <input aria-label="Reason" className="h-9 w-44 rounded-lg border border-border bg-surface px-2 text-sm" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                            <Button size="sm" variant="outline" type="submit" disabled={reason.trim().length < 3} loading={close.isPending}>Close job</Button>
                            <Button size="sm" variant="ghost" type="button" onClick={() => setClosing(null)}>Cancel</Button>
                          </form>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {j.status === 'ACTIVE' && <Button size="sm" variant="outline" loading={feature.isPending} onClick={() => feature.mutate({ id: j.id, featured: !j.featured })}>{j.featured ? 'Unfeature' : 'Feature'}</Button>}
                            {(j.status === 'ACTIVE' || j.status === 'PENDING_REVIEW') && <Button size="sm" variant="ghost" className="text-danger" onClick={() => { close.clearError(); setClosing(j.id); }}>Close</Button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {jobs.data.items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">No jobs match.</td></tr>}
                </tbody>
              </table>
            </Card>
          )}
          {jobs.data && <Pager page={pageNo} total={jobs.data.total} pageSize={jobs.data.pageSize} set={setPageNo} noun="jobs" />}
        </>
      )}

      {view === 'applications' && (
        <>
          {apps.isLoading && <Skeleton className="h-64" />}
          {apps.isError && <Alert tone="danger">Could not load applications.</Alert>}
          {apps.data && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead><tr className="border-b border-border text-muted"><th className="p-3">Worker</th><th className="p-3">Job</th><th className="p-3">Status</th><th className="p-3">Applied</th></tr></thead>
                <tbody>
                  {apps.data.items.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="p-3"><Link to={`/admin/users/${a.worker.userId}`} className="font-medium text-accent hover:underline">{a.worker.name}</Link></td>
                      <td className="p-3">{a.job.title}<p className="text-xs text-muted">{a.job.organization}</p></td>
                      <td className="p-3"><Badge tone="neutral">{a.status.toLowerCase().replace('_', ' ')}</Badge></td>
                      <td className="p-3 text-xs">{when(a.createdAt)}</td>
                    </tr>
                  ))}
                  {apps.data.items.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">No applications match.</td></tr>}
                </tbody>
              </table>
            </Card>
          )}
          {apps.data && <Pager page={pageNo} total={apps.data.total} pageSize={apps.data.pageSize} set={setPageNo} noun="applications" />}
        </>
      )}
    </div>
  );
}

// ───────── One user ─────────

interface UserDetail {
  user: { id: string; fullName: string; phone: string; email: string | null; role: string; status: string; locale: string; createdAt: string; lastLoginAt: string | null; phoneVerified: boolean; emailVerified: boolean; mustChangePassword: boolean; twoFactorEnabled: boolean };
  activeSessions: number;
  worker: { completionPct: number; visible: boolean; profileViews: number; skills: number; jobsListed: number; applications: number; applicationsByStatus: Record<string, number> } | null;
  employer: { organization: { id: string; name: string; type: string; verificationStatus: string }; jobs: number; activeJobs: number } | null;
  reportsAgainst: { id: string; reason: string; status: string; createdAt: string }[];
  reportsFiled: number;
  verifications: { id: string; kind: string; status: string; createdAt: string }[];
  activity: { id: string; action: string; actorId: string | null; createdAt: string }[];
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="font-medium">{children}</dd></div>;
}

/** One account: what they do on the platform, reports and checks, and account actions that always ask for a reason. */
export function AdminUserDetail() {
  const { id } = useParams();
  const q = useAdminQuery<UserDetail>(['user', id ?? ''], `/users/${id}`, !!id);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const act = useAdminAction(
    (a: { path: string; method: 'POST' | 'PATCH'; body: Record<string, unknown>; done: string }) => api(`/admin/users/${id}${a.path}`, { method: a.method, body: { ...a.body, reason } }).then(() => a.done),
    { invalidate: ['user', 'users'] },
  );
  const doIt = (a: { path: string; method: 'POST' | 'PATCH'; body: Record<string, unknown>; done: string }) => {
    setNotice(null);
    act.mutate(a, { onSuccess: () => { setNotice(a.done); setReason(''); } });
  };
  const d = q.data;
  const u = d?.user;
  const canAct = !!u && u.role !== 'ADMIN' && u.status !== 'DELETED';
  const needsReason = reason.trim().length < 3;

  return (
    <div className="space-y-5">
      <Link to="/admin/users" className="text-sm font-semibold text-accent hover:underline">Back to users</Link>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.isError && <Alert tone="danger">Could not load this user.</Alert>}
      {d && u && (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">{u.fullName}</h2>
              <Badge tone="neutral">{u.role.toLowerCase()}</Badge>
              <Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>{u.status.toLowerCase()}</Badge>
              {u.mustChangePassword && <Badge tone="warning">must change password</Badge>}
            </div>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
              <Fact label="Phone">{u.phone} {u.phoneVerified ? '✓ verified' : '(not verified)'}</Fact>
              <Fact label="E-mail">{u.email ?? '–'} {u.email ? (u.emailVerified ? '✓ verified' : '(not verified)') : ''}</Fact>
              <Fact label="Language">{u.locale}</Fact>
              <Fact label="Joined">{when(u.createdAt)}</Fact>
              <Fact label="Last login">{when(u.lastLoginAt)}</Fact>
              <Fact label="Signed in on">{d.activeSessions} device{d.activeSessions === 1 ? '' : 's'}{u.twoFactorEnabled ? ' · two-factor on' : ''}</Fact>
            </dl>
          </Card>

          {d.worker && (
            <Card className="p-5">
              <h3 className="font-semibold">Worker</h3>
              <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-4">
                <Fact label="Profile complete">{d.worker.completionPct}%</Fact>
                <Fact label="Skills">{d.worker.skills}</Fact>
                <Fact label="Jobs listed">{d.worker.jobsListed}</Fact>
                <Fact label="Visible to employers">{d.worker.visible ? 'yes' : 'no'}</Fact>
                <Fact label="Applications">{d.worker.applications}</Fact>
                <Fact label="Profile views">{d.worker.profileViews}</Fact>
              </dl>
              {Object.keys(d.worker.applicationsByStatus).length > 0 && (
                <p className="mt-3 flex flex-wrap gap-2 text-xs">{Object.entries(d.worker.applicationsByStatus).map(([s, n]) => <Badge key={s} tone="neutral">{s.toLowerCase().replace('_', ' ')}: {n}</Badge>)}</p>
              )}
            </Card>
          )}
          {d.employer && (
            <Card className="p-5">
              <h3 className="font-semibold">Employer</h3>
              <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-4">
                <Fact label="Organization">{d.employer.organization.name}</Fact>
                <Fact label="Type">{d.employer.organization.type.toLowerCase().replace(/_/g, ' ')}</Fact>
                <Fact label="Verification">{d.employer.organization.verificationStatus.toLowerCase()}</Fact>
                <Fact label="Jobs (live)">{d.employer.jobs} ({d.employer.activeJobs})</Fact>
              </dl>
            </Card>
          )}

          <Card className="p-5">
            <h3 className="font-semibold">Reports and checks</h3>
            <p className="mt-1 text-sm text-muted">{d.reportsAgainst.length} report{d.reportsAgainst.length === 1 ? '' : 's'} about this person · {d.reportsFiled} filed by them</p>
            {d.reportsAgainst.length > 0 && (
              <ul className="mt-2 divide-y divide-border text-sm">
                {d.reportsAgainst.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-3 py-2"><Badge tone="neutral">{r.status.toLowerCase().replace('_', ' ')}</Badge><span className="flex-1">{r.reason}</span><span className="text-xs text-muted">{when(r.createdAt)}</span></li>)}
              </ul>
            )}
            {d.verifications.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2 text-xs">{d.verifications.map((v) => <Badge key={v.id} tone={v.status === 'APPROVED' ? 'success' : 'neutral'}>{v.kind.toLowerCase()} {v.status.toLowerCase()}</Badge>)}</ul>
            )}
          </Card>

          {canAct && (
            <Card className="p-5">
              <h3 className="font-semibold">Account actions</h3>
              <p className="mt-1 text-sm text-muted">Every action needs a short reason and is written to the activity log. Administrator accounts cannot be changed here.</p>
              <div className="mt-3 max-w-lg"><TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {u.status === 'ACTIVE'
                  ? <Button variant="outline" className="text-danger" disabled={needsReason} loading={act.isPending} onClick={() => doIt({ path: '/status', method: 'PATCH', body: { status: 'SUSPENDED' }, done: 'Account suspended.' })}>Suspend</Button>
                  : <Button variant="outline" disabled={needsReason} loading={act.isPending} onClick={() => doIt({ path: '/status', method: 'PATCH', body: { status: 'ACTIVE' }, done: 'Account reactivated.' })}>Reactivate</Button>}
                <Button variant="outline" disabled={needsReason} loading={act.isPending} onClick={() => doIt({ path: '/force-password-reset', method: 'POST', body: {}, done: 'They will have to choose a new password, and all their sessions ended.' })}>Force password reset</Button>
                <Button variant="outline" disabled={needsReason} loading={act.isPending} onClick={() => doIt({ path: '/contact-verification', method: 'POST', body: { kind: 'PHONE', verified: !u.phoneVerified }, done: u.phoneVerified ? 'Phone marked as not verified.' : 'Phone marked as verified.' })}>{u.phoneVerified ? 'Unverify phone' : 'Verify phone'}</Button>
                {u.email && <Button variant="outline" disabled={needsReason} loading={act.isPending} onClick={() => doIt({ path: '/contact-verification', method: 'POST', body: { kind: 'EMAIL', verified: !u.emailVerified }, done: u.emailVerified ? 'E-mail marked as not verified.' : 'E-mail marked as verified.' })}>{u.emailVerified ? 'Unverify e-mail' : 'Verify e-mail'}</Button>}
              </div>
              <ErrorLine text={act.error} />
              {notice && <p role="status" className="mt-2 text-sm text-success">{notice}</p>}
            </Card>
          )}

          <Card className="p-5">
            <h3 className="font-semibold">Recent activity</h3>
            {d.activity.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing recorded.</p> : (
              <ul className="mt-2 divide-y divide-border text-sm">
                {d.activity.map((a) => <li key={a.id} className="flex justify-between gap-3 py-1.5"><span>{a.action}{a.actorId && a.actorId !== u.id ? ' (by someone else)' : ''}</span><span className="text-xs text-muted">{when(a.createdAt)}</span></li>)}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ───────── Settings and health ─────────

interface Settings { maintenanceEnabled: boolean; maintenanceMessage: string; registrationOpen: boolean; dailyApplicationLimit: number }
interface Health {
  database: { ok: boolean; latencyMs: number | null }; aiService: { configured: boolean; reachable: boolean | null };
  channels: { sms: boolean; email: boolean; telegram: boolean; antivirus: boolean };
  queues: { expired: number; noApplicants: number; held: number; pendingVerifications: number; openReports: number };
  runtime: { node: string; uptimeSeconds: number; memoryMb: number; environment: string };
}
const onOff = (v: boolean, on: string, off: string) => <Badge tone={v ? 'success' : 'neutral'}>{v ? on : off}</Badge>;

/** Switches that take effect straight away, and a health check of everything the platform depends on. */
export function AdminSettings() {
  const q = useAdminQuery<{ settings: Settings }>(['settings'], '/settings');
  const health = useAdminQuery<Health>(['health'], '/health');
  const [draft, setDraft] = useState<Settings | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const s = draft ?? q.data?.settings;
  const save = useAdminAction((body: Partial<Settings>) => api('/admin/settings', { method: 'PATCH', body }), { invalidate: ['settings'] });

  return (
    <div className="space-y-5">
      {q.isLoading && <Skeleton className="h-48" />}
      {q.isError && <Alert tone="danger">Could not load the settings.</Alert>}
      {s && (
        <Card className="p-5">
          <h2 className="font-semibold">Platform settings</h2>
          <p className="mt-1 text-sm text-muted">Changes apply at once and are written to the activity log. Other server processes may take up to 10 seconds to notice.</p>
          <form
            noValidate
            className="mt-4 space-y-4"
            onSubmit={(e) => { e.preventDefault(); setDone(null); save.mutate(s, { onSuccess: () => { setDone('Saved.'); setDraft(null); } }); }}
          >
            <fieldset className="rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Maintenance mode</legend>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.maintenanceEnabled} onChange={(e) => setDraft({ ...s, maintenanceEnabled: e.target.checked })} /> Turn the site off for everyone except administrators</label>
              <p className="mt-1 text-xs text-muted">Sign-in and this admin area keep working. Everyone else sees the message below and cannot use the site.</p>
              <div className="mt-3 max-w-xl"><TextField label="Message shown to visitors" maxLength={300} value={s.maintenanceMessage} onChange={(e) => setDraft({ ...s, maintenanceMessage: e.target.value })} /></div>
              {s.maintenanceEnabled && <div className="mt-3"><Alert tone="warning">Maintenance mode will be on as soon as you save. Check the message first.</Alert></div>}
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.registrationOpen} onChange={(e) => setDraft({ ...s, registrationOpen: e.target.checked })} /> New people can register</label>
            <div className="max-w-xs">
              <TextField label="Applications one worker can send per day" inputMode="numeric" value={String(s.dailyApplicationLimit)}
                onChange={(e) => setDraft({ ...s, dailyApplicationLimit: Number(e.target.value.replace(/\D/g, '')) || 0 })} hint="1 to 200" />
            </div>
            <div>
              <Button type="submit" loading={save.isPending} disabled={!draft || s.dailyApplicationLimit < 1 || s.dailyApplicationLimit > 200}>Save settings</Button>
              <ErrorLine text={save.error} />
              {done && <p role="status" className="mt-2 text-sm text-success">{done}</p>}
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Health</h2>
          <Button size="sm" variant="outline" loading={health.isFetching} onClick={() => health.refetch()}>Check again</Button>
        </div>
        {health.isLoading && <Skeleton className="mt-3 h-24" />}
        {health.isError && <Alert tone="danger">Could not run the health check.</Alert>}
        {health.data && (
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li>Database: <Badge tone={health.data.database.ok ? 'success' : 'danger'}>{health.data.database.ok ? `OK, ${health.data.database.latencyMs} ms` : 'Down'}</Badge></li>
            <li>AI service: {health.data.aiService.configured ? <Badge tone={health.data.aiService.reachable ? 'success' : 'danger'}>{health.data.aiService.reachable ? 'Reachable' : 'Configured but not answering'}</Badge> : <Badge tone="neutral">Not connected: rules only</Badge>}</li>
            <li>SMS: {onOff(health.data.channels.sms, 'Configured', 'Not configured: none sent')}</li>
            <li>E-mail: {onOff(health.data.channels.email, 'Configured', 'Not configured: none sent')}</li>
            <li>Telegram alerts: {onOff(health.data.channels.telegram, 'Configured', 'Not configured')}</li>
            <li>Upload virus scan: {onOff(health.data.channels.antivirus, 'ClamAV on', 'Off: file type check only')}</li>
            <li>Waiting for a moderator: {health.data.queues.held} jobs, {health.data.queues.pendingVerifications} verifications, {health.data.queues.openReports} reports</li>
            <li>Job problems: {health.data.queues.expired} past deadline, {health.data.queues.noApplicants} with no applicants</li>
            <li>Server: Node {health.data.runtime.node}, {health.data.runtime.environment}, up {Math.round(health.data.runtime.uptimeSeconds / 60)} min, {health.data.runtime.memoryMb} MB</li>
          </ul>
        )}
      </Card>
    </div>
  );
}
