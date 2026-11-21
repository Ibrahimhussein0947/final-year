import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Trust } from '@/lib/trust';

export interface ServiceItem {
  id: string;
  title: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'REMOVED';
  category: { id: string; slug: string; name: string };
  serviceMode: 'AT_CUSTOMER' | 'AT_PROVIDER' | 'REMOTE';
  payBasis: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  toolsIncluded: boolean;
  availability: string | null;
  areaPath: { id: string; level: string; name: string }[];
  skills: string[];
  publishedAt: string | null;
  provider: { name: string; photoUrl: string | null; trust: Trust | null };
  /** Only on "tell us what you need" results: how many of the understood skills this listing offers. */
  matchedSkills?: number;
  /** Only on the provider's own list: inquiries waiting for an answer. */
  waitingInquiries?: number;
}

export interface ServiceDetail extends ServiceItem {
  description: string;
  allSkills: { skillId: string; name: string }[];
  isOwner: boolean;
  categoryId?: string;
  locationId?: string | null;
}

export interface ServiceSearch { items: ServiceItem[]; total: number; page: number; pageSize: number }

export interface Understood { category: { id: string; name: string } | null; skills: { skillId: string; name: string }[] }

export interface ServiceInquiry {
  id: string;
  status: 'SENT' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  message: string;
  preferredDate: string | null;
  createdAt: string;
  respondedAt: string | null;
  conversationId: string | null;
  service: { id: string; title: string; available: boolean };
  /** The other person. The phone number is there only after the provider accepted. */
  with: { name: string; phone: string | null };
}

export const SERVICE_MODE_LABEL: Record<string, string> = {
  AT_CUSTOMER: 'Comes to you',
  AT_PROVIDER: 'At the provider’s place',
  REMOTE: 'Remote',
};

export const SERVICE_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ACTIVE: { label: 'Live', tone: 'success' },
  PAUSED: { label: 'Paused', tone: 'warning' },
};

export const INQUIRY_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  SENT: { label: 'Waiting', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const useServiceSearch = (qs: string) =>
  useQuery({ queryKey: ['services', qs], queryFn: () => api<ServiceSearch>(`/services?${qs}`) });

export const useService = (id: string | undefined) =>
  useQuery({ queryKey: ['service', id], enabled: !!id, queryFn: async () => (await api<{ listing: ServiceDetail }>(`/services/${id}`)).listing });

export const useMyServices = () =>
  useQuery({ queryKey: ['my-services'], queryFn: async () => (await api<{ items: ServiceItem[] }>('/services/mine')).items });

export const useReceivedInquiries = (enabled: boolean) =>
  useQuery({ queryKey: ['service-inquiries', 'received'], enabled, queryFn: async () => (await api<{ items: ServiceInquiry[] }>('/services/inquiries/received')).items });

export const useSentInquiries = () =>
  useQuery({ queryKey: ['service-inquiries', 'sent'], queryFn: async () => (await api<{ items: ServiceInquiry[] }>('/services/inquiries/sent')).items });

export const askForService = (text: string) =>
  api<{ understood: Understood; items: ServiceItem[] }>('/services/ask', { method: 'POST', body: { text } });
