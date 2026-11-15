import { useState } from 'react';
import { Badge, Card, Skeleton, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { useAdminAction, useAdminQuery } from '@/lib/admin';
import { api } from '@/lib/api';
import { useOrgTypeCatalog } from '@/lib/orgTypes';

const sel = 'h-9 rounded-lg border border-border bg-surface px-2 text-sm';
interface OrgRow { id: string; name: string; type: string; typeLabel: string; group: string; verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED'; createdAt: string; accounts: number; liveJobs: number }
interface OrgList { total: number; page: number; pageSize: number; summary: { group: string; label: string; organizations: number; verified: number; pending: number }[]; items: OrgRow[] }

const STATUS_TONE = { VERIFIED: 'success', PENDING: 'warning', REJECTED: 'danger', UNVERIFIED: 'neutral' } as const;

function Row({ o, types }: { o: OrgRow; types: { value: string; label: string; legacy?: boolean }[] }) {
  const [next, setNext] = useState(o.type);
  const change = useAdminAction(() => api(`/admin/organizations/${o.id}/type`, { method: 'PATCH', body: { type: next } }), { invalidate: ['organizations', 'hiring'] });
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="py-2.5 pr-3 font-medium">{o.name}</td>
      <td className="pr-3">
        <select aria-label={`Type of ${o.name}`} className={sel} value={next} onChange={(e) => setNext(e.target.value)}>
          {types.filter((t) => !t.legacy || t.value === o.type).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {next !== o.type && (
          <div className="mt-1.5 flex items-center gap-2">
            <Button size="sm" variant="accent" loading={change.isPending} onClick={() => { if (window.confirm(`Change ${o.name} to "${types.find((t) => t.value === next)?.label}"? This changes which hiring rules apply to it.`)) change.mutate(); }}>Save type</Button>
            <button type="button" className="text-xs text-muted underline" onClick={() => setNext(o.type)}>cancel</button>
          </div>
        )}
        {change.error && <p role="alert" className="mt-1 text-xs text-danger">{change.error}</p>}
      </td>
      <td className="pr-3"><Badge tone={STATUS_TONE[o.verificationStatus]}>{o.verificationStatus.toLowerCase()}</Badge></td>
      <td className="pr-3">{o.liveJobs}</td>
      <td className="pr-3">{o.accounts}</td>
      <td className="text-muted">{new Date(o.createdAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</td>
    </tr>
  );
}

/** Organizations by kind: find one, see whether it is verified, and correct its type when it was chosen wrongly. */
export function AdminOrganizations() {
  const catalog = useOrgTypeCatalog();
  const [f, setF] = useState({ q: '', group: '', type: '', status: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '20', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const q = useAdminQuery<OrgList>(['organizations', qs], `/organizations?${qs}`);
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v, ...(k === 'group' ? { type: '' } : {}) })); setPage(1); };
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  const typeOptions = catalog.types.filter((t) => !f.group || t.group === f.group);

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="font-semibold">Organizations</h2>
        <p className="mt-1 text-sm text-muted">Every employer by kind. The kind decides which hiring rules apply (see "Hiring rules"). Verification requests are reviewed under "Verification".</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {q.data?.summary.map((s) => (
            <button key={s.group} type="button" onClick={() => set('group', f.group === s.group ? '' : s.group)}
              className={`rounded-xl border p-3 text-left ${f.group === s.group ? 'border-accent bg-accent-soft' : 'border-border'}`}>
              <p className="text-2xl font-extrabold">{s.organizations}</p>
              <p className="text-xs text-muted">{s.label}</p>
              <p className="mt-1 text-[11px] text-muted">{s.verified} verified{s.pending ? `, ${s.pending} waiting` : ''}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <TextField label="Search by name" value={f.q} onChange={(e) => set('q', e.target.value)} />
          <label className="text-sm font-medium">Kind
            <select className={`${sel} mt-1.5 w-full`} value={f.group} onChange={(e) => set('group', e.target.value)}>
              <option value="">All kinds</option>
              {catalog.groups.filter((g) => g.group !== 'all').map((g) => <option key={g.group} value={g.group}>{g.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Type
            <select className={`${sel} mt-1.5 w-full`} value={f.type} onChange={(e) => set('type', e.target.value)}>
              <option value="">All types</option>
              {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Verification
            <select className={`${sel} mt-1.5 w-full`} value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">Any</option>
              <option value="VERIFIED">Verified</option>
              <option value="PENDING">Waiting for review</option>
              <option value="UNVERIFIED">Not verified</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
        </div>
      </Card>

      <Card className="overflow-x-auto p-5">
        {q.isLoading && <Skeleton className="h-48" />}
        {q.data && (
          <>
            <p className="mb-2 text-sm text-muted">{q.data.total} organization{q.data.total === 1 ? '' : 's'}</p>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="border-b border-border text-muted"><th className="py-2">Name</th><th>Type</th><th>Verification</th><th>Live jobs</th><th>Accounts</th><th>Created</th></tr></thead>
              <tbody>
                {q.data.items.length === 0 && <tr><td colSpan={6} className="py-4 text-muted">No organizations match.</td></tr>}
                {q.data.items.map((o) => <Row key={o.id + o.type} o={o} types={catalog.types} />)}
              </tbody>
            </table>
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <span>Page {page} of {pages}</span>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
