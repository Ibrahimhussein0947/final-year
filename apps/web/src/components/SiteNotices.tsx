import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Megaphone, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/app/auth';

interface SiteStatus { maintenance: { message: string } | null; registrationOpen: boolean }
interface Notice { id: string; title: string; body: string }

const KEY = 'et_dismissed_notices';
const dismissed = (): string[] => {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[]; } catch { return []; }
};

/**
 * Banners from the administrators: the maintenance notice for everyone, and announcements for signed-in people.
 * An announcement can be closed for the rest of the visit; the maintenance notice cannot.
 */
export function SiteNotices() {
  const { user } = useAuth();
  const status = useQuery({ queryKey: ['site-status'], refetchInterval: 60_000, staleTime: 30_000, queryFn: () => api<SiteStatus>('/site/status') });
  const notices = useQuery({
    queryKey: ['announcements-active'], enabled: !!user, refetchInterval: 120_000, staleTime: 60_000,
    queryFn: async () => (await api<{ items: Notice[] }>('/announcements/active')).items,
  });
  const [hidden, setHidden] = useState<string[]>(dismissed);
  const close = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: it just reappears next time */ }
  };
  const visible = (notices.data ?? []).filter((n) => !hidden.includes(n.id));
  if (!status.data?.maintenance && visible.length === 0) return null;
  return (
    <div className="print:hidden" role="region" aria-label="Notices">
      {status.data?.maintenance && (
        <div role="alert" className="flex items-start gap-3 border-b border-warning/40 bg-warning-soft px-4 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p><span className="font-semibold">The platform is being maintained.</span> {status.data.maintenance.message || 'Some features may not work for a few minutes.'}</p>
        </div>
      )}
      {visible.map((n) => (
        <div key={n.id} role="status" className="flex items-start gap-3 border-b border-accent/30 bg-accent-soft px-4 py-2.5 text-sm">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <p className="flex-1"><span className="font-semibold">{n.title}.</span> {n.body}</p>
          <button type="button" aria-label={`Close notice: ${n.title}`} className="rounded p-1 text-muted hover:text-text" onClick={() => close(n.id)}><X className="h-4 w-4" aria-hidden /></button>
        </div>
      ))}
    </div>
  );
}
