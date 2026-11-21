import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Card } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';

interface PlanStatus {
  plan: { name: string; description: string | null; priceEtbMonthly: number; maxActiveJobs: number | null; maxInvitationsPerMonth: number | null; maxFeaturedJobs: number | null; maxApplicationsReviewedPerMonth: number | null; canSearchWorkers: boolean };
  subscription: { endsAt: string | null } | null;
  isDefault: boolean;
  usage: { activeJobs: number; invitationsThisMonth: number; featuredJobs: number; reviewedThisMonth: number };
}

interface PlanOption { id: string; name: string; description: string | null; priceEtbMonthly: number; maxActiveJobs: number | null; maxInvitationsPerMonth: number | null; maxFeaturedJobs: number | null; maxApplicationsReviewedPerMonth: number | null; canSearchWorkers: boolean }
interface RequestView { id: string; status: string; note: string | null; decisionNote: string | null; plan: { id: string; name: string } }
interface PlansView { plans: PlanOption[]; currentPlanId: string; pending: RequestView | null; lastDecided: RequestView | null }
const lim = (n: number | null) => (n === null ? 'unlimited' : String(n));

/** Ask the administrator for another plan. Nothing is charged here: the administrator agrees payment with you, then switches the plan. */
function UpgradeRequest() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-plans'], queryFn: () => api<PlansView>('/employers/me/plans') });
  const [planId, setPlanId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = async () => { setError(null); await Promise.all([qc.invalidateQueries({ queryKey: ['my-plans'] }), qc.invalidateQueries({ queryKey: ['my-plan'] })]); };
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not reach the server');
  const send = useMutation({ mutationFn: () => api('/employers/me/plan-requests', { method: 'POST', body: { planId, note: note.trim() || null } }), onSuccess: async () => { setNote(''); setPlanId(''); await done(); }, onError: fail });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/employers/me/plan-requests/${id}`, { method: 'DELETE' }), onSuccess: done, onError: fail });
  if (!q.data) return null;
  const { plans, currentPlanId, pending, lastDecided } = q.data;
  const others = plans.filter((p) => p.id !== currentPlanId);
  const chosen = others.find((p) => p.id === planId);
  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Need more?</h3>
      {pending ? (
        <div className="mt-2 text-sm">
          <p>Your request for <strong>{pending.plan.name}</strong> is waiting for the administrator.{pending.note ? ` Your note: ${pending.note}` : ''}</p>
          <Button size="sm" variant="outline" className="mt-2" loading={cancel.isPending} onClick={() => cancel.mutate(pending.id)}>Cancel request</Button>
        </div>
      ) : others.length === 0 ? (
        <p className="mt-1 text-sm text-muted">There is no other plan to choose from right now.</p>
      ) : (
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <label className="block text-sm" htmlFor="plan-pick">Plan you would like</label>
          <select id="plan-pick" className="h-10 w-full max-w-sm rounded-lg border border-border bg-surface px-2 text-sm" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Choose a plan</option>
            {others.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.priceEtbMonthly.toLocaleString('en-US')} ETB a month)</option>)}
          </select>
          {chosen && (
            <p className="text-xs text-muted">
              {chosen.name}: {lim(chosen.maxActiveJobs)} open jobs, {lim(chosen.maxInvitationsPerMonth)} invitations a month, {chosen.maxFeaturedJobs === 0 ? 'no' : lim(chosen.maxFeaturedJobs)} featured jobs, {lim(chosen.maxApplicationsReviewedPerMonth)} applications reviewed a month, worker search {chosen.canSearchWorkers ? 'included' : 'not included'}.
            </p>
          )}
          <label className="block text-sm" htmlFor="plan-note">Note for the administrator (optional)</label>
          <input id="plan-note" maxLength={300} className="h-10 w-full max-w-lg rounded-lg border border-border bg-surface px-3 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example how you plan to pay" />
          <div><Button type="submit" size="sm" loading={send.isPending} disabled={!planId}>Send request</Button></div>
          <p className="text-xs text-muted">This only sends a request. The platform takes no payment: the administrator will agree payment with you and then change your plan.</p>
        </form>
      )}
      {lastDecided && !pending && lastDecided.status === 'DECLINED' && <p className="mt-2 text-sm text-warning">Your last request for {lastDecided.plan.name} was declined{lastDecided.decisionNote ? `: ${lastDecided.decisionNote}` : '.'}</p>}
      {error && <div className="mt-2"><Alert tone="danger">{error}</Alert></div>}
    </div>
  );
}

const of = (used: number, max: number | null) => (max === null ? `${used} (no limit)` : `${used} of ${max}`);

/** The employer's plan and how much of it is used. Plans are set by the platform administrator. */
export function PlanCard() {
  const q = useQuery({ queryKey: ['my-plan'], queryFn: () => api<PlanStatus>('/employers/me/subscription') });
  if (!q.data) return null;
  const { plan, usage, subscription } = q.data;
  const nearLimit = (plan.maxActiveJobs !== null && usage.activeJobs >= plan.maxActiveJobs) || (plan.maxInvitationsPerMonth !== null && usage.invitationsThisMonth >= plan.maxInvitationsPerMonth)
    || (plan.maxApplicationsReviewedPerMonth !== null && usage.reviewedThisMonth >= plan.maxApplicationsReviewedPerMonth);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Your plan: {plan.name}</h2>
        <span className="text-xs text-muted">{subscription?.endsAt ? `Until ${new Date(subscription.endsAt).toLocaleDateString('en-GB')}` : q.data.isDefault ? 'Standard plan for all employers' : 'No end date'}</span>
      </div>
      {plan.description && <p className="mt-1 text-sm text-muted">{plan.description}</p>}
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">Featured jobs</dt><dd className="font-medium">{plan.maxFeaturedJobs === 0 ? 'Not included' : of(usage.featuredJobs, plan.maxFeaturedJobs)}</dd></div>
        <div><dt className="text-muted">New applications reviewed this month</dt><dd className="font-medium">{of(usage.reviewedThisMonth, plan.maxApplicationsReviewedPerMonth)}</dd></div>
        <div><dt className="text-muted">Open jobs</dt><dd className="font-medium">{of(usage.activeJobs, plan.maxActiveJobs)}</dd></div>
        <div><dt className="text-muted">Invitations this month</dt><dd className="font-medium">{of(usage.invitationsThisMonth, plan.maxInvitationsPerMonth)}</dd></div>
        <div><dt className="text-muted">Search workers</dt><dd className="font-medium">{plan.canSearchWorkers ? 'Included' : 'Not included'}</dd></div>
      </dl>
      {nearLimit && <p className="mt-3 text-sm text-warning">You have reached a limit of this plan. Close a job, wait for the next month, or contact the administrator to change your plan. Applications already under review are never blocked.</p>}
      <UpgradeRequest />
    </Card>
  );
}
