import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, refreshSession, setAccessToken, type SessionUser } from '@/lib/api';

interface AuthValue {
  user: SessionUser | null;
  /** True until the first session check finishes. */
  loading: boolean;
  login: (phone: string, password: string, totpCode?: string) => Promise<SessionUser>;
  register: (body: Record<string, unknown>) => Promise<SessionUser>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    refreshSession()
      .then((d) => active && setUser(d.user))
      .catch(() => active && setUser(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (phone: string, password: string, totpCode?: string) => {
    const d = await api<{ user: SessionUser; accessToken: string }>('/auth/login', { method: 'POST', body: { phone, password, ...(totpCode ? { totpCode } : {}) } });
    setAccessToken(d.accessToken);
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (body: Record<string, unknown>) => {
    const d = await api<{ user: SessionUser; accessToken: string }>('/auth/register', { method: 'POST', body });
    setAccessToken(d.accessToken);
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Protection': '1' } });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const reload = useCallback(async () => {
    const d = await api<{ user: SessionUser }>('/auth/me');
    setUser(d.user);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout, reload }), [user, loading, login, register, logout, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: SessionUser['role'][] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // A password someone else chose must be replaced before anything else.
  if (user.mustChangePassword && location.pathname !== '/account/security') return <Navigate to="/account/security" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
