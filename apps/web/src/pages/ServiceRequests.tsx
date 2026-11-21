import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Phone } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { PageBody, PageHeader } from '@/pages/PageHeader';
import { useAuth } from '@/app/auth';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { INQUIRY_STATUS, useReceivedInquiries, useSentInquiries, type ServiceInquiry } from '@/lib/services';

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the server');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' });

function Contact({ i }: { i: ServiceInquiry }) {
  if (i.status !== 'ACCEPTED') return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {i.with.phone && <span className="inline-flex items-center gap-1"><Phone className="h-4 w-4" aria-hidden /><a className="font-medium text-accent hover:underline" href={`tel:${i.with.phone}`}>{i.with.phone}</a></span>}
      {i.conversationId && <Link to={`/messages/${i.conversationId}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline"><MessageSquare className="h-4 w-4" aria-hidden />Open chat</Link>}
    </p>
  );
}

function Received({ i, onError }: { i: ServiceInquiry; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const respond = useMutation({
    mutationFn: (v: { accept: boolean; block?: boolean }) => api(`/services/inquiries/${i.id}/respond`, { method: 'POST', body: v }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['service-inquiries'] }), qc.invalidateQueries({ queryKey: ['my-services'] }), qc.invalidateQueries({ queryKey: ['conversations'] })]),
    onError: (e) => onError(messageOf(e)),
  });
  const st = INQUIRY_STATUS[i.status];
  return (
    <li>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-semibold">{i.with.name}</p><p className="text-sm text-muted">asks about <Link to={`/services/${i.service.id}`} className="hover:text-accent">{i.service.title}</Link> · {timeAgo(i.createdAt)}</p></div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <p className="mt-3 whitespace-pre-line rounded-xl bg-surface-2 p-3 text-sm">{i.message}</p>
        {i.preferredDate && <p className="mt-2 text-sm text-muted">Preferred day: {day(i.preferredDate)}</p>}
        <Contact i={i} />
        {i.status === 'SENT' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="accent" loading={respond.isPending} onClick={() => respond.mutate({ accept: true })}>Accept and open chat</Button>
            <Button size="sm" variant="outline" disabled={respond.isPending} onClick={() => respond.mutate({ accept: false })}>Decline</Button>
            <Button size="sm" variant="ghost" disabled={respond.isPending} onClick={() => { if (window.confirm('Decline and stop this person from sending you more requests?')) respond.mutate({ accept: false, block: true }); }}>Decline and block</Button>
          </div>
        )}
        {i.status === 'SENT' && <p className="mt-2 text-xs text-muted">Your phone number is shared only if you accept.</p>}
      </Card>
    </li>
  );
}

function Sent({ i, onError }: { i: ServiceInquiry; onError: (m: string) => void }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api(`/services/inquiries/${i.id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-inquiries'] }),
    onError: (e) => onError(messageOf(e)),
  });
  const st = INQUIRY_STATUS[i.status];
  return (
    <li>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-semibold">{i.with.name}</p><p className="text-sm text-muted">{i.service.available ? <Link to={`/services/${i.service.id}`} className="hover:text-accent">{i.service.title}</Link> : `${i.service.title} (no longer available)`} · {timeAgo(i.createdAt)}</p></div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <p className="mt-3 whitespace-pre-line rounded-xl bg-surface-2 p-3 text-sm">{i.message}</p>
        <Contact i={i} />
        {i.status === 'SENT' && <div className="mt-4"><Button size="sm" variant="outline" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel request</Button></div>}
        {i.status === 'DECLINED' && <p className="mt-3 text-sm text-muted">The provider is not able to help this time. You can look for another provider.</p>}
      </Card>
    </li>
  );
}

export default function ServiceRequestsPage() {
  const { user } = useAuth();
  const isWorker = user?.role === 'WORKER';
  const received = useReceivedInquiries(isWorker);
  const sent = useSentInquiries();
  const [error, setError] = useState<string | null>(null);
  const waiting = received.data?.filter((i) => i.status === 'SENT').length ?? 0;

  return (
    <>
      <PageHeader title="Service requests" subtitle="Requests you received for your services, and requests you sent to providers." />
      <PageBody narrow>
        {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
        {isWorker && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-bold">Requests for your services {waiting > 0 && <Badge tone="accent">{waiting} waiting</Badge>}</h2>
            {received.isLoading && <Skeleton className="h-32" />}
            {received.data?.length === 0 && <EmptyState icon={MessageSquare} title="No requests yet" body="When a customer asks about one of your live services, it appears here." />}
            <ul className="space-y-4">{received.data?.map((i) => <Received key={i.id} i={i} onError={setError} />)}</ul>
          </section>
        )}
        <section>
          <h2 className="mb-3 text-lg font-bold">Requests you sent</h2>
          {sent.isLoading && <Skeleton className="h-32" />}
          {sent.data?.length === 0 && <EmptyState icon={MessageSquare} title="You have not asked any provider yet" body="Find a plumber, tailor, electrician or other provider and send a request." action={<Link to="/services" className="text-sm font-medium text-accent hover:underline">Find a service</Link>} />}
          <ul className="space-y-4">{sent.data?.map((i) => <Sent key={i.id} i={i} onError={setError} />)}</ul>
        </section>
      </PageBody>
    </>
  );
}
