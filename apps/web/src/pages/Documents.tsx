import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CheckCircle2, Circle, Clock, ShieldAlert, XCircle } from 'lucide-react';
import { Alert, Badge, Card, SelectField, Skeleton, TextField } from '@/components/ui/primitives';
import { Button, LinkButton } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useAuth } from '@/app/auth';
import { api } from '@/lib/api';
import { ID_TYPE_LABEL, errorText, refreshDocuments, useChecklist, useUploadDocument, type Checklist, type ChecklistItem, type Identity, type ItemStatus, type Legal } from '@/lib/documents';
import { CheckResult, FilePicker } from '@/pages/worker/documents';
import { TrustCard } from '@/components/TrustBadge';

const STATUS: Record<ItemStatus, { tone: 'neutral' | 'warning' | 'success' | 'danger' | 'info'; label: string }> = {
  MISSING: { tone: 'neutral', label: 'Not sent' },
  SUBMITTED: { tone: 'warning', label: 'Sent, waiting for review' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected: send a better copy' },
  DONE: { tone: 'success', label: 'Added' },
};
const STATUS_ICON: Record<ItemStatus, JSX.Element> = {
  MISSING: <Circle className="h-5 w-5 text-muted" aria-hidden />,
  SUBMITTED: <Clock className="h-5 w-5 text-warning" aria-hidden />,
  APPROVED: <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />,
  REJECTED: <XCircle className="h-5 w-5 text-danger" aria-hidden />,
  DONE: <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />,
};
const ORG_BADGE = { VERIFIED: <Badge tone="success"><BadgeCheck className="h-3 w-3" aria-hidden /> Verified</Badge>, PENDING: <Badge tone="warning"><Clock className="h-3 w-3" aria-hidden /> Under review</Badge>, REJECTED: <Badge tone="danger">A document was rejected</Badge>, UNVERIFIED: <Badge><ShieldAlert className="h-3 w-3" aria-hidden /> Not verified</Badge> };

// ───────── step 1: the details the documents are compared with ─────────

function SaveLine({ saved, error }: { saved: boolean; error: string | null }) {
  return <>{saved && <span role="status" className="text-sm font-medium text-success">Saved</span>}{error && <span role="alert" className="text-sm text-danger">{error}</span>}</>;
}

function WorkerDetails() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['identity'], queryFn: async () => (await api<{ identity: Identity }>('/workers/me/identity')).identity });
  const [f, setF] = useState({ fatherName: '', grandfatherName: '', dateOfBirth: '', idType: '', idNumber: '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (q.data) setF({ fatherName: q.data.fatherName ?? '', grandfatherName: q.data.grandfatherName ?? '', dateOfBirth: q.data.dateOfBirth ?? '', idType: q.data.idType ?? '', idNumber: q.data.idNumber ?? '' }); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/workers/me/identity', { method: 'PUT', body: f }),
    onSuccess: async () => { setSaved(true); setError(null); await refreshDocuments(qc); },
    onError: (e) => { setSaved(false); setError(errorText(e)); },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold">1. Your details {q.data?.verified && <Badge tone="success">Identity verified</Badge>}</h2>
      <p className="mt-1 text-sm text-muted">Your name is the one on your account ({user?.fullName}). Write the other details the way they appear on your documents. They are private: employers never see them.</p>
      <form noValidate className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <TextField label="Date of birth" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
        <SelectField label="Kind of ID you will upload" value={f.idType} onChange={set('idType')}>
          <option value="">Choose</option>
          {Object.entries(ID_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
        <TextField label="ID number (optional)" value={f.idNumber} onChange={set('idNumber')} />
        <TextField label="Father's name (for the birth certificate)" value={f.fatherName} onChange={set('fatherName')} />
        <TextField label="Grandfather's name (optional)" value={f.grandfatherName} onChange={set('grandfatherName')} />
        <div className="flex items-end gap-3"><Button type="submit" variant="outline" loading={save.isPending}>Save details</Button><SaveLine saved={saved} error={error} /></div>
      </form>
      {q.data?.verified && <p className="mt-2 text-xs text-muted">Changing these details removes the verified mark until an administrator checks them again.</p>}
    </Card>
  );
}

function EmployerDetails({ checklist }: { checklist: Checklist }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['legal'], queryFn: async () => (await api<{ legal: Legal }>('/employers/me/legal')).legal });
  const [f, setF] = useState({ tin: '', licenseNumber: '', licenseExpiresAt: '', registrationNumber: '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (q.data) setF({ tin: q.data.tin ?? '', licenseNumber: q.data.licenseNumber ?? '', licenseExpiresAt: q.data.licenseExpiresAt ?? '', registrationNumber: q.data.registrationNumber ?? '' }); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/employers/me/legal', { method: 'PUT', body: f }),
    onSuccess: async () => { setSaved(true); setError(null); await refreshDocuments(qc); },
    onError: (e) => { setSaved(false); setError(errorText(e)); },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  const has = (...keys: string[]) => checklist.items.some((i) => keys.includes(i.key));
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold">1. Your organization's details</h2>
      <p className="mt-1 text-sm text-muted">Type these exactly as they are on your documents. We compare each document with them. They are private: workers never see them. The organization name ({checklist.organization?.name}) and your name come from your account.</p>
      <form noValidate className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {has('TIN_CERTIFICATE') && <TextField label="Tax identification number (TIN, 10 digits)" inputMode="numeric" value={f.tin} onChange={set('tin')} />}
        {has('BUSINESS_LICENSE', 'AGENCY_LICENSE') && <TextField label="Licence number" value={f.licenseNumber} onChange={set('licenseNumber')} />}
        {has('BUSINESS_LICENSE', 'AGENCY_LICENSE') && <TextField label="Licence valid until" type="date" value={f.licenseExpiresAt} onChange={set('licenseExpiresAt')} />}
        {has('ORG_REGISTRATION', 'COMMERCIAL_REGISTRATION') && <TextField label="Registration number (optional)" value={f.registrationNumber} onChange={set('registrationNumber')} />}
        {!has('TIN_CERTIFICATE', 'BUSINESS_LICENSE', 'AGENCY_LICENSE', 'ORG_REGISTRATION', 'COMMERCIAL_REGISTRATION') && <p className="text-sm text-muted sm:col-span-3">Nothing to type for your kind of organization. Go on to step 2.</p>}
        <div className="flex items-end gap-3"><Button type="submit" variant="outline" loading={save.isPending}>Save details</Button><SaveLine saved={saved} error={error} /></div>
      </form>
    </Card>
  );
}

// ───────── step 2: the documents ─────────

function ItemCard({ item }: { item: ChecklistItem }) {
  const up = useUploadDocument();
  const s = STATUS[item.status];
  const isProfile = item.key === 'PHOTO' || item.key === 'CV';
  const blocked = item.blockedBy.length > 0;
  const approved = item.status === 'APPROVED';
  const label = item.detail ? `${item.label} · ${item.detail}` : item.label;
  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">{STATUS_ICON[item.status]}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{label}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={item.required ? 'accent' : 'neutral'}>{item.required ? 'Required' : 'Recommended'}</Badge>
                <Badge tone={s.tone}>{s.label}</Badge>
              </div>
            </div>
            <p className="mt-1 text-sm text-muted">{item.description}</p>
            {item.checks.length > 0 && !isProfile && <p className="mt-1 text-xs text-muted">We check: {item.checks.join(', ')}.</p>}

            {isProfile ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <LinkButton to="/profile#photo-and-cv" variant={item.status === 'DONE' ? 'outline' : 'accent'} size="sm">{item.status === 'DONE' ? 'Change in my profile' : 'Add in my profile'}</LinkButton>
                {item.key === 'CV' && item.cvOutcome && <Badge tone={item.cvOutcome === 'ACCEPTED' ? 'success' : item.cvOutcome === 'DECLINED' ? 'danger' : 'neutral'}>{item.cvOutcome === 'ACCEPTED' ? 'Matches your profile' : item.cvOutcome === 'DECLINED' ? 'Does not match your profile' : 'Could not be checked'}</Badge>}
              </div>
            ) : approved ? null : (
              <div className="mt-3 space-y-2">
                {blocked && <p className="text-sm text-warning">First save {item.blockedBy.join(' and ')}{item.blockedBy[0].startsWith('an education') || item.blockedBy[0].startsWith('a certificate') ? '.' : ' in step 1, so there is something to compare.'}</p>}
                <FilePicker
                  label={item.status === 'MISSING' ? 'Upload' : item.status === 'REJECTED' ? 'Upload a better copy' : 'Replace this upload'}
                  variant={item.status === 'MISSING' || item.status === 'REJECTED' ? 'accent' : 'outline'}
                  busy={up.isPending} disabled={blocked}
                  onFile={(file) => up.mutate({ docType: item.key as never, educationId: item.educationId, experienceId: item.experienceId, certificationId: item.certificationId, file })}
                />
                {up.isPending && <p role="status" className="text-sm text-muted">Reading your document. A photo can take up to a minute.</p>}
                {up.error && <Alert tone="danger">{up.error}</Alert>}
              </div>
            )}
            {item.check && <div className="mt-3"><CheckResult doc={item.check} label={label} /></div>}
          </div>
        </div>
      </Card>
    </li>
  );
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const q = useChecklist();
  const c = q.data;
  const isEmployer = user?.role === 'EMPLOYER';
  const pct = c && c.required > 0 ? Math.round((c.requiredDone / c.required) * 100) : 0;
  return (
    <>
      <PageHeader
        title="My documents"
        subtitle={isEmployer ? 'Upload the documents that prove who your organization is. You need them to publish jobs, and they earn the Verified badge.' : 'Upload your ID and the certificates that support your profile. You need an ID document and a photo to apply for jobs.'}
      />
      <PageBody narrow>
        {q.isLoading && <div className="space-y-3" aria-busy="true"><Skeleton className="h-28" /><Skeleton className="h-40" /></div>}
        {q.isError && <Alert tone="danger">Could not load your documents. Try again.</Alert>}
        {c && (
          <div className="space-y-5">
            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{c.complete ? 'All required documents sent' : `${c.requiredDone} of ${c.required} required documents sent`}</h2>
                {c.organization && ORG_BADGE[c.organization.verificationStatus]}
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Required documents sent"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
              <p className="mt-3 text-sm text-muted">
                We read each file and compare it with what you typed, so mistakes show up at once. <strong>That comparison cannot tell whether a document is genuine</strong>: an administrator looks at every document.
                {c.organization && ' Your organization gets the Verified badge when an administrator has approved all the required documents.'}
              </p>
              {!c.enforced && <p className="mt-2 text-xs text-muted">Documents are not being enforced on this site yet, but sending them builds trust.</p>}
            </Card>

            {!isEmployer && <TrustCard />}

            {isEmployer ? <EmployerDetails checklist={c} /> : <WorkerDetails />}

            <section aria-labelledby="docs-h">
              <h2 id="docs-h" className="mb-3 text-lg font-bold">2. Upload your documents</h2>
              <ul className="space-y-3">{c.items.map((i) => <ItemCard key={i.id} item={i} />)}</ul>
            </section>

            <Card className="p-5 text-sm text-muted">
              <p>Files can be PDF, JPG or PNG up to 5 MB. Photograph the whole page in good light. Only you and the administrators can open your files, and employers never see them. You can withdraw a document while it is waiting for review.</p>
              <div className="mt-3"><LinkButton to={isEmployer ? '/organization' : '/profile'} variant="outline" size="sm">{isEmployer ? 'Back to my organization' : 'Back to my profile'}</LinkButton></div>
            </Card>
          </div>
        )}
      </PageBody>
    </>
  );
}
