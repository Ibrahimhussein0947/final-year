import { useState } from 'react';
import { Alert, Badge, Card, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAdminAction, useAdminQuery } from '@/lib/admin';
import { api } from '@/lib/api';

interface Plan {
  id: string; slug: string; name: string; description: string | null; priceEtbMonthly: number;
  maxActiveJobs: number | null; maxInvitationsPerMonth: number | null; maxFeaturedJobs: number | null; maxApplicationsReviewedPerMonth: number | null; canSearchWorkers: boolean; isActive: boolean; isDefault: boolean; subscribers: number;
}
interface OrgSub {
  id: string; name: string; type: string; plan: { id: string; name: string }; isDefault: boolean; endsAt: string | null; paymentNote: string | null;
  usage: { activeJobs: number; invitationsThisMonth: number }; maxActiveJobs: number | null; maxInvitationsPerMonth: number | null;
}

const select = 'h-9 rounded-lg border border-border bg-surface px-2 text-sm';
const limitText = (n: number | null) => (n === null ? 'Unlimited' : String(n));
const toLimit = (v: string) => (v.trim() === '' ? null : Number(v));
const blank = { name: '', description: '', priceEtbMonthly: '0', maxActiveJobs: '', maxInvitationsPerMonth: '', maxFeaturedJobs: '', maxApplicationsReviewedPerMonth: '', canSearchWorkers: true, isActive: true, isDefault: false };

function PlanForm({ initial, onDone, id }: { initial: typeof blank; onDone: () => void; id?: string }) {
  const [f, setF] = useState(initial);
  const save = useAdminAction(
    () => {
      const body = {
        name: f.name, description: f.description || null, priceEtbMonthly: Number(f.priceEtbMonthly || 0),
        maxActiveJobs: toLimit(f.maxActiveJobs), maxInvitationsPerMonth: toLimit(f.maxInvitationsPerMonth),
        maxFeaturedJobs: toLimit(f.maxFeaturedJobs), maxApplicationsReviewedPerMonth: toLimit(f.maxApplicationsReviewedPerMonth),
        canSearchWorkers: f.canSearchWorkers, isActive: f.isActive, isDefault: f.isDefault,
      };
      return id ? api(`/admin/plans/${id}`, { method: 'PATCH', body }) : api('/admin/plans', { method: 'POST', body });
    },
    { invalidate: ['plans', 'subscriptions'] },
  );
  return (
    <form noValidate className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onDone }); }}>
      <TextField label="Plan name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <TextField label="Price per month (ETB, shown only)" inputMode="numeric" value={f.priceEtbMonthly} onChange={(e) => setF({ ...f, priceEtbMonthly: e.target.value.replace(/\D/g, '') })} />
      <TextField label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <TextField label="Open jobs at a time (empty = unlimited)" inputMode="numeric" value={f.maxActiveJobs} onChange={(e) => setF({ ...f, maxActiveJobs: e.target.value.replace(/\D/g, '') })} />
      <TextField label="Invitations per month (empty = unlimited)" inputMode="numeric" value={f.maxInvitationsPerMonth} onChange={(e) => setF({ ...f, maxInvitationsPerMonth: e.target.value.replace(/\D/g, '') })} />
      <TextField label="Featured jobs at a time (0 = none, empty = unlimited)" inputMode="numeric" value={f.maxFeaturedJobs} onChange={(e) => setF({ ...f, maxFeaturedJobs: e.target.value.replace(/\D/g, '') })} />
      <TextField label="New applications reviewed per month (empty = unlimited)" inputMode="numeric" value={f.maxApplicationsReviewedPerMonth} onChange={(e) => setF({ ...f, maxApplicationsReviewedPerMonth: e.target.value.replace(/\D/g, '') })} />
      <div className="flex flex-col justify-end gap-1 pb-1 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.canSearchWorkers} onChange={(e) => setF({ ...f, canSearchWorkers: e.target.checked })} />Can search workers</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Available to assign</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />Default for employers without a plan</label>
      </div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" loading={save.isPending} disabled={f.name.trim().length < 2}>{id ? 'Save plan' : 'Create plan'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {save.error && <p role="alert" className="text-sm text-danger">{save.error}</p>}
      </div>
    </form>
  );
}

function OrgRow({ o, plans }: { o: OrgSub; plans: Plan[] }) {
  const [planId, setPlanId] = useState(o.plan.id);
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const assign = useAdminAction(
    () => api(`/admin/organizations/${o.id}/subscription`, { method: 'POST', body: { planId, endsAt: endsAt || null, paymentNote: note || null } }),
    { invalidate: ['subscriptions', 'plans'] },
  );
  const cancel = useAdminAction(() => api(`/admin/organizations/${o.id}/subscription`, { method: 'DELETE' }), { invalidate: ['subscriptions', 'plans'] });
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="p-3"><p className="font-medium">{o.name}</p><p className="text-xs text-muted">{o.type.replace(/_/g, ' ').toLowerCase()}</p></td>
      <td className="p-3">{o.plan.name}{o.isDefault && <span className="ml-1 text-xs text-muted">(default)</span>}{o.endsAt && <p className="text-xs text-muted">until {new Date(o.endsAt).toLocaleDateString('en-GB')}</p>}{o.paymentNote && <p className="text-xs text-muted">{o.paymentNote}</p>}</td>
      <td className="p-3 text-xs">Jobs {o.usage.activeJobs}/{limitText(o.maxActiveJobs)}<br />Invites {o.usage.invitationsThisMonth}/{limitText(o.maxInvitationsPerMonth)}</td>
      <td className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <select aria-label={`Plan for ${o.name}`} className={select} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.filter((p) => p.isActive || p.id === o.plan.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input aria-label="End date" type="date" className={select} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          <input aria-label="Payment note" className={`${select} w-44`} placeholder="Payment note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" loading={assign.isPending} onClick={() => assign.mutate()}>Assign</Button>
          {!o.isDefault && <Button size="sm" variant="ghost" className="text-danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Back to default</Button>}
        </div>
        {(assign.error || cancel.error) && <p role="alert" className="mt-1 text-xs text-danger">{assign.error ?? cancel.error}</p>}
      </td>
    </tr>
  );
}

interface PlanRequest { id: string; note: string | null; createdAt: string; plan: { id: string; name: string }; currentPlan: string; organization: { id: string; name: string; type: string } }

function RequestRow({ r }: { r: PlanRequest }) {
  const [endsAt, setEndsAt] = useState('');
  const [pay, setPay] = useState('');
  const [why, setWhy] = useState('');
  const opts = { invalidate: ['plan-requests', 'subscriptions', 'plans'] };
  const approve = useAdminAction(() => api(`/admin/plan-requests/${r.id}/approve`, { method: 'POST', body: { endsAt: endsAt || null, paymentNote: pay || null, decisionNote: why || null } }), opts);
  const decline = useAdminAction(() => api(`/admin/plan-requests/${r.id}/decline`, { method: 'POST', body: { decisionNote: why || null } }), opts);
  return (
    <li className="rounded-xl border border-border p-3 text-sm">
      <p><strong>{r.organization.name}</strong> <span className="text-xs text-muted">({r.organization.type.replace(/_/g, ' ').toLowerCase()})</span> asks to move from {r.currentPlan} to <strong>{r.plan.name}</strong></p>
      <p className="text-xs text-muted">Sent {new Date(r.createdAt).toLocaleDateString('en-GB')}{r.note ? ` · Their note: ${r.note}` : ''}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input aria-label="End date" type="date" className={select} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        <input aria-label="Payment note" className={`${select} w-44`} placeholder="Payment note (optional)" value={pay} onChange={(e) => setPay(e.target.value)} />
        <input aria-label="Message to the employer" className={`${select} w-56`} placeholder="Message to the employer (optional)" value={why} onChange={(e) => setWhy(e.target.value)} />
        <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate()}>Approve and assign</Button>
        <Button size="sm" variant="ghost" className="text-danger" loading={decline.isPending} onClick={() => decline.mutate()}>Decline</Button>
      </div>
      {(approve.error || decline.error) && <p role="alert" className="mt-1 text-xs text-danger">{approve.error ?? decline.error}</p>}
    </li>
  );
}

/** Employers' requests for another plan. Approving assigns the plan; payment is agreed outside the system. */
function PlanRequests() {
  const q = useAdminQuery<{ items: PlanRequest[] }>(['plan-requests'], '/plan-requests?status=PENDING');
  const items = q.data?.items ?? [];
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Plan requests {items.length > 0 && <Badge tone="warning">{items.length} waiting</Badge>}</h2>
      {q.isLoading && <Skeleton className="mt-3 h-16" />}
      {q.isError && <Alert tone="danger">Could not load requests.</Alert>}
      {q.data && items.length === 0 && <p className="mt-2 text-sm text-muted">No requests waiting.</p>}
      {items.length > 0 && <ul className="mt-3 space-y-3">{items.map((r) => <RequestRow key={r.id} r={r} />)}</ul>}
    </Card>
  );
}

/** Plans with limits, and which employer is on which plan. No payments are taken: the administrator records how an employer paid. */
export function AdminPlans() {
  const plans = useAdminQuery<{ items: Plan[] }>(['plans'], '/plans');
  const [q, setQ] = useState('');
  const subs = useAdminQuery<{ items: OrgSub[]; total: number }>(['subscriptions', q], `/subscriptions?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <div className="space-y-5">
      <Alert tone="info">
        A plan sets what an employer may do: how many jobs can be open at once, how many invitations to apply they can send each month, and whether they can search workers.
        Employers without a plan get the default plan. The system takes no payment; record how an employer paid in the payment note when you assign a plan.
      </Alert>

      <PlanRequests />

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Plans</h2>
          {editing !== 'new' && <Button size="sm" variant="outline" onClick={() => setEditing('new')}>New plan</Button>}
        </div>
        {editing === 'new' && <div className="mt-4"><PlanForm initial={blank} onDone={() => setEditing(null)} /></div>}
        {plans.isLoading && <Skeleton className="mt-3 h-24" />}
        {plans.data && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead><tr className="border-b border-border text-muted"><th className="p-2">Plan</th><th className="p-2">Price / month</th><th className="p-2">Open jobs</th><th className="p-2">Invitations / month</th><th className="p-2">Featured jobs</th><th className="p-2">Reviews / month</th><th className="p-2">Worker search</th><th className="p-2">Employers</th><th className="p-2" /></tr></thead>
              <tbody>
                {plans.data.items.map((p) => (
                  <tr key={p.id} className="border-b border-border align-top last:border-0">
                    {editing === p.id ? (
                      <td colSpan={9} className="p-3">
                        <PlanForm id={p.id} onDone={() => setEditing(null)} initial={{ name: p.name, description: p.description ?? '', priceEtbMonthly: String(p.priceEtbMonthly), maxActiveJobs: p.maxActiveJobs === null ? '' : String(p.maxActiveJobs), maxInvitationsPerMonth: p.maxInvitationsPerMonth === null ? '' : String(p.maxInvitationsPerMonth), maxFeaturedJobs: p.maxFeaturedJobs === null ? '' : String(p.maxFeaturedJobs), maxApplicationsReviewedPerMonth: p.maxApplicationsReviewedPerMonth === null ? '' : String(p.maxApplicationsReviewedPerMonth), canSearchWorkers: p.canSearchWorkers, isActive: p.isActive, isDefault: p.isDefault }} />
                      </td>
                    ) : (
                      <>
                        <td className="p-2 font-medium">{p.name} {p.isDefault && <Badge tone="info">default</Badge>} {!p.isActive && <Badge tone="warning">off</Badge>}</td>
                        <td className="p-2">{p.priceEtbMonthly.toLocaleString('en-US')} ETB</td>
                        <td className="p-2">{limitText(p.maxActiveJobs)}</td>
                        <td className="p-2">{limitText(p.maxInvitationsPerMonth)}</td>
                        <td className="p-2">{p.maxFeaturedJobs === 0 ? 'None' : limitText(p.maxFeaturedJobs)}</td>
                        <td className="p-2">{limitText(p.maxApplicationsReviewedPerMonth)}</td>
                        <td className="p-2">{p.canSearchWorkers ? 'Yes' : 'No'}</td>
                        <td className="p-2">{p.subscribers}</td>
                        <td className="p-2"><Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}>Edit</Button></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Employers and their plans</h2>
        <div className="mt-3 max-w-sm"><TextField label="Search organization" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {subs.isLoading && <Skeleton className="mt-3 h-32" />}
        {subs.isError && <Alert tone="danger">Could not load employers.</Alert>}
        {subs.data && plans.data && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-border text-muted"><th className="p-3">Organization</th><th className="p-3">Current plan</th><th className="p-3">Usage</th><th className="p-3">Change plan</th></tr></thead>
              <tbody>{subs.data.items.map((o) => <OrgRow key={`${o.id}-${o.plan.id}`} o={o} plans={plans.data.items} />)}</tbody>
            </table>
            {subs.data.total > subs.data.items.length && <p className="mt-2 text-xs text-muted">Showing {subs.data.items.length} of {subs.data.total}. Search to narrow the list.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
