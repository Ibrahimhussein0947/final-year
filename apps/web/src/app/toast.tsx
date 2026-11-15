import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';

interface Toast { id: number; title: string; body?: string; to?: string }
interface ToastApi { push: (t: Omit<Toast, 'id'>) => void }

const ToastContext = createContext<ToastApi | null>(null);

/** Small pop-ups for live events. They announce themselves politely to screen readers and disappear after 6 seconds. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const navigate = useNavigate();

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = next.current++;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), 6000);
  }, [dismiss]);

  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-surface p-3 shadow-card">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => { if (t.to) navigate(t.to); dismiss(t.id); }}
            >
              <span className="block text-sm font-medium">{t.title}</span>
              {t.body && <span className="block truncate text-xs text-muted">{t.body}</span>}
            </button>
            <button type="button" aria-label="Dismiss" className="rounded p-1 text-muted hover:bg-surface-2" onClick={() => dismiss(t.id)}><X className="h-4 w-4" aria-hidden /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
