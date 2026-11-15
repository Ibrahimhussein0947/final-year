import { useState } from 'react';
import { Alert, Card, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody } from '@/pages/PageHeader';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/auth';
import { api, ApiError, setAccessToken } from '@/lib/api';

const errorText = (err: unknown) =>
  err instanceof ApiError ? Object.values(err.details ?? {})[0]?.[0] ?? err.message : 'Could not reach the server. Try again.';

function ChangePassword() {
  const { user, reload } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const r = await api<{ accessToken: string }>('/auth/password/change', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setAccessToken(r.accessToken); // the other devices were signed out; this one continues
      setCurrent('');
      setNext('');
      setDone(true);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Change password</h2>
      {user?.mustChangePassword && (
        <div className="mt-3">
          <Alert tone="warning">Your password was set by someone else. Choose your own password to continue.</Alert>
        </div>
      )}
      <form noValidate onSubmit={submit} className="mt-4 space-y-4">
        <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <TextField label="New password" type="password" autoComplete="new-password" hint="At least 8 characters, with a letter and a number." value={next} onChange={(e) => setNext(e.target.value)} />
        {error && <Alert tone="danger">{error}</Alert>}
        {done && <Alert tone="success">Password changed. Your other devices were signed out.</Alert>}
        <Button type="submit" variant="accent" loading={busy}>Change password</Button>
      </form>
    </Card>
  );
}

function TwoFactor() {
  const { user, reload } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => setSetup(await api('/auth/2fa/setup', { method: 'POST' })));
  const enable = () =>
    run(async () => {
      await api('/auth/2fa/enable', { method: 'POST', body: { code } });
      setSetup(null);
      setCode('');
      await reload();
    });
  const disable = () =>
    run(async () => {
      await api('/auth/2fa/disable', { method: 'POST', body: { password, code } });
      setCode('');
      setPassword('');
      await reload();
    });

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Two-factor login</h2>
      <p className="mt-1 text-sm text-muted">
        Asks for a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) every time you log in.
      </p>
      {user?.twoFactorEnabled ? (
        <div className="mt-4 space-y-4">
          <Alert tone="success">Two-factor login is on.</Alert>
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <TextField label="Authenticator code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} hint="Use a fresh code to turn it off." />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button variant="outline" loading={busy} onClick={disable}>Turn off</Button>
        </div>
      ) : setup ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            In your authenticator app choose <strong>Add account → Enter a setup key</strong>, then type this key (spaces do not matter):
          </p>
          <code className="block break-all rounded-xl bg-surface-2 px-4 py-3 text-base font-semibold tracking-widest">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
          <p className="text-xs text-muted">Keep this key private. Anyone who has it can generate your codes.</p>
          <TextField label="Code from the app" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button variant="accent" loading={busy} onClick={enable}>Confirm and turn on</Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {user?.role === 'ADMIN' ? (
            <Button variant="accent" loading={busy} onClick={start}>Set up two-factor login</Button>
          ) : (
            <p className="text-sm text-muted">Two-factor login is available for administrator accounts.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function YourData() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const data = await api('/auth/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-ethiotalent-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/me/delete', { method: 'POST', body: { password } });
      await logout();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Your data</h2>
      <p className="mt-1 text-sm text-muted">Download everything we hold about you, or delete your account.</p>
      <div className="mt-4 space-y-4">
        <Button variant="outline" loading={busy && !confirming} onClick={download}>Download my data (JSON)</Button>
        {user?.role === 'ADMIN' ? (
          <p className="text-sm text-muted">Administrator accounts are removed by another administrator.</p>
        ) : confirming ? (
          <div className="space-y-3 rounded-xl border border-danger/40 p-4">
            <Alert tone="danger">
              This cannot be undone. Your profile, applications, messages, files and sign-in details are erased, and any open vacancies you posted are closed.
            </Alert>
            <TextField label="Enter your password to confirm" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setConfirming(false); setPassword(''); setError(null); }}>Cancel</Button>
              <Button variant="accent" loading={busy} onClick={remove}>Delete my account</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setConfirming(true)}>Delete my account…</Button>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Card>
  );
}

export function SecurityPage() {
  return (
    <PageBody narrow>
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Account security</h1>
        <ChangePassword />
        <TwoFactor />
        <YourData />
      </div>
    </PageBody>
  );
}
