import { useQuery } from '@tanstack/react-query';
import { api, fetchBlobUrl } from '@/lib/api';

export interface CalendarInterview {
  id: string;
  applicationId: string;
  scheduledAt: string;
  endsAt: string;
  mode: 'IN_PERSON' | 'PHONE' | 'VIDEO';
  locationOrLink: string | null;
  /** For a video call: whether it can be joined now. The window is 15 minutes before to 2 hours after the start. */
  video: { platformRoom: boolean; opensAt: string; closesAt: string; canJoinNow: boolean } | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  job: { id: string; title: string };
  /** The organization for a worker, the candidate for an employer. */
  with: string;
}

export const MODE_LABEL: Record<CalendarInterview['mode'], string> = { IN_PERSON: 'In person', PHONE: 'Phone call', VIDEO: 'Video call' };

export const useInterviewConfig = () =>
  useQuery({ queryKey: ['interview-config'], staleTime: 300_000, queryFn: () => api<{ videoRooms: boolean; videoHost: string | null }>('/interviews/config') });

/** The link to a video call, when it is time to join. */
export async function joinLink(id: string): Promise<string> {
  return (await api<{ url: string }>(`/interviews/${id}/join`)).url;
}

export const useMyInterviews = (from: Date, to: Date) =>
  useQuery({
    queryKey: ['my-interviews', from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
    queryFn: async () => (await api<{ items: CalendarInterview[] }>(`/interviews/mine?from=${from.toISOString()}&to=${to.toISOString()}`)).items,
  });

/** Download the upcoming interviews as a calendar file (opens in Google Calendar, Outlook, phone calendars). */
export async function downloadIcs() {
  const url = await fetchBlobUrl('/api/v1/interviews/mine.ics');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-interviews.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
