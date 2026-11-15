import { useState } from 'react';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAdminAction, useAdminQuery } from '@/lib/admin';
import { api } from '@/lib/api';
import { ORG_TYPES } from '@/lib/taxonomy';
import type { HiringPolicy } from '@/lib/hiring';

type Row = HiringPolicy & { organizations: number; updatedAt: string | null };
const TYPE_NAME = Object.fromEntries(ORG_TYPES);
const inp = 'h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm';
const ErrorLine = ({ text }: { text: string | null }) => (text ? <p role="alert" className="mt-2 text-sm text-danger">{text}</p> : null);

const TOGGLES: [keyof HiringPolicy, string][] = [
  ['requireVerified', 'Must be verified to publish'],
  ['requireDeadline', 'Closing date required'],
  ['requireSalary', 'Salary or pay scale required'],
  ['requireReference', 'Vacancy reference number required'],
  ['requireDecisionNote', 'Written reason to accept or reject'],
  ['requireInterview', 'Interview recorded before accepting'],
];

function PolicyCard({ r }: { r: Row }) {
  const [f, setF] = useState<HiringPolicy>(r);
  const dirty = JSON.stringify(f) !== JSON.stringify(r);
  const save = useAdminAction(
    () => api(`/admin/hiring-policies/${r.organizationType}`, {
      method: 'PATCH',
      body: {
        label: f.label || null, minAnnouncementDays: Number(f.minAnnouncementDays) || 0,
        requireVerified: f.requireVerified, requireDeadline: f.requireDeadline, requireSalary: f.requireSalary,
        requireReference: f.requireReference, requireDecisionNote: f.requireDecisionNote, requireInterview: f.requireInterview,
      },
    }),
    { invalidate: ['hiring-policies'] },
  );
  const formal = f.minAnnouncementDays > 0 || TOGGLES.some(([k]) => f[k]);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{TYPE_NAME[r.organizationType] ?? r.organizationType} <span className="text-xs font-normal text-muted">{r.organizations} organization{r.organizations === 1 ? '' : 's'}</span></h3>
        {formal ? <Badge tone="info">formal rules</Badge> : <Badge>no extra rules</Badge>}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Label on job pages
          <input className={`${inp} mt-1.5`} placeholder="e.g. Government vacancy" maxLength={60} value={f.label ?? ''} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </label>
        <label className="text-sm font-medium">Minimum days a vacancy stays open
          <input className={`${inp} mt-1.5`} type="number" min={0} max={90} value={f.minAnnouncementDays} onChange={(e) => setF({ ...f, minAnnouncementDays: Number(e.target.value) })} />
          <span className="mt-1 block text-xs font-normal text-muted">0 = no minimum. When set, nobody can be accepted before the closing date.</span>
        </label>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {TOGGLES.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="accent" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        {dirty && <Button size="sm" variant="ghost" onClick={() => setF(r)}>Undo</Button>}
        {r.updatedAt && <span className="text-xs text-muted">Last changed {new Date(r.updatedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</span>}
      </div>
      <ErrorLine text={save.error} />
    </Card>
  );
}

export function AdminHiringRules() {
  const q = useAdminQuery<{ items: Row[] }>(['hiring-policies'], '/hiring-policies');
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="font-semibold">Hiring rules by organization type</h2>
        <p className="mt-1 text-sm text-muted">How an organization may announce a vacancy and decide on candidates depends on what kind of organization it is. The platform enforces these rules when a vacancy is published or edited while live, and when a candidate is accepted or rejected. Changes apply immediately and are recorded in the activity log.</p>
        <div className="mt-3"><Alert tone="warning">The starting values were written by the developer as reasoned defaults. They are <strong>not legal advice</strong> and were not checked against Ethiopian public-service or labour regulations. Confirm them with a legal adviser and the relevant authorities before launch, then adjust them here.</Alert></div>
      </Card>
      {q.isLoading && <Skeleton className="h-64" />}
      <div className="grid gap-5 lg:grid-cols-2">{q.data?.items.map((r) => <PolicyCard key={r.organizationType + (r.updatedAt ?? '')} r={r} />)}</div>
    </div>
  );
}
