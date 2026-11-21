import { FileCheck2 } from 'lucide-react';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/Button';
import { useChecklist } from '@/lib/documents';

const ORG_STATUS = { VERIFIED: ['success', 'Verified'], PENDING: ['warning', 'Documents under review'], REJECTED: ['danger', 'A document was rejected'], UNVERIFIED: ['neutral', 'Not verified'] } as const;

/** A short progress card with a button to the full "My documents" page. */
export function DocumentsSummary({ compact = false }: { compact?: boolean }) {
  const q = useChecklist();
  if (q.isLoading) return <Skeleton className="h-24" />;
  const c = q.data;
  if (!c) return null;
  const pct = c.required === 0 ? 100 : Math.round((c.requiredDone / c.required) * 100);
  const missing = c.items.filter((i) => i.required && !['SUBMITTED', 'APPROVED', 'DONE'].includes(i.status));
  const rejected = c.items.filter((i) => i.status === 'REJECTED');
  const org = c.organization ? ORG_STATUS[c.organization.verificationStatus] : null;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><FileCheck2 className="h-5 w-5 text-accent" aria-hidden /> Documents {org && <Badge tone={org[0]}>{org[1]}</Badge>}</h2>
          <p className="mt-1 text-sm text-muted">
            {c.complete ? `All ${c.required} required documents have been sent.` : `${c.requiredDone} of ${c.required} required documents sent.`}
            {c.audience === 'WORKER' ? ' You need them to apply for jobs.' : ' You need them to publish jobs.'}
          </p>
        </div>
        <LinkButton to="/documents" variant={c.complete && rejected.length === 0 ? 'outline' : 'accent'}>{c.complete ? 'Open My documents' : 'Upload documents'}</LinkButton>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Required documents sent">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      {!compact && missing.length > 0 && <p className="mt-3 text-sm">Still to send: {missing.map((m) => m.label).join(', ')}.</p>}
      {!compact && rejected.length > 0 && <p className="mt-2 text-sm text-danger">Needs a better copy: {rejected.map((m) => m.label).join(', ')}.</p>}
    </Card>
  );
}
