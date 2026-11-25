import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Card, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { downloadProtected, useAdminAction, useAdminQuery } from '@/lib/admin';
import { api } from '@/lib/api';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const select = 'h-9 rounded-lg border border-border bg-surface px-2 text-sm';
const ErrorLine = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-2 text-sm text-danger">{text}</p> : null);

function Pager({ page, total, pageSize, set }: { page: number; total: number; pageSize: number; set: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => set(page - 1)}>Previous</Button>
      <span className="text-muted">Page {page} of {pages} · {total} in total</span>
      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => set(page + 1)}>Next</Button>
    </div>
  );
}

// ───────── Support inbox ─────────

interface SupportItem { id: string; name: string; email: string; message: string; status: 'OPEN' | 'RESOLVED'; adminNote: string | null; resolvedAt: string | null; createdAt: string }

export function AdminSupport() {
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const qs = new URLSearchParams({ ...(status ? { status } : {}), page: String(page) }).toString();
  const list = useAdminQuery<{ total: number; open: number; page: number; pageSize: number; items: SupportItem[] }>(['support', qs], `/support?${qs}`);
  const act = useAdminAction((a: { id: string; status: 'OPEN' | 'RESOLVED' }) => api(`/admin/support/${a.id}`, { method: 'PATCH', body: { status: a.status, ...(notes[a.id]?.trim() ? { adminNote: notes[a.id].trim() } : {}) } }));
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-muted">Messages sent from the public contact form. Reply by email to the address given. {list.data && <strong className="text-text">{list.data.open} open.</strong>}</p>
        <label className="text-sm font-medium">Show <select className={`${select} ml-2`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="">All</option></select></label>
      </Card>
      {list.isLoading && <Skeleton className="h-48" />}
      {list.isError && <Alert tone="danger">Could not load the inbox.</Alert>}
      <ErrorLine text={act.error} />
      {list.data?.items.map((m) => (
        <Card key={m.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{m.name} <a className="text-sm font-normal text-accent hover:underline" href={`mailto:${m.email}`}>{m.email}</a></p>
            <span className="flex items-center gap-2 text-xs text-muted"><Badge tone={m.status === 'OPEN' ? 'warning' : 'success'}>{m.status.toLowerCase()}</Badge>{when(m.createdAt)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{m.message}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1"><TextField label="Note (optional)" value={notes[m.id] ?? m.adminNote ?? ''} onChange={(e) => setNotes({ ...notes, [m.id]: e.target.value })} /></div>
            {m.status === 'OPEN'
              ? <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ id: m.id, status: 'RESOLVED' })}>Mark resolved</Button>
              : <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate({ id: m.id, status: 'OPEN' })}>Reopen</Button>}
          </div>
        </Card>
      ))}
      {list.data && list.data.items.length === 0 && <Card className="p-6 text-center text-sm text-muted">No messages.</Card>}
      {list.data && <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} set={setPage} />}
    </div>
  );
}

// ───────── Delivery log ─────────

interface DeliveryItem { id: string; channel: 'SMS' | 'EMAIL'; recipient: string; subject: string | null; status: 'SENT' | 'FAILED' | 'NOT_SENT'; error: string | null; createdAt: string }
const tone = { SENT: 'success', FAILED: 'danger', NOT_SENT: 'neutral' } as const;

export function AdminDeliveries() {
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(channel ? { channel } : {}), page: String(page) }).toString();
  const list = useAdminQuery<{ total: number; pageSize: number; items: DeliveryItem[]; last7Days: Record<string, number> }>(['deliveries', qs], `/deliveries?${qs}`);
  const l7 = list.data?.last7Days ?? {};
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm text-muted">Every SMS and email the platform tried to send. Recipients are partly hidden and message text is never stored. “Not sent” means no provider is configured, so the message was only written to the server log.</p>
        <p className="mt-2 text-sm">Last 7 days: <Badge tone="success">{l7.SENT ?? 0} sent</Badge> <Badge tone="danger">{l7.FAILED ?? 0} failed</Badge> <Badge tone="neutral">{l7.NOT_SENT ?? 0} not sent</Badge></p>
        <div className="mt-3 flex gap-3">
          <label className="text-sm font-medium">Status <select className={`${select} ml-1`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="SENT">Sent</option><option value="FAILED">Failed</option><option value="NOT_SENT">Not sent</option></select></label>
          <label className="text-sm font-medium">Channel <select className={`${select} ml-1`} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}><option value="">All</option><option value="SMS">SMS</option><option value="EMAIL">Email</option></select></label>
        </div>
      </Card>
      {list.isLoading && <Skeleton className="h-48" />}
      {list.isError && <Alert tone="danger">Could not load the delivery log.</Alert>}
      {list.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="border-b border-border text-muted"><th className="p-3">When</th><th className="p-3">Channel</th><th className="p-3">To</th><th className="p-3">Subject</th><th className="p-3">Result</th></tr></thead>
            <tbody>
              {list.data.items.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0 align-top">
                  <td className="p-3 text-xs">{when(d.createdAt)}</td><td className="p-3">{d.channel.toLowerCase()}</td><td className="p-3 font-mono text-xs">{d.recipient}</td><td className="p-3 text-xs">{d.subject ?? '–'}</td>
                  <td className="p-3"><Badge tone={tone[d.status]}>{d.status.toLowerCase().replace('_', ' ')}</Badge>{d.error && <p className="mt-1 text-xs text-danger">{d.error}</p>}</td>
                </tr>
              ))}
              {list.data.items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">Nothing recorded yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {list.data && <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} set={setPage} />}
    </div>
  );
}

// ───────── Backups ─────────

interface BackupData { configured: boolean; directory: string; backups: { name: string; createdAt: string; sizeBytes: number; hasDatabaseDump: boolean; hasUploads: boolean; hasChecksums: boolean }[] }
const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

export function AdminBackups() {
  const q = useAdminQuery<BackupData>(['backups'], '/backups');
  const [now] = useState(() => Date.now());
  const newest = q.data?.backups[0];
  const ageDays = newest ? (now - new Date(newest.createdAt).getTime()) / 86_400_000 : null;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="font-semibold">Backups</h2>
        <p className="mt-1 text-sm text-muted">This page only shows what the backup script left on the server. Taking a backup is done on the server with <code>infra/backup/backup.sh</code> (run it from cron or a timer, and copy the result off the machine).</p>
        {q.isLoading && <Skeleton className="mt-3 h-16" />}
        {q.isError && <Alert tone="danger">Could not read the backup folder.</Alert>}
        {q.data && !q.data.configured && <Alert tone="warning">No backup folder was found at <code>{q.data.directory}</code>. Either no backup was ever taken here, or <code>BACKUP_DIR</code> points somewhere this server cannot see.</Alert>}
        {q.data?.configured && q.data.backups.length === 0 && <Alert tone="warning">The backup folder exists but holds no backups.</Alert>}
        {ageDays !== null && <p className="mt-3 text-sm">Newest backup: <strong>{when(newest!.createdAt)}</strong> <Badge tone={ageDays <= 2 ? 'success' : ageDays <= 7 ? 'warning' : 'danger'}>{ageDays < 1 ? 'today' : `${Math.floor(ageDays)} days ago`}</Badge></p>}
      </Card>
      {q.data && q.data.backups.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-border text-muted"><th className="p-3">Backup</th><th className="p-3">Size</th><th className="p-3">Database</th><th className="p-3">Uploads</th><th className="p-3">Checksums</th></tr></thead>
            <tbody>
              {q.data.backups.map((b) => (
                <tr key={b.name} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{b.name}</td><td className="p-3">{mb(b.sizeBytes)}</td>
                  {[b.hasDatabaseDump, b.hasUploads, b.hasChecksums].map((ok, i) => <td key={i} className="p-3"><Badge tone={ok ? 'success' : 'danger'}>{ok ? 'yes' : 'missing'}</Badge></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ───────── Privacy tools (on the user page) ─────────

export function PrivacyTools({ userId, name }: { userId: string; name: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const del = useAdminAction(() => api(`/admin/users/${userId}/delete`, { method: 'POST', body: { reason, actorPassword: password } }).then(() => navigate('/admin/users')));
  return (
    <Card className="p-5">
      <h3 className="font-semibold">Data and privacy</h3>
      <p className="mt-1 text-sm text-muted">For requests from the person themselves. Both actions are written to the activity log.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          loading={busy}
          onClick={async () => { setBusy(true); setErr(null); try { await downloadProtected(`/admin/export/user/${userId}`, `user-data-${userId.slice(0, 8)}.json`); } catch { setErr('Could not export (your level may not allow it).'); } setBusy(false); }}
        >Download their data (JSON)</Button>
        <Button variant="outline" className="text-danger" onClick={() => setConfirming(!confirming)}>Delete this account…</Button>
      </div>
      <ErrorLine text={err} />
      {confirming && (
        <div className="mt-4 max-w-lg space-y-3 rounded-xl border border-danger/40 p-4">
          <p className="text-sm">This permanently removes {name}’s profile, applications, files and sign-in. The account stays only as an anonymous “Deleted user” so other people’s records do not break. It cannot be undone.</p>
          <TextField label="Reason (for example “requested by the user”)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <TextField label="Your own password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="outline" className="text-danger" disabled={reason.trim().length < 3 || !password} loading={del.isPending} onClick={() => del.mutate()}>Delete permanently</Button>
          <ErrorLine text={del.error} />
        </div>
      )}
    </Card>
  );
}
