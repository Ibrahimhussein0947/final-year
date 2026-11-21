import { ShieldCheck } from 'lucide-react';
import { Badge, Card } from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/Button';
import { useMyTrust, type Trust } from '@/lib/trust';

const TONE: Record<Trust['level'], 'neutral' | 'info' | 'success'> = { 0: 'neutral', 1: 'info', 2: 'success', 3: 'success', 4: 'success' };

/** What an administrator has checked against real documents. Level 0 shows nothing special: not having papers is not a mark against anyone. */
export function TrustBadge({ trust }: { trust: Trust | null | undefined }) {
  if (!trust || trust.level === 0) return null;
  const proven = [trust.proven.identity && 'ID', trust.proven.education && 'education', trust.proven.experience && 'work', trust.proven.credentials && 'certificates'].filter(Boolean).join(', ');
  return <Badge tone={TONE[trust.level]}><ShieldCheck className="h-3 w-3" aria-hidden /> <span title={`Checked by an administrator: ${proven}`}>{trust.label}</span></Badge>;
}

/** The worker's own card: their level, what is already proven and what to do next to be found more easily. */
export function TrustCard() {
  const q = useMyTrust();
  const t = q.data;
  if (!t) return null;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Your trust level</h2>
        <Badge tone={TONE[t.level]}><ShieldCheck className="h-3 w-3" aria-hidden /> {t.label}</Badge>
      </div>
      <div className="mt-3 flex gap-1.5" role="img" aria-label={`Level ${t.level} of 4`}>
        {[1, 2, 3, 4].map((n) => <span key={n} className={`h-2 flex-1 rounded-full ${t.level >= n ? 'bg-accent' : 'bg-surface-2'}`} />)}
      </div>
      <p className="mt-3 text-sm text-muted">Employers see this badge next to your name. It only goes up when an administrator approves a real document: first your ID, then your education, your work and your certificates. It does not change your match score, and having fewer papers never lowers it.</p>
      {t.next.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {t.next.map((s) => <li key={s.key} className="flex items-start gap-2"><span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{s.text}</li>)}
        </ul>
      ) : <p className="mt-3 text-sm font-medium text-success">Everything is in place. Keep your profile up to date.</p>}
      {t.next.length > 0 && <div className="mt-3"><LinkButton to="/documents" variant="outline" size="sm">Open my documents</LinkButton></div>}
    </Card>
  );
}
