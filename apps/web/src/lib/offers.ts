import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type OfferStatus = 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED' | 'STARTED';

export interface Offer {
  id: string; applicationId: string; status: OfferStatus; salary: number | null; currency: string;
  startDate: string; respondBy: string; note: string | null; respondedAt: string | null; startedAt: string | null; createdAt: string;
  /** Days until the start date; negative once it has passed. */
  startsInDays: number;
  job: { id: string; title: string }; organization: string;
}

export const OFFER_LABEL: Record<OfferStatus, { label: string; tone: 'info' | 'success' | 'neutral' | 'warning' | 'danger' }> = {
  OFFERED: { label: 'Waiting for an answer', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  STARTED: { label: 'Started', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
  WITHDRAWN: { label: 'Taken back', tone: 'neutral' },
  EXPIRED: { label: 'Ran out', tone: 'neutral' },
};

export const useMyOffers = (enabled = true) =>
  useQuery({ queryKey: ['offers-mine'], enabled, queryFn: async () => (await api<{ items: Offer[] }>('/offers/mine')).items });
export const useSentOffers = (enabled = true) =>
  useQuery({ queryKey: ['offers-sent'], enabled, queryFn: async () => (await api<{ items: Offer[] }>('/offers/sent')).items });

export const startText = (o: Pick<Offer, 'startsInDays' | 'startDate'>) =>
  o.startsInDays > 1 ? `Starts in ${o.startsInDays} days (${o.startDate})` : o.startsInDays === 1 ? `Starts tomorrow (${o.startDate})` : o.startsInDays === 0 ? 'Starts today' : `Start date was ${o.startDate}`;
