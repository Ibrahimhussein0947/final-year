import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, TrendingUp } from 'lucide-react';
import { Badge, Card } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { useOrgRating, useSalaryGuide, type Fit } from '@/lib/workerHelpers';

const birr = (n: number) => `${n.toLocaleString('en-US')} birr`;

/** One line on a job card: how many of the job's requirements the signed-in worker meets, and what is missing. */
export function FitLine({ fit }: { fit: Fit | undefined }) {
  if (!fit) return null;
  if (fit.nothingListed) return <p className="mt-3 text-sm text-muted">This job lists no specific requirements.</p>;
  const tone = fit.met === fit.total ? 'success' : fit.met * 2 >= fit.total ? 'info' : 'neutral';
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <Badge tone={tone}>You meet {fit.met} of {fit.total} requirements</Badge>
      {fit.missing.length > 0 && <span className="text-muted">Missing: {fit.missing.join(' · ')}</span>}
    </div>
  );
}

/** What similar jobs offer. Shown only when enough jobs back it, and says what it is built from. */
export function SalaryGuideCard({ categoryId, locationId, salaryMin, salaryMax }: { categoryId: string | undefined; locationId?: string | null; salaryMin?: number | null; salaryMax?: number | null }) {
  const q = useSalaryGuide(categoryId, locationId);
  const g = q.data;
  if (!g || !g.available) return null;
  const mine = salaryMin ?? salaryMax;
  const place = g.scope.level === 'COUNTRY' ? 'in Ethiopia' : `in ${g.scope.name}`;
  const verdict = mine == null ? null : mine < g.low ? 'This job pays below what most similar jobs offer.' : mine > g.high ? 'This job pays above what most similar jobs offer.' : 'This job pays in the usual range.';
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><TrendingUp className="h-5 w-5 text-accent" aria-hidden /> What similar jobs pay</h2>
      <p className="mt-2 text-sm">Most similar jobs {place} offer <strong>{birr(g.low)} to {birr(g.high)}</strong> a month. The middle is about <strong>{birr(g.median)}</strong>.</p>
      {verdict && <p className="mt-1 text-sm font-medium">{verdict}</p>}
      <p className="mt-2 text-xs text-muted">Based on {g.sample} jobs posted here in the last year. It is what employers offered, not what people were paid, and pay depends on skills and experience.</p>
    </Card>
  );
}

/** Totals only, from workers who were interviewed or hired. Hidden until there are enough ratings. */
export function EmployerRating({ organizationId }: { organizationId: string }) {
  const q = useOrgRating(organizationId);
  const r = q.data;
  if (!r) return null;
  if (r.hidden || r.average === null) return <p className="mt-2 text-sm text-muted">Not rated yet. Ratings appear after three workers have rated this employer.</p>;
  const pct = (v: number | null, label: string) => (v === null ? null : <li key={label}>{v}% say {label}</li>);
  return (
    <div className="mt-2 text-sm">
      <p className="flex items-center gap-1.5 font-medium"><Star className="h-4 w-4 fill-current text-warning" aria-hidden /> {r.average} out of 5 <span className="font-normal text-muted">from {r.count} workers who were interviewed or hired</span></p>
      <ul className="mt-1 list-disc pl-5 text-muted">{[pct(r.paidOnTime, 'they were paid on time'), pct(r.respectful, 'they were treated with respect'), pct(r.asDescribed, 'the job was as advertised')]}</ul>
    </div>
  );
}

const ASPECTS = [
  ['paidOnTime', 'I was paid on time (or the pay was agreed clearly)'],
  ['respectful', 'I was treated with respect'],
  ['asDescribed', 'The job was as the advertisement said'],
] as const;

/** A worker rates an employer after an interview or hire: stars and three yes/no answers. No free text, and the employer never sees who rated. */
export function RateEmployer({ applicationId, organization }: { applicationId: string; organization: string }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [aspects, setAspects] = useState<Record<string, boolean | null>>({});
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api(`/applications/${applicationId}/review`, { method: 'POST', body: { rating, ...aspects } }),
    onSuccess: async () => { setError(null); await Promise.all(['my-applications', 'org-rating'].map((k) => qc.invalidateQueries({ queryKey: [k] }))); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not reach the server. Try again.'),
  });
  return (
    <fieldset className="mt-3 rounded-xl border border-border p-3 text-sm">
      <legend className="px-1 font-medium">Rate {organization}</legend>
      <p className="text-muted">Other workers see the average. {organization} never sees who rated.</p>
      <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)} className="rounded p-1 focus-visible:outline focus-visible:outline-2">
            <Star className={`h-6 w-6 ${rating >= n ? 'fill-current text-warning' : 'text-muted'}`} aria-hidden />
          </button>
        ))}
      </div>
      <ul className="mt-2 space-y-2">
        {ASPECTS.map(([k, label]) => (
          <li key={k} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">{label}</span>
            {([[true, 'Yes'], [false, 'No']] as const).map(([v, t]) => (
              <Button key={t} type="button" size="sm" variant={aspects[k] === v ? 'accent' : 'outline'} aria-pressed={aspects[k] === v} onClick={() => setAspects({ ...aspects, [k]: aspects[k] === v ? null : v })}>{t}</Button>
            ))}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" variant="accent" size="sm" disabled={rating === 0} loading={send.isPending} onClick={() => send.mutate()}>Send my rating</Button>
        {error && <span role="alert" className="text-danger">{error}</span>}
      </div>
    </fieldset>
  );
}
