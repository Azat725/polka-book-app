import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiError,
  setSession,
  clearSession,
  getAccessToken,
  authenticate,
  authenticatedFetch,
} from './api';

describe('private API', () => {
  beforeEach(() => {
    clearSession();
    delete window.Telegram;
    vi.restoreAllMocks();
  });
  it('sends the bearer token only to the application API', async () => {
    setSession('private', 'refresh');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
      );
    expect(await api('/books/')).toEqual({ ok: true });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer private',
    );
    await expect(api('https://outside.example/books/')).rejects.toThrow();
  });
  it('preserves structured conflict information', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'conflict', message: 'Conflict', details: { current: { revision: 2 } } },
        }),
        { status: 409 },
      ),
    );
    try {
      await api('/books/');
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).details).toEqual({ current: { revision: 2 } });
    }
  });
  it('clears credentials when refresh fails', async () => {
    setSession('expired', 'revoked');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(api('/me/')).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBe('');
  });
  it('authenticates with raw Telegram initData and keeps credentials out of localStorage', async () => {
    window.Telegram = { WebApp: { initData: 'signed-init-data', ready() {}, expand() {} } };
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'verified-user' } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    expect((await authenticate()).user.id).toBe('verified-user');
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
      init_data: 'signed-init-data',
    });
    expect(getAccessToken()).toBe('access');
    expect(write).not.toHaveBeenCalled();
  });
  it('requires Telegram rather than manufacturing a local user', async () => {
    await expect(authenticate()).rejects.toMatchObject({ status: 401, code: 'telegram_required' });
  });
  it('coalesces simultaneous refreshes and preserves authenticated byte-range responses', async () => {
    setSession('expired', 'refresh');
    let attempts = 0;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/auth/refresh/'))
        return new Response(JSON.stringify({ access_token: 'renewed', refresh_token: 'rotated' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      if (++attempts <= 2) return new Response('{}', { status: 401 });
      return new Response('%PDF', {
        status: 206,
        headers: { 'Content-Type': 'application/pdf', 'Content-Range': 'bytes 0-3/100' },
      });
    });
    const responses = await Promise.all([
      authenticatedFetch('/books/id/file/', { headers: { Range: 'bytes=0-3' } }),
      authenticatedFetch('/books/id/file/', { headers: { Range: 'bytes=0-3' } }),
    ]);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh/'))).toHaveLength(
      1,
    );
    expect(responses.every((response) => response.status === 206)).toBe(true);
    expect(await responses[0].text()).toBe('%PDF');
    const lastHeaders = new Headers(fetch.mock.calls.at(-1)?.[1]?.headers);
    expect(lastHeaders.get('Range')).toBe('bytes=0-3');
    expect(lastHeaders.get('Authorization')).toBe('Bearer renewed');
  });
  it('restores the rotating refresh only from supported secure storage', async () => {
    const remove = vi.fn();
    window.Telegram = {
      WebApp: {
        initData: '',
        ready() {},
        expand() {},
        SecureStorage: {
          getItem: (_key, callback) => callback(null, 'secure-refresh'),
          setItem: vi.fn(),
          removeItem: remove,
        },
      },
    };
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'restored', refresh_token: 'rotated' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'secure-user' } }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    expect((await authenticate()).user.id).toBe('secure-user');
    expect(String(fetch.mock.calls[0][0])).toContain('/auth/refresh/');
    clearSession();
    expect(remove).toHaveBeenCalled();
  });
});
