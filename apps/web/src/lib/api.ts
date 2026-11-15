export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

const BASE = '/api/v1';
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;

export interface SessionUser {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: 'WORKER' | 'EMPLOYER' | 'ADMIN' | 'TRAINER';
  locale: 'en' | 'am' | 'om';
  phoneVerified: boolean;
  emailVerified: boolean;
  mustChangePassword?: boolean;
  twoFactorEnabled?: boolean;
  workerProfile?: { id: string; completionPct: number } | null;
  organization?: { id: string; name: string; type: string; verificationStatus: string } | null;
}

async function parse(res: Response) {
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Request failed', e?.details);
  }
  return data;
}

// One refresh at a time: refresh tokens rotate, so two parallel refreshes would look like token theft.
let refreshing: Promise<{ user: SessionUser; accessToken: string }> | null = null;
export function refreshSession() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Protection': '1' },
  })
    .then(parse)
    .then((d) => {
      setAccessToken(d.accessToken);
      return d;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Fetch a protected file (needs the bearer token, so it cannot be a plain <img src>) as an object URL. */
export async function fetchBlobUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Could not load file');
  return URL.createObjectURL(await res.blob());
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const send = () =>
    fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: {
        // For FormData the browser sets the multipart boundary itself.
        ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: init.body ? (isForm ? (init.body as FormData) : JSON.stringify(init.body)) : undefined,
    });

  let res = await send();
  if (res.status === 401 && accessToken && !path.startsWith('/auth/')) {
    try {
      await refreshSession();
      res = await send();
    } catch {
      setAccessToken(null);
    }
  }
  return parse(res) as Promise<T>;
}
