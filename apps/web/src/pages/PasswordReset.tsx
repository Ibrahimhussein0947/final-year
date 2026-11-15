import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { AuthShell } from '@/pages/Auth';
import { useI18n } from '@/i18n';
import { api, ApiError } from '@/lib/api';

const PASSWORD_HINT = 'At least 8 characters, with a letter and a number.';

/** Step 1: ask for a code by phone. Step 2: enter the code and a new password. */
export function ForgotPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? Object.values(err.details ?? {})[0]?.[0] ?? err.message : 'Could not reach the server. Try again.');

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>('/auth/password/forgot', { method: 'POST', body: { phone } });
      setDevCode(r.devCode ?? null);
      setStep('code');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { phone, code, newPassword: password } });
      navigate('/login', { replace: true, state: { notice: 'Password changed. Log in with your new password.' } });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('auth.forgot.title')} subtitle={step === 'phone' ? t('auth.forgot.subtitle') : t('auth.forgot.codeSubtitle')}>
      {step === 'phone' ? (
        <form noValidate onSubmit={requestCode} className="space-y-4">
          <TextField label={t('auth.phone')} type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="accent" className="w-full" loading={busy}>{t('auth.forgot.send')}</Button>
        </form>
      ) : (
        <form noValidate onSubmit={reset} className="space-y-4">
          <Alert tone="info">{t('auth.forgot.sent')}</Alert>
          {devCode && <Alert tone="warning">Development only: your code is {devCode}</Alert>}
          <TextField label={t('auth.forgot.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          <TextField label={t('auth.forgot.newPassword')} type="password" autoComplete="new-password" hint={PASSWORD_HINT} value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="accent" className="w-full" loading={busy}>{t('auth.forgot.reset')}</Button>
          <button type="button" className="w-full text-sm text-muted hover:underline" onClick={() => { setStep('phone'); setError(null); }}>
            {t('auth.forgot.back')}
          </button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-muted">
        <Link to="/login" className="font-semibold text-accent hover:underline">{t('nav.login')}</Link>
      </p>
    </AuthShell>
  );
}
