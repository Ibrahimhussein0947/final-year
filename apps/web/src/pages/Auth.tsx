import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Card, SelectField, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody } from '@/pages/PageHeader';
import { useI18n, LOCALES } from '@/i18n';
import { useAuth } from '@/app/auth';
import { ApiError } from '@/lib/api';
import { REGIONS } from '@/lib/taxonomy';
import { RoleChoice } from '@/components/RoleChoice';
import { OrgTypeHelp, OrgTypeOptions } from '@/components/OrgTypeFields';
import { useOrgType } from '@/lib/orgTypes';

// Ethiopian mobile numbers: 09xxxxxxxx, 07xxxxxxxx, +2519xxxxxxxx, +2517xxxxxxxx
// Spaces, dashes and brackets are ignored: "0912 234 567" and "0912234567" are the same number.
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-().]/g, ''))
  .pipe(z.string().regex(/^(\+251|251|0)?[79]\d{8}$/, 'Enter a valid Ethiopian mobile number, e.g. 0911 234 567'));

const loginSchema = z.object({ phone, password: z.string().min(1, 'Enter your password') });

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name'),
    phone,
    email: z.string().trim().email('Enter a valid email').or(z.literal('')),
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(72, 'Use at most 72 characters')
      .regex(/[A-Za-z]/, 'Include at least one letter')
      .regex(/\d/, 'Include at least one number'),
    role: z.enum(['WORKER', 'EMPLOYER']),
    region: z.string().min(1, 'Select your region'),
    zone: z.string().trim().optional(),
    woreda: z.string().trim().optional(),
    kebele: z.string().trim().optional(),
    language: z.enum(['en', 'am', 'om']),
    organizationName: z.string().trim().optional(),
    organizationType: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'EMPLOYER') {
      if (!v.organizationName || v.organizationName.length < 2)
        ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'Enter your organization name' });
      if (!v.organizationType) ctx.addIssue({ code: 'custom', path: ['organizationType'], message: 'Select an organization type' });
    }
  });

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

/** Show server-side field errors next to the fields, and return a message for anything else. */
function applyServerError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): string | null {
  if (err instanceof ApiError) {
    let placed = false;
    for (const [field, msgs] of Object.entries(err.details ?? {})) {
      if (msgs?.[0]) {
        setError(field as Path<T>, { message: msgs[0] });
        placed = true;
      }
    }
    return placed ? null : err.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <PageBody narrow>
      <div className="mx-auto max-w-xl">
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-1 text-muted">{subtitle}</p>
        <Card className="mt-6 p-6">{children}</Card>
      </div>
    </PageBody>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const [totp, setTotp] = useState('');
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  if (user) return <Navigate to="/dashboard" replace />;
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  const notice = (location.state as { notice?: string } | null)?.notice;

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await login(v.phone, v.password, needCode ? totp : undefined);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TWO_FACTOR_REQUIRED') {
        setNeedCode(true);
        setFormError(null);
        return;
      }
      setFormError(applyServerError(err, setError));
    }
  });

  return (
    <AuthShell title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <TextField label={t('auth.phone')} type="tel" autoComplete="tel" error={errors.phone?.message} {...register('phone')} />
        <TextField label={t('auth.password')} type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        {needCode && (
          <TextField label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={totp} onChange={(e) => setTotp(e.target.value)} hint="Open your authenticator app and enter the 6-digit code." />
        )}
        {notice && !formError && <Alert tone="success">{notice}</Alert>}
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Button type="submit" variant="accent" className="w-full" loading={isSubmitting}>
          {t('nav.login')}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link to="/forgot-password" className="font-semibold text-accent hover:underline">{t('auth.forgot.link')}</Link>
      </p>
      <p className="mt-3 text-center text-sm text-muted">
        {t('auth.noAccount')} <Link to="/register" className="font-semibold text-accent hover:underline">{t('nav.register')}</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { t, locale } = useI18n();
  const { user, register: signUp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, watch, formState: { errors, isSubmitting } } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: params.get('role') === 'employer' ? 'EMPLOYER' : 'WORKER',
      language: locale,
      region: '',
      email: '',
    },
  });
  const isEmployer = watch('role') === 'EMPLOYER';
  const chosenType = watch('organizationType');
  const chosenInfo = useOrgType(chosenType);
  const isIndividual = chosenInfo?.group === 'individual';

  if (user) return <Navigate to="/dashboard" replace />;

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await signUp({
        ...v,
        email: v.email || undefined,
        ...(v.role === 'WORKER' ? { organizationName: undefined, organizationType: undefined } : {}),
      });
      // A new job seeker or employer starts by sending their documents; the page explains what is needed and why.
      navigate(v.role === 'WORKER' || v.role === 'EMPLOYER' ? '/documents' : '/dashboard', { replace: true });
    } catch (err) {
      setFormError(applyServerError(err, setError));
    }
  });

  return (
    <AuthShell title={t('auth.register.title')} subtitle={t('auth.register.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <RoleChoice legend={t('auth.role')} workerLabel={t('auth.role.worker')} employerLabel={t('auth.role.employer')} current={isEmployer ? 'EMPLOYER' : 'WORKER'} {...register('role')} />
        </div>
        <div className="sm:col-span-2">
          <TextField label={t('auth.fullName')} autoComplete="name" error={errors.fullName?.message} {...register('fullName')} />
        </div>
        {isEmployer && (
          <>
            <TextField label={isIndividual ? 'Your name or household name' : t('auth.orgName')} error={errors.organizationName?.message} {...register('organizationName')} />
            <SelectField label={t('auth.orgType')} error={errors.organizationType?.message} {...register('organizationType')}>
              <option value="">–</option>
              <OrgTypeOptions />
            </SelectField>
            <OrgTypeHelp value={chosenType} />
            <p className="text-xs text-muted sm:col-span-2">Choose the type that matches your organization honestly. Government offices, public enterprises and NGOs follow formal hiring rules (verification, vacancy reference numbers, a minimum announcement period, written decisions). The type is fixed once you are verified or have published a job.</p>
          </>
        )}
        <TextField label={t('auth.phone')} type="tel" autoComplete="tel" error={errors.phone?.message} {...register('phone')} />
        <TextField label={t('auth.email')} type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <div className="sm:col-span-2">
          <TextField
            label={t('auth.password')}
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters with a letter and a number"
            error={errors.password?.message}
            {...register('password')}
          />
        </div>
        <SelectField label={t('auth.region')} error={errors.region?.message} {...register('region')}>
          <option value="">–</option>
          {REGIONS.map((r) => <option key={r}>{r}</option>)}
        </SelectField>
        <TextField label={t('auth.zone')} {...register('zone')} />
        <TextField label={t('auth.woreda')} {...register('woreda')} />
        <TextField label={t('auth.kebele')} {...register('kebele')} />
        <div className="sm:col-span-2">
          <SelectField label={t('auth.language')} {...register('language')}>
            {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </SelectField>
        </div>
        {formError && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{formError}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" variant="accent" className="w-full" loading={isSubmitting}>
            {t('nav.register')}
          </Button>
        </div>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        {t('auth.haveAccount')} <Link to="/login" className="font-semibold text-accent hover:underline">{t('nav.login')}</Link>
      </p>
    </AuthShell>
  );
}
