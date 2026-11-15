import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { notificationLink, notificationText, useNotifications } from '@/lib/applications';
import { useUnreadMessages } from '@/lib/messaging';
import { timeAgo } from '@/lib/format';
import { useAuth } from '@/app/auth';
import { cn } from '@/lib/cn';

const iconButton = 'relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2 pointer-coarse:h-10 pointer-coarse:w-10';

function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-on-accent">{n > 9 ? '9+' : n}</span>;
}

export function MessagesLink() {
  const { user } = useAuth();
  const q = useUnreadMessages(!!user);
  return (
    <Link to="/messages" className={iconButton} aria-label={`Messages${q.data ? `, ${q.data} unread` : ''}`}>
      <MessageSquare className="h-4 w-4" aria-hidden />
      <Count n={q.data ?? 0} />
    </Link>
  );
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useNotifications();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const unread = q.data?.unread ?? 0;

  return (
    <div className="relative" ref={box}>
      <button type="button" className={iconButton} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <Bell className="h-4 w-4" aria-hidden />
        <Count n={unread} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            {unread > 0 && <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => readAll.mutate()}>Mark all as read</button>}
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {q.isLoading && <li className="p-4 text-sm text-muted">Loading…</li>}
            {q.data?.items.length === 0 && <li className="p-4 text-sm text-muted">Nothing yet.</li>}
            {q.data?.items.slice(0, 10).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn('block w-full px-4 py-3 text-left hover:bg-surface-2', !n.readAt && 'bg-accent-soft/40')}
                  onClick={() => { if (!n.readAt) readOne.mutate(n.id); setOpen(false); navigate(notificationLink(n, user?.role)); }}
                >
                  <span className={cn('block text-sm', !n.readAt && 'font-medium')}>{notificationText(n)}</span>
                  <span className="text-xs text-muted">{timeAgo(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
