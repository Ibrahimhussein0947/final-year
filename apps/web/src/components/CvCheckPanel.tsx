import { AlertTriangle, CheckCircle2, CircleHelp, Sparkles, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Badge } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { RecommendedJobCard } from '@/pages/worker/Recommended';
import { declinedFrom, useLatestCvCheck, useRecheckCv, type CvCheck, type Opportunities } from '@/lib/cvCheck';

const OUTCOME = {
  ACCEPTED: { tone: 'success', label: 'CV accepted', help: 'Your CV agrees with the details on your profile.' },
  DECLINED: { tone: 'danger', label: 'CV declined', help: 'Your CV contradicts the details on your profile. Correct the details if they are wrong, or upload the right CV, then check again.' },
  UNCHECKED: { tone: 'neutral', label: 'Could not be checked', help: 'We could not read enough of the CV to compare it. It was kept, and employers will see it as not checked.' },
} as const;
const ICON = { ok: <CheckCircle2 className="h-4 w-4 text-success" aria-label="matches" />, info: <CircleHelp className="h-4 w-4 text-muted" aria-label="note" />, warn: <AlertTriangle className="h-4 w-4 text-warning" aria-label="difference" />, block: <XCircle className="h-4 w-4 text-danger" aria-label="contradiction" /> };

export function Findings({ check }: { check: CvCheck }) {
  return (
    <ul className="space-y-1.5 text-sm" aria-label="What was compared">
      {check.findings.map((f) => (
        <li key={f.code} className="flex items-start gap-2"><span className="mt-0.5 shrink-0">{ICON[f.severity]}</span><span>{f.message}{f.expected && f.found ? <span className="block text-xs text-muted">Profile: {f.expected} · CV: {f.found}</span> : null}</span></li>
      ))}
    </ul>
  );
}

/** The jobs that fit what the worker offers and wants, shown once the CV has been accepted. */
export function OpportunityList({ opportunities }: { opportunities: Opportunities }) {
  if (opportunities.items.length === 0) {
    return <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Sparkles className="h-4 w-4" aria-hidden /> No open job fits right now. New jobs are matched as they are posted, and we will tell you.</p>;
  }
  return (
    <div className="mt-4">
      <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-accent" aria-hidden /> Jobs that fit what you want</h3>
      <p className="mt-1 text-sm text-muted">Ranked by your skills, experience, location and preferences.</p>
      <ul className="mt-3 space-y-3">{opportunities.items.map((i) => <RecommendedJobCard key={i.job.id} item={i} />)}</ul>
      <LinkButton to="/recommended" variant="outline" size="sm" className="mt-3">See all recommended jobs</LinkButton>
    </div>
  );
}

/** Result of the last CV check, with a button to check again after correcting the profile. `opportunities` come from the upload that just happened. */
export function CvCheckPanel({ opportunities, error }: { opportunities?: Opportunities | null; error?: unknown }) {
  const q = useLatestCvCheck();
  const recheck = useRecheckCv();
  const declined = declinedFrom(error) ?? declinedFrom(recheck.error);
  const check = q.data?.check;
  const jobs = opportunities ?? recheck.data?.opportunities ?? null;
  if (!check && !declined) return null;
  const o = check ? OUTCOME[check.outcome] : null;
  return (
    <div className="mt-4 rounded-xl border border-border p-4">
      {declined && (
        <div className="mb-3"><Alert tone="danger">
          <p className="font-semibold">{declined.message}</p>
          {declined.reasons.length > 0 && <ul className="mt-1 list-disc pl-5">{declined.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {declined.fix.map((f) => <p key={f} className="mt-1">{f}</p>)}
        </Alert></div>
      )}
      {check && o && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">CV check <Badge tone={o.tone}>{o.label}</Badge></p>
            <Button size="sm" variant="outline" loading={recheck.isPending} onClick={() => recheck.mutate()}>Check again</Button>
          </div>
          <p className="mt-2 text-sm text-muted">{check.outcome === 'DECLINED' ? o.help : check.reason ?? o.help}</p>
          <div className="mt-3"><Findings check={check} /></div>
          <p className="mt-3 text-xs text-muted">This compares the CV with your profile; it does not prove either is true. Only a clear contradiction declines a CV. <Link to="/profile#identity-documents" className="underline">Verify your identity and certificates</Link> for a verified badge.</p>
        </>
      )}
      {check?.outcome === 'ACCEPTED' && jobs && <OpportunityList opportunities={jobs} />}
    </div>
  );
}
