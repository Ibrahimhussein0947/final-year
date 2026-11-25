import { useState } from 'react';
import { Alert, Badge, Card, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAdminAction, useAdminQuery } from '@/lib/admin';
import { useAuth } from '@/app/auth';
import { api } from '@/lib/api';

type Level = 'FULL' | 'MODERATOR' | 'AUDITOR';
interface AdminMember { id: string; fullName: string; phone: string; status: 'ACTIVE' | 'SUSPENDED'; adminLevel: Level; createdAt: string; lastLoginAt: string | null }
const LEVELS: { value: Level; label: string; help: string }[] = [
  { value: 'FULL', label: 'Full administrator', help: 'Can do everything.' },
  { value: 'MODERATOR', label: 'Moderator', help: 'Handles reports, job reviews and verifications only.' },
  { value: 'AUDITOR', label: 'Auditor', help: 'Can look at everything but change nothing.' },
];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

/** Administrator accounts: who can control the system. Adding or suspending one asks for your own password again. */
export function AdminTeam() {
  const { user } = useAuth();
  const list = useAdminQuery<{ items: AdminMember[] }>(['admins'], '/admins');
  const [form, setForm] = useState<{ fullName: string; phone: string; password: string; level: Level }>({ fullName: '', phone: '', password: '', level: 'FULL' });
  const [myPassword, setMyPassword] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const create = useAdminAction(
    () => api('/admin/admins', { method: 'POST', body: { ...form, actorPassword: myPassword } }),
    { invalidate: ['admins'] },
  );
  const setLevel = useAdminAction(
    (a: { id: string; level: Level }) => api(`/admin/admins/${a.id}/level`, { method: 'PATCH', body: { level: a.level, actorPassword: myPassword } }),
    { invalidate: ['admins'] },
  );
  const change = useAdminAction(
    (a: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) => api(`/admin/admins/${a.id}/status`, { method: 'PATCH', body: { status: a.status, actorPassword: myPassword } }),
    { invalidate: ['admins'] },
  );

  return (
    <div className="space-y-5">
      <Alert tone="info">
        Administrators can see and change almost everything: users, verification, moderation, skills and categories, hiring rules, matching settings and the activity log.
        Keep the number small, give each person their own account, and never share a password. Every change here is written to the activity log.
      </Alert>

      <Card className="p-5">
        <h2 className="font-semibold">Your confirmation</h2>
        <p className="mt-1 text-sm text-muted">To add, suspend or change the level of an administrator, enter your own password.</p>
        <div className="mt-3 max-w-sm">
          <TextField label="Your password" type="password" autoComplete="current-password" value={myPassword} onChange={(e) => setMyPassword(e.target.value)} />
        </div>
      </Card>

      {list.isLoading && <Skeleton className="h-40" />}
      {list.isError && <Alert tone="danger">Could not load the administrator list.</Alert>}
      {change.error && <p role="alert" className="text-sm text-danger">{change.error}</p>}
      {setLevel.error && <p role="alert" className="text-sm text-danger">{setLevel.error}</p>}
      {list.data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead><tr className="border-b border-border text-muted"><th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">Level</th><th className="p-3">Last login</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">{a.fullName}{a.id === user?.id ? ' (you)' : ''}</td>
                  <td className="p-3">{a.phone}</td>
                  <td className="p-3">
                    {a.id === user?.id ? (
                      <Badge tone="info">{LEVELS.find((l) => l.value === a.adminLevel)?.label ?? a.adminLevel}</Badge>
                    ) : (
                      <select aria-label={`Level for ${a.fullName}`} className="rounded-lg border border-border bg-surface px-2 py-1 text-sm" value={a.adminLevel} disabled={myPassword.length === 0 || setLevel.isPending}
                        onChange={(e) => { setLevel.clearError(); setLevel.mutate({ id: a.id, level: e.target.value as Level }); }}>
                        {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="p-3 text-xs">{when(a.lastLoginAt)}</td>
                  <td className="p-3"><Badge tone={a.status === 'ACTIVE' ? 'success' : 'danger'}>{a.status.toLowerCase()}</Badge></td>
                  <td className="p-3">
                    {a.id !== user?.id && (
                      <Button size="sm" variant={a.status === 'ACTIVE' ? 'ghost' : 'outline'} className={a.status === 'ACTIVE' ? 'text-danger' : ''}
                        disabled={myPassword.length === 0} loading={change.isPending}
                        onClick={() => { change.clearError(); change.mutate({ id: a.id, status: a.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }); }}>
                        {a.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-semibold">Add an administrator</h2>
        <p className="mt-1 text-sm text-muted">Use a phone number that has no account yet. They log in with that number and the password you set here; ask them to keep it private.</p>
        <form
          noValidate
          className="mt-4 grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(null);
            create.mutate(undefined, { onSuccess: () => { setDone(`Administrator ${form.fullName} added.`); setForm({ fullName: '', phone: '', password: '', level: 'FULL' }); } });
          }}
        >
          <TextField label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <TextField label="Phone number" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <TextField label="Password (10+ characters, letters and numbers)" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <label className="block text-sm sm:col-span-3">
            <span className="mb-1 block font-medium">Level</span>
            <select className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as Level })}>
              {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted">{LEVELS.find((l) => l.value === form.level)?.help}</span>
          </label>
          <div className="sm:col-span-3">
            <Button type="submit" loading={create.isPending} disabled={!form.fullName || !form.phone || form.password.length < 10 || !myPassword}>Add administrator</Button>
            {create.error && <p role="alert" className="mt-2 text-sm text-danger">{create.error}</p>}
            {done && <p role="status" className="mt-2 text-sm text-success">{done}</p>}
          </div>
        </form>
      </Card>
    </div>
  );
}
