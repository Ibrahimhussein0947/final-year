import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Handshake } from 'lucide-react';
import { Alert, Badge, Card, TextField } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { OFFER_LABEL, startText, useMyOffers, useSentOffers, type Offer } from '@/lib/offers';

const money = (o: Offer) => (o.salary ? `${o.salary.toLocaleString('en-US')} ${o.currency} a month` : 'Pay as advertised');
const errText = (e: unknown) => (e instanceof ApiError ? (Object.values(e.details ?? {}).flat()[0] as string | undefined) ?? e.message : 'Could not reach the server. Try again.');

function useOfferAction(path: (o: Offer) => string, body?: (o: Offer) => unknown) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (o: Offer) => api(path(o), { method: 'POST', ...(body ? { body: body(o) } : {}) }),
    onSuccess: async () => { setError(null); await Promise.all(['offers-mine', 'offers-sent', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] }))); },
    onError: (e) => setError(errText(e)),
  });
  return { ...m, error };
}

/** A worker's job offers: read the terms, accept or decline, then confirm the first day. */
export function WorkerOffers() {
  const q = useMyOffers();
  const accept = useOfferAction((o) => `/offers/${o.id}/respond`, () => ({ accept: true }));
  const decline = useOfferAction((o) => `/offers/${o.id}/respond`, () => ({ accept: false }));
  const started = useOfferAction((o) => `/offers/${o.id}/started`);
  const items = (q.data ?? []).filter((o) => o.status !== 'DECLINED' && o.status !== 'WITHDRAWN');
  if (!items.length) return null;
  const error = accept.error ?? decline.error ?? started.error;
  return (
    <section aria-labelledby="offers-h" className="mb-6">
      <h2 id="offers-h" className="mb-3 flex items-center gap-2 text-lg font-bold"><Handshake className="h-5 w-5 text-accent" aria-hidden /> Job offers</h2>
      {error && <div className="mb-3"><Alert tone="danger">{error}</Alert></div>}
      <ul className="space-y-3">
        {items.map((o) => {
          const s = OFFER_LABEL[o.status];
          return (
            <li key={o.id}>
              <Card className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold">{o.job.title}</p>
                    <p className="text-sm text-muted">{o.organization}</p>
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted">Pay</dt><dd className="font-medium">{money(o)}</dd></div>
                  <div><dt className="text-muted">First day</dt><dd className="font-medium">{o.startDate}</dd></div>
                  {o.status === 'OFFERED' && <div><dt className="text-muted">Answer by</dt><dd className="font-medium">{o.respondBy}</dd></div>}
                </dl>
                {o.note && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm"><span className="font-medium">From the employer:</span> {o.note}</p>}
                {o.status === 'OFFERED' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="accent" size="sm" loading={accept.isPending} onClick={() => accept.mutate(o)}>Accept the offer</Button>
                    <Button variant="outline" size="sm" loading={decline.isPending} onClick={() => { if (window.confirm('Decline this offer?')) decline.mutate(o); }}>Decline</Button>
                  </div>
                )}
                {o.status === 'ACCEPTED' && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-medium"><CalendarCheck className="h-4 w-4" aria-hidden /> {startText(o)}</span>
                    {o.startsInDays <= 0 && <Button variant="accent" size="sm" loading={started.isPending} onClick={() => started.mutate(o)}>I started work</Button>}
                  </div>
                )}
                {o.status === 'STARTED' && <p className="mt-3 text-sm text-success">You started on {o.startedAt ? new Date(o.startedAt).toLocaleDateString('en-GB') : o.startDate}. Good luck!</p>}
                {o.status === 'EXPIRED' && <p className="mt-3 text-sm text-muted">This offer ran out before it was answered. You can ask the employer to send it again.</p>}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** On an accepted candidate: write the terms, see the answer, take it back, confirm the first day. */
export function EmployerOffer({ applicationId, accepted }: { applicationId: string; accepted: boolean }) {
  const qc = useQueryClient();
  const sent = useSentOffers();
  const offer = sent.data?.find((o) => o.applicationId === applicationId);
  const [f, setF] = useState({ startDate: inDays(7), salary: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => Promise.all(['offers-sent', 'offers-mine'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const send = useMutation({
    mutationFn: () => api(`/applications/${applicationId}/offer`, { method: 'POST', body: { startDate: f.startDate, ...(f.salary ? { salary: Number(f.salary) } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}) } }),
    onSuccess: () => { setError(null); void refresh(); },
    onError: (e) => setError(errText(e)),
  });
  const withdraw = useOfferAction((o) => `/offers/${o.id}/withdraw`);
  const started = useOfferAction((o) => `/offers/${o.id}/started`);

  if (!accepted && !offer) return null;
  const live = offer && ['OFFERED', 'ACCEPTED', 'STARTED'].includes(offer.status);
  const s = offer ? OFFER_LABEL[offer.status] : null;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Handshake className="h-4 w-4" aria-hidden /> Job offer</h3>
        {s && <Badge tone={s.tone}>{s.label}</Badge>}
      </div>
      {offer && live && (
        <div className="mt-3 text-sm">
          <p>{money(offer)} · first day {offer.startDate}{offer.status === 'OFFERED' ? ` · answer by ${offer.respondBy}` : ''}</p>
          {offer.status === 'ACCEPTED' && <p className="mt-1 font-medium">The candidate accepted. {startText(offer)}.</p>}
          {offer.status === 'STARTED' && <p className="mt-1 font-medium text-success">Started work.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {offer.status === 'ACCEPTED' && offer.startsInDays <= 0 && <Button size="sm" variant="accent" loading={started.isPending} onClick={() => started.mutate(offer)}>Confirm they started</Button>}
            {offer.status !== 'STARTED' && <Button size="sm" variant="outline" loading={withdraw.isPending} onClick={() => { if (window.confirm('Take this offer back? The candidate will be told.')) withdraw.mutate(offer); }}>Take the offer back</Button>}
          </div>
        </div>
      )}
      {(!offer || !live) && accepted && (
        <form noValidate className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          {offer && <p className="text-sm text-muted sm:col-span-2">The last offer {offer.status === 'DECLINED' ? 'was declined' : offer.status === 'EXPIRED' ? 'ran out' : 'was taken back'}. You can send a new one.</p>}
          <TextField label="First day of work" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          <TextField label="Pay per month, in birr (optional)" inputMode="numeric" value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value.replace(/\D/g, '') })} />
          <div className="sm:col-span-2"><TextField label="Note for the candidate (optional)" placeholder="Where to go, what to bring" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <div className="sm:col-span-2"><Button type="submit" variant="accent" size="sm" loading={send.isPending}>Send the offer</Button></div>
        </form>
      )}
      {!accepted && offer && !live && <p className="mt-3 text-sm text-muted">No offer is open.</p>}
      {(error ?? withdraw.error ?? started.error) && <div className="mt-3"><Alert tone="danger">{error ?? withdraw.error ?? started.error}</Alert></div>}
    </Card>
  );
}
