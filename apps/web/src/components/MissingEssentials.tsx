import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Alert } from '@/components/ui/primitives';
import type { WorkerProfile } from '@/lib/profile';

/** Where each essential profile item is filled in (ids set on the profile page sections). */
const FORM_FOR: Record<string, { to: string; form: string }> = {
  headline: { to: '/profile#section-about', form: 'About you' },
  bio: { to: '/profile#section-about', form: 'About you' },
  occupation: { to: '/profile#section-about', form: 'About you' },
  languages: { to: '/profile#section-about', form: 'About you' },
  location: { to: '/profile#section-location', form: 'Where you can work' },
  skills: { to: '/profile#section-skills', form: 'Skills' },
  background: { to: '/profile#section-experience', form: 'Work history' },
  preferences: { to: '/profile#section-preferences', form: 'Job preferences' },
  travel: { to: '/profile#section-preferences', form: 'Job preferences' },
};

/**
 * Shown after a CV import or CV build: lists the essential profile items that are still empty, each with a
 * link to the form that fills it, so the worker can add more. When nothing essential is missing, says so.
 */
export function MissingEssentials({ profile }: { profile: WorkerProfile }) {
  const missing = profile.completion.items.filter((i) => !i.done && FORM_FOR[i.key]);
  if (missing.length === 0) {
    return (
      <Alert tone="success">
        <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" aria-hidden /> Every essential part of your profile is filled in. You can still add more work history or skills above.</span>
      </Alert>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-4" data-testid="missing-essentials">
      <h3 className="font-semibold">Still missing from your profile</h3>
      <p className="mt-1 text-sm text-muted">Your CV did not cover these. Fill them in to get better job matches ({profile.completion.pct}% complete now).</p>
      <ul className="mt-3 divide-y divide-border text-sm">
        {missing.map((i) => (
          <li key={i.key} className="flex items-center gap-3 py-2">
            <span className="flex-1">{i.label}</span>
            <span className="text-xs text-muted">+{i.points}</span>
            <Link to={FORM_FOR[i.key].to} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              {FORM_FOR[i.key].form} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
