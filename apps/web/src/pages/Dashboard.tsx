import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Bell, ShieldAlert } from 'lucide-react';
import { Alert, Badge, Card, Skeleton, TextField } from '@/components/ui/primitives';
import { notificationText, useNotifications, useSummary, type AppStatus } from '@/lib/applications';
import { useWorkerProfile } from '@/lib/profile';
import { useRecommendedJobs } from '@/lib/matching';
import { useDeclineInvitation, useMyInvitations } from '@/lib/talent';
import { openInvitationConversation } from '@/lib/messaging';
import { useNotificationSettings, type NotificationSettings } from '@/lib/messaging';
import { MatchBadge } from '@/components/MatchPanel';
import { timeAgo } from '@/lib/format';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useAuth } from '@/app/auth';
import { useI18n } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { DocumentsSummary } from '@/components/DocumentsSummary';

function PhoneVerification() {
  const { t } = useI18n();
  const { user, reload } = useAuth();
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  if (user.phoneVerified) {
    return (
      <Alert tone="success">
        <span className="inline-flex items-center gap-2"><BadgeCheck className="h-4 w-4" aria-hidden />{t('dash.verify.done')}</span>
      </Alert>
    );
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
        <div className="flex-1">
          <h2 className="font-semibold">{t('dash.verify.title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('dash.verify.body')}</p>

          {!sent ? (
            <Button
              className="mt-4"
              variant="accent"
              size="sm"
              loading={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ devCode?: string }>('/auth/verify/request', { method: 'POST', body: { kind: 'PHONE' } });
                  setDevCode(r.devCode ?? null);
                  setSent(true);
                })
              }
            >
              {t('dash.verify.send')}
            </Button>
          ) : (
            <form
              className="mt-4 flex max-w-sm items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api('/auth/verify/confirm', { method: 'POST', body: { kind: 'PHONE', code } });
                  await reload();
                });
              }}
            >
              <div className="flex-1">
                <TextField label="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <Button type="submit" variant="accent" loading={busy}>{t('dash.verify.confirm')}</Button>
            </form>
          )}

          {devCode && (
            <p className="mt-3 rounded-lg bg-warning-soft p-3 text-sm text-warning">
              {t('dash.verify.devNotice')} <strong className="ml-1 tracking-widest">{devCode}</strong>
            </p>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </div>
      </div>
    </Card>
  );
}

function Tile({ label, value, to }: { label: string; value: number; to?: string }) {
  const body = (
    <div className="rounded-xl border border-border bg-surface p-4 text-center">
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
  return to ? <Link to={to} className="block hover:[&>div]:border-accent">{body}</Link> : body;
}

/** Invitations from employers. An invitation is not an application: nothing about you is shared until you apply. */
function InvitationsCard() {
  const q = useMyInvitations();
  const decline = useDeclineInvitation();
  const navigate = useNavigate();
  const [chatError, setChatError] = useState<string | null>(null);
  async function ask(invitationId: string) {
    setChatError(null);
    try {
      navigate(`/messages/${await openInvitationConversation(invitationId)}`);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Could not open the conversation.');
    }
  }
  const open = (q.data ?? []).filter((i) => i.status === 'SENT');
  if (!q.data || open.length === 0) return null;
  return (
    <Card className="border-accent p-6">
      <h2 className="font-semibold">Invitations to apply <Badge tone="accent">{open.length}</Badge></h2>
      <p className="mt-1 text-xs text-muted">An employer thinks you fit. Nothing about you is shared with them unless you apply. You can ask a question first; they can only answer once you do.</p>
      {chatError && <p role="alert" className="mt-2 text-sm text-danger">{chatError}</p>}
      <ul className="mt-3 divide-y divide-border">
        {open.map((i) => (
          <li key={i.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <Link to={`/jobs/${i.job.id}`} className="font-medium hover:text-accent">{i.job.title}</Link>
                <p className="text-sm text-muted">{i.job.organization}{i.job.verified ? ' · verified employer' : ''}{i.job.location ? ` · ${i.job.location}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {i.job.open ? <LinkButton to={`/jobs/${i.job.id}`} size="sm" variant="accent">View and apply</LinkButton> : <Badge tone="warning">Job closed</Badge>}
                {i.job.open && <Button size="sm" variant="outline" onClick={() => ask(i.id)}>{i.conversationId ? 'Open chat' : 'Ask a question'}</Button>}
                <Button size="sm" variant="ghost" loading={decline.isPending && decline.variables === i.id} onClick={() => decline.mutate(i.id)}>Decline</Button>
              </div>
            </div>
            {i.message && <p className="mt-2 rounded-xl bg-surface-2 p-2.5 text-sm">{i.message}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecommendedPreview() {
  const q = useRecommendedJobs(3);
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Recommended jobs</h2>
        <LinkButton to="/recommended" variant="outline" size="sm">See all</LinkButton>
      </div>
      {q.isLoading && <Skeleton className="mt-3 h-24" />}
      {q.data?.reason === 'no_profile_data' && <p className="mt-3 text-sm text-muted">Add your skills on your profile to get personalized job recommendations.</p>}
      {q.data?.reason === 'ok' && q.data.items.length === 0 && <p className="mt-3 text-sm text-muted">No matching jobs right now. New jobs are matched as they are posted.</p>}
      <ul className="mt-3 divide-y divide-border">
        {q.data?.items.map(({ job, match }) => (
          <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <Link to={`/jobs/${job.id}`} className="font-medium hover:text-accent">{job.title}</Link>
              <p className="text-sm text-muted">{job.organization.name}</p>
            </div>
            <MatchBadge match={match} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NotificationSettingsCard({ role }: { role: 'WORKER' | 'EMPLOYER' }) {
  const q = useNotificationSettings();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: Partial<NotificationSettings>) => api<NotificationSettings>('/notifications/settings', { method: 'PATCH', body }),
    onSuccess: (d) => { setError(null); qc.setQueryData(['notification-settings'], d); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save. Try again.'),
  });
  const [linkSent, setLinkSent] = useState(false);
  const connect = useMutation({
    mutationFn: () => api<{ url: string; expiresAt: string }>('/notifications/telegram/link', { method: 'POST' }),
    onSuccess: (d) => {
      setError(null);
      setLinkSent(true);
      window.open(d.url, '_blank', 'noopener,noreferrer'); // opens Telegram; the person presses Start there
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not start the connection. Try again.'),
  });
  const disconnect = useMutation({
    mutationFn: () => api('/notifications/telegram', { method: 'DELETE' }),
    onSuccess: () => { setError(null); setLinkSent(false); qc.invalidateQueries({ queryKey: ['notification-settings'] }); },
    onError: () => setError('Could not disconnect. Try again.'),
  });
  const s = q.data;
  return (
    <Card className="p-6">
      <h2 className="font-semibold">Notification settings</h2>
      {q.isLoading && <Skeleton className="mt-3 h-16" />}
      {s && (
        <div className="mt-3 space-y-4 text-sm">
          {role === 'WORKER' && (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={s.notifyJobMatches} disabled={save.isPending} onChange={(e) => save.mutate({ notifyJobMatches: e.target.checked })} />
              <span>Tell me when a new job fits me well<span className="block text-xs text-muted">At most 3 alerts a day, only for strong matches.</span></span>
            </label>
          )}
          {role === 'WORKER' && (
            <div className="rounded-xl border border-border p-3">
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={s.autoApply} disabled={save.isPending} onChange={(e) => save.mutate({ autoApply: e.target.checked })} />
                <span>Apply for me automatically when a new job matches me strongly
                  <span className="block text-xs text-muted">Off unless you turn it on. Your profile is then sent to the employer without you pressing Apply, so only use it if you are happy to be considered for any job that matches. Marked "applied automatically"; you can withdraw any time. At most 5 a day.</span>
                </span>
              </label>
              {s.autoApply && (
                <label className="mt-3 flex items-center gap-3 pl-7">
                  <span>Only if my match is at least</span>
                  <select className="h-9 rounded-lg border border-border bg-surface px-2" value={s.autoApplyMinScore} disabled={save.isPending} onChange={(e) => save.mutate({ autoApplyMinScore: Number(e.target.value) })}>
                    {[60, 70, 80, 90].map((n) => <option key={n} value={n}>{n}%</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={s.notifySms} disabled={save.isPending || !s.phoneVerified} onChange={(e) => save.mutate({ notifySms: e.target.checked })} />
            <span>
              Send me an SMS for interviews and important application updates
              <span className="block text-xs text-muted">Generic texts only, at most 5 a day. {!s.phoneVerified && 'Verify your phone number above first. '}</span>
              {!s.smsProviderConfigured && <span className="mt-1 block text-xs text-warning">SMS delivery is not set up on this system yet, so no text messages are sent. You will still see everything in the app.</span>}
            </span>
          </label>
          {role === 'WORKER' && (
            <div className="rounded-xl border border-border p-3">
              <p className="font-medium">Telegram alerts</p>
              <p className="mt-1 text-xs text-muted">Short, generic alerts in Telegram for new matching jobs, interviews, offers and important application updates. At most 10 a day. They never contain text written by other people.</p>
              {!s.telegramConfigured && <p className="mt-2 text-xs text-warning">Telegram alerts are not set up on this system yet.</p>}
              {s.telegramConfigured && s.telegramLinked && (
                <div className="mt-3 space-y-2">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={s.notifyTelegram} disabled={save.isPending} onChange={(e) => save.mutate({ notifyTelegram: e.target.checked })} />
                    <span>Send me alerts on Telegram</span>
                  </label>
                  <Button variant="outline" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect Telegram</Button>
                </div>
              )}
              {s.telegramConfigured && !s.telegramLinked && (
                <div className="mt-3 space-y-2">
                  <Button variant="outline" size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>Connect Telegram</Button>
                  {linkSent && <p className="text-xs text-muted" role="status">Telegram should have opened. Press <strong>Start</strong> there within 15 minutes, then come back to this page. You can also send /stop to the bot any time to turn alerts off.</p>}
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-danger">{error}</p>}
        </div>
      )}
    </Card>
  );
}

function Overview({ role }: { role: 'WORKER' | 'EMPLOYER' }) {
  const summary = useSummary();
  const notes = useNotifications();
  const qc = useQueryClient();
  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const s = summary.data;
  const count = (k: AppStatus) => s?.applications[k] ?? 0;
  const total = s ? Object.values(s.applications).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <>
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{role === 'WORKER' ? 'Your applications' : 'Recruitment overview'}</h2>
          <div className="flex flex-wrap gap-2">
            {role === 'WORKER' ? (
              <>
                <LinkButton to="/applications" variant="outline" size="sm">Track applications</LinkButton>
                <LinkButton to="/saved" variant="outline" size="sm">Saved jobs</LinkButton>
                <LinkButton to="/jobs" variant="accent" size="sm">Browse jobs</LinkButton>
                <LinkButton to="/my-services" variant="outline" size="sm">My services</LinkButton>
              </>
            ) : (
              <>
                <LinkButton to="/employer/jobs" variant="accent" size="sm">Manage jobs</LinkButton>
                <LinkButton to="/services" variant="outline" size="sm">Find a service</LinkButton>
              </>
            )}
            <LinkButton to="/service-requests" variant="outline" size="sm">Service requests</LinkButton>
          </div>
        </div>
        {summary.isLoading && <Skeleton className="mt-4 h-20" />}
        {summary.isError && <p className="mt-3 text-sm text-danger">Could not load your numbers.</p>}
        {s && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {role === 'EMPLOYER' && <Tile label="Live jobs" value={s.activeJobs ?? 0} to="/employer/jobs" />}
            <Tile label={role === 'WORKER' ? 'Applications' : 'Applications received'} value={total} to={role === 'WORKER' ? '/applications' : '/employer/jobs'} />
            <Tile label={role === 'WORKER' ? 'Under review' : 'Pending'} value={role === 'WORKER' ? count('UNDER_REVIEW') : count('PENDING')} />
            <Tile label="Shortlisted" value={count('SHORTLISTED') + count('INTERVIEW_SCHEDULED')} />
            <Tile label="Upcoming interviews" value={s.upcomingInterviews} />
            <Tile label="Accepted" value={count('ACCEPTED')} />
            {role === 'WORKER' && <Tile label="Saved jobs" value={s.saved ?? 0} to="/saved" />}
          </div>
        )}
      </Card>

      {role === 'WORKER' && <InvitationsCard />}
      {role === 'WORKER' && <RecommendedPreview />}

      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold"><Bell className="h-4 w-4" aria-hidden />Updates {!!notes.data?.unread && <Badge tone="accent">{notes.data.unread} new</Badge>}</h2>
          {!!notes.data?.unread && <Button variant="ghost" size="sm" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all as read</Button>}
        </div>
        {notes.isLoading && <Skeleton className="mt-3 h-16" />}
        {notes.data?.items.length === 0 && <p className="mt-3 text-sm text-muted">Nothing yet. Updates about applications and interviews will show here.</p>}
        <ul className="mt-3 divide-y divide-border">
          {notes.data?.items.slice(0, 8).map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <span className={n.readAt ? 'text-muted' : 'font-medium'}>{notificationText(n)}</span>
              <span className="shrink-0 text-xs text-muted">{timeAgo(n.createdAt)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Live push notifications and SMS are planned for a later phase; for now updates appear when you open the app.</p>
      </Card>
    </>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  // Same cached query as the profile page, so the number always matches what the user sees there.
  const profile = useWorkerProfile({ enabled: user?.role === 'WORKER' });
  if (!user) return null;
  const roleLabel = { WORKER: 'Job seeker', EMPLOYER: 'Employer', ADMIN: 'Administrator', TRAINER: 'Training institution' }[user.role];

  return (
    <>
      <PageHeader title={`${t('dash.welcome')}, ${user.fullName}`} subtitle={t('dash.title')} />
      <PageBody narrow>
        <div className="space-y-5">
          {(user.role === 'WORKER' || user.role === 'EMPLOYER') && <DocumentsSummary />}
          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{roleLabel}</Badge>
              {user.organization && (
                <Badge tone={user.organization.verificationStatus === 'VERIFIED' ? 'success' : 'neutral'}>
                  {user.organization.name} · {user.organization.verificationStatus === 'VERIFIED' ? 'Verified' : 'Not verified'}
                </Badge>
              )}
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Phone</dt><dd className="font-medium">{user.phone}</dd></div>
              <div><dt className="text-muted">Email</dt><dd className="font-medium">{user.email ?? '–'}</dd></div>
            </dl>
          </Card>
          <PhoneVerification />
          {(user.role === 'WORKER' || user.role === 'EMPLOYER') && (
            <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
              <div>
                <h2 className="font-semibold">{user.role === 'WORKER' ? 'Build your profile' : 'Set up your organization'}</h2>
                <p className="mt-1 text-sm text-muted">
                  {user.role === 'WORKER'
                    ? profile.data ? `Profile completion: ${profile.data.completion.pct}%` : 'Profile completion: …'
                    : 'Add details and request the verified badge.'}
                </p>
              </div>
              <LinkButton to={user.role === 'WORKER' ? '/profile' : '/organization'} variant="accent">
                {user.role === 'WORKER' ? 'Edit profile' : 'Edit organization'}
              </LinkButton>
            </Card>
          )}
          {(user.role === 'WORKER' || user.role === 'EMPLOYER') && <Overview role={user.role} />}
          {(user.role === 'WORKER' || user.role === 'EMPLOYER') && <NotificationSettingsCard role={user.role} />}
          <Card className="p-6">
            <h2 className="font-semibold">{t('dash.next.title')}</h2>
            <p className="mt-1 text-sm text-muted">Smarter matching that understands similar job titles, CV analysis and live messaging are planned for the next phases.</p>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
