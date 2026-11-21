import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Alert, Card, Skeleton, SelectField, TextAreaField, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { SaveStatus, SectionCard } from '@/pages/worker/sections';
import { api, ApiError } from '@/lib/api';
import { useLocations, type SaveState } from '@/lib/profile';
import { OrgTypeOptions } from '@/components/OrgTypeFields';
import { DocumentsSummary } from '@/components/DocumentsSummary';
import { HiringRulesNotice } from '@/components/HiringRulesNotice';
import { PlanCard } from '@/components/PlanCard';

interface OrgResponse {
  roleInOrg: string | null;
  organization: {
    id: string; name: string; type: string; description: string | null; website: string | null; address: string | null;
    verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
    locationPath: { id: string; level: string; name: string }[];
  };
  latestVerificationRequest: { status: string; note: string | null } | null;
}

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the organization name'),
  type: z.string().min(1),
  description: z.string().trim().max(2000),
  website: z.string().trim().refine((v) => v === '' || (/^https?:\/\//i.test(v) && URL.canParse(v)), 'Start with http:// or https://'),
  address: z.string().trim().max(250),
  roleInOrg: z.string().trim().max(80),
});
type Values = z.infer<typeof schema>;

const errMsg = (e: unknown) => (e instanceof ApiError ? Object.values(e.details ?? {})[0]?.[0] ?? e.message : 'Could not reach the server');

function useOrg() {
  return useQuery({ queryKey: ['org'], queryFn: () => api<OrgResponse>('/employers/me') });
}

function useOrgAction<T>(run: (a: T) => Promise<OrgResponse>) {
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const m = useMutation({
    mutationFn: run,
    onMutate: () => setState({ status: 'saving' }),
    onSuccess: (d) => { qc.setQueryData(['org'], d); setState({ status: 'saved' }); },
    onError: (e) => setState({ status: 'error', message: errMsg(e) }),
  });
  return { ...m, state };
}

function OrgForm({ data }: { data: OrgResponse }) {
  const o = data.organization;
  const save = useOrgAction((body: Record<string, unknown>) => api<OrgResponse>('/employers/me', { method: 'PATCH', body }));
  const [region, setRegion] = useState(o.locationPath[0]?.id ?? '');
  const [zone, setZone] = useState(o.locationPath[1]?.id ?? '');
  const regions = useLocations();
  const zones = useLocations(region || undefined);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: o.name, type: o.type, description: o.description ?? '', website: o.website ?? '', address: o.address ?? '', roleInOrg: data.roleInOrg ?? '' },
  });
  return (
    <SectionCard title="Organization profile" description="Workers see this before they apply. Your organization type decides which hiring rules apply; it is fixed once you are verified or have published a job.">
      <div className="mb-4"><HiringRulesNotice /></div>
      <div className="mb-4"><PlanCard /></div>
      <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate({ ...v, locationId: zone || region || null }))}>
        <TextField label="Organization name" error={errors.name?.message} {...register('name')} />
        <SelectField label="Organization type" {...register('type')}>
          <OrgTypeOptions keep={o.type} />
        </SelectField>
        <SelectField label="Region" value={region} onChange={(e) => { setRegion(e.target.value); setZone(''); }}>
          <option value="">–</option>
          {regions.data?.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
        </SelectField>
        <SelectField label="Zone or city" value={zone} onChange={(e) => setZone(e.target.value)} disabled={!zones.data?.length}>
          <option value="">–</option>
          {zones.data?.map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}
        </SelectField>
        <div className="sm:col-span-2"><TextField label="Business address" {...register('address')} /></div>
        <TextField label="Website (optional)" placeholder="https://" error={errors.website?.message} {...register('website')} />
        <TextField label="Your role in the organization" placeholder="e.g. HR manager" {...register('roleInOrg')} />
        <div className="sm:col-span-2"><TextAreaField label="About the organization" error={errors.description?.message} {...register('description')} /></div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="accent" loading={save.isPending}>Save</Button>
          <SaveStatus state={save.state} />
        </div>
      </form>
    </SectionCard>
  );
}

export default function OrganizationPage() {
  const q = useOrg();
  return (
    <>
      <PageHeader title="Your organization" subtitle="A clear, verified profile helps you attract better candidates." />
      <PageBody narrow>
        {q.isLoading && <div className="space-y-4" aria-busy="true"><Skeleton className="h-72" /><Skeleton className="h-40" /></div>}
        {q.isError && <Alert tone="danger">Could not load your organization. Please refresh the page.</Alert>}
        {q.data && (
          <div className="space-y-5">
            <Card className="p-5"><p className="text-sm text-muted">Signed in as the contact for</p><p className="text-lg font-bold">{q.data.organization.name}</p></Card>
            <OrgForm data={q.data} />
            <DocumentsSummary />
          </div>
        )}
      </PageBody>
    </>
  );
}
