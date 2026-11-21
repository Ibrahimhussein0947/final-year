import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Lightbulb, SearchCheck } from 'lucide-react';
import { Alert, Card } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';

export interface ReviewFinding { id: string; level: 'fix' | 'improve' | 'good'; text: string; link?: string }
export interface Review { method: string; note: string; counts: Record<'fix' | 'improve' | 'good', number>; findings: ReviewFinding[] }
export interface ApplicantReview { method: string; note: string; strengths: string[]; gaps: string[]; questions: string[] }

const ICON = {
  fix: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />,
  improve: <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />,
  good: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />,
};
const LABEL = { fix: 'Fix', improve: 'Improve', good: 'Looks good' } as const;

/** Runs a rule-based review on request. Nothing is saved or changed by a review. */
function useReview<T>(run: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      setData(await run());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }
  return { data, busy, error, go };
}

function Shell({ title, intro, busy, onRun, children, error, ran }: { title: string; intro: string; busy: boolean; onRun: () => void; children?: React.ReactNode; error: string | null; ran: boolean }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{intro}</p>
        </div>
        <Button variant="outline" loading={busy} onClick={onRun}><SearchCheck className="h-4 w-4" aria-hidden /> {ran ? 'Look over again' : 'Look it over'}</Button>
      </div>
      {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
      {children}
    </Card>
  );
}

/** A profile or job-post review: findings ordered by how much they matter, each with a link to fix it. */
export function FindingsPanel({ title, intro, run }: { title: string; intro: string; run: () => Promise<{ review: Review }> }) {
  const r = useReview(run);
  const review = r.data?.review;
  return (
    <Shell title={title} intro={intro} busy={r.busy} onRun={r.go} error={r.error} ran={!!review}>
      {review && (
        <div className="mt-4" data-testid="review-results">
          <p className="text-sm font-medium">
            {review.counts.fix} to fix · {review.counts.improve} to improve · {review.counts.good} already good
          </p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {review.findings.map((f) => (
              <li key={f.id} className="flex items-start gap-3 py-2.5">
                {ICON[f.level]}
                <span className="flex-1"><span className="sr-only">{LABEL[f.level]}: </span>{f.text}</span>
                {f.link && f.level !== 'good' && <Link to={f.link} className="shrink-0 text-xs font-semibold text-accent hover:underline">Go there</Link>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">{review.note}</p>
        </div>
      )}
    </Shell>
  );
}

/** An applicant review for the employer: strengths, gaps and questions to ask. */
export function ApplicantReviewPanel({ applicationId }: { applicationId: string }) {
  const r = useReview(() => api<{ review: ApplicantReview }>(`/review/applications/${applicationId}`));
  const review = r.data?.review;
  const list = (title: string, items: string[], icon: React.ReactNode) =>
    items.length > 0 && (
      <section>
        <h3 className="text-sm font-semibold">{title}</h3>
        <ul className="mt-1 space-y-1.5 text-sm">{items.map((t) => <li key={t} className="flex items-start gap-2">{icon}<span>{t}</span></li>)}</ul>
      </section>
    );
  return (
    <Shell title="Look over this applicant" intro="Strengths, gaps and questions to ask, worked out from the match and the profile." busy={r.busy} onRun={r.go} error={r.error} ran={!!review}>
      {review && (
        <div className="mt-4 space-y-4" data-testid="applicant-review">
          {list('Strengths', review.strengths, ICON.good)}
          {list('Gaps to check', review.gaps, ICON.improve)}
          {list('Questions you could ask', review.questions, <SearchCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />)}
          <p className="text-xs text-muted">{review.note}</p>
        </div>
      )}
    </Shell>
  );
}
