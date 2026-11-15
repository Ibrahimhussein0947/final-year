import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setAccessToken } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends the bearer token and JSON body', async () => {
    setAccessToken('tok');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await api('/things', { method: 'POST', body: { a: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/things');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it('turns an error response into an ApiError with the server message and field details', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'VALIDATION', message: 'Bad input', details: { phone: ['Invalid phone'] } } }));
    await expect(api('/x')).rejects.toMatchObject({ status: 400, code: 'VALIDATION', message: 'Bad input', details: { phone: ['Invalid phone'] } });
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('on 401 refreshes once and retries; parallel 401s share ONE refresh (tokens rotate)', async () => {
    setAccessToken('old');
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (url === '/api/v1/auth/refresh') {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 'new', user: {} });
      }
      return init.headers.Authorization === 'Bearer new' ? json(200, { n: 1 }) : json(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } });
    });
    const results = await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it('gives up cleanly when the refresh fails (signed out), without looping', async () => {
    setAccessToken('old');
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/v1/auth/refresh' ? json(401, { error: { code: 'UNAUTHORIZED', message: 'no session' } }) : json(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } }),
    );
    await expect(api('/a')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/v1/auth/refresh')).toHaveLength(1);
  });
});
