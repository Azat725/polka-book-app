import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../shared/api';
import { loadProgress, queueProgress, removeProgress } from './storage';
import { useProgress } from './useProgress';

vi.mock('../shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api')>()),
  api: vi.fn(),
}));
vi.mock('./storage', () => ({
  loadProgress: vi.fn(),
  queueProgress: vi.fn(),
  removeProgress: vi.fn(),
}));
const initial = { page: 1, position: 0, revision: 2 };
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadProgress).mockResolvedValue(undefined);
  vi.mocked(queueProgress).mockResolvedValue('book');
  vi.mocked(removeProgress).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('durable reading progress', () => {
  it('persists the latest position before it attempts network synchronization', async () => {
    vi.mocked(api).mockResolvedValue({ page: 5, position: 0.25, revision: 3 });
    const { result } = renderHook(() => useProgress('book', initial, vi.fn()));
    await settle();
    act(() => result.current.update(5, 0.25));
    expect(queueProgress).toHaveBeenCalledWith(
      expect.objectContaining({ page: 5, position: 0.25, revision: 2 }),
    );
    await act(async () => {
      await result.current.flush();
    });
    expect(JSON.parse(vi.mocked(api).mock.calls[0][1]?.body as string)).toEqual(
      expect.objectContaining({
        page: 5,
        position: 0.25,
        revision: 2,
        client_mutation_id: expect.any(String),
      }),
    );
    expect(result.current.status).toBe('synced');
    expect(removeProgress).toHaveBeenCalledWith('book', expect.any(String));
  });

  it('retains an unsent mutation after a network failure and retries the same operation', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValue({ page: 4, position: 0.6, revision: 3 });
    const { result } = renderHook(() => useProgress('book', initial, vi.fn()));
    await settle();
    act(() => result.current.update(4, 0.6));
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe('offline');
    expect(removeProgress).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.flush();
    });
    expect(vi.mocked(api).mock.calls[0][1]?.body).toBe(vi.mocked(api).mock.calls[1][1]?.body);
    expect(result.current.status).toBe('synced');
  });

  it('does not discard an update made while an earlier request is in flight', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useProgress('book', initial, vi.fn()));
    await settle();
    act(() => result.current.update(4, 0.2));
    let request!: Promise<void>;
    act(() => {
      request = result.current.flush();
    });
    act(() => result.current.update(6, 0.4));
    await act(async () => {
      resolve({ page: 4, position: 0.2, revision: 3 });
      await request;
    });
    expect(result.current.status).toBe('offline');
    vi.mocked(api).mockResolvedValue({ page: 6, position: 0.4, revision: 4 });
    await act(async () => {
      await result.current.flush();
    });
    expect(JSON.parse(vi.mocked(api).mock.calls[1][1]?.body as string)).toEqual(
      expect.objectContaining({ page: 6, position: 0.4, revision: 3 }),
    );
  });

  it('keeps both positions when devices conflict and can resume the server position', async () => {
    const server = { page: 9, position: 0.8, revision: 5 };
    vi.mocked(api).mockRejectedValue(
      new ApiError(409, 'progress_conflict', 'Conflict', { current: server }),
    );
    const restore = vi.fn();
    const { result } = renderHook(() => useProgress('book', initial, restore));
    await settle();
    act(() => result.current.update(3, 0.4));
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.conflict).toEqual(server);
    await act(async () => {
      await result.current.flush();
    });
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.resolveConflict('server');
    });
    expect(restore).toHaveBeenCalledWith(server);
    expect(result.current.conflict).toBeNull();
    expect(result.current.status).toBe('synced');
  });

  it('allows an explicit local choice without replacing it by the maximum page', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(
        new ApiError(409, 'progress_conflict', 'Conflict', {
          current: { page: 50, position: 0, revision: 9 },
        }),
      )
      .mockResolvedValue({ page: 2, position: 0.3, revision: 10 });
    const { result } = renderHook(() => useProgress('book', initial, vi.fn()));
    await settle();
    act(() => result.current.update(2, 0.3));
    await act(async () => {
      await result.current.flush();
    });
    await act(async () => {
      await result.current.resolveConflict('local');
    });
    expect(JSON.parse(vi.mocked(api).mock.calls[1][1]?.body as string)).toEqual(
      expect.objectContaining({ page: 2, position: 0.3, revision: 9 }),
    );
  });

  it('restores and sends an operation left in IndexedDB by a closed WebView', async () => {
    const queued = {
      bookId: 'book',
      page: 7,
      position: 0.42,
      revision: 2,
      client_mutation_id: 'durable-mutation',
      updatedAt: 1,
    };
    vi.mocked(loadProgress).mockResolvedValue(queued);
    vi.mocked(api).mockResolvedValue({ page: 7, position: 0.42, revision: 3 });
    const restore = vi.fn();
    const { result } = renderHook(() => useProgress('book', initial, restore));
    await settle();
    expect(restore).toHaveBeenCalledWith(queued);
    expect(result.current.status).toBe('synced');
  });

  it('reports unavailable local storage rather than promising durable offline saving', async () => {
    vi.mocked(loadProgress).mockRejectedValue(new Error('Storage denied'));
    const { result } = renderHook(() => useProgress('book', initial, vi.fn()));
    await settle();
    expect(result.current.localAvailable).toBe(false);
  });

  it('does not create a new mutation for an unchanged position while the first is pending', async () => {
    vi.mocked(api).mockResolvedValue({ page: 4, position: 0.25, revision: 3 });
    const { result } = renderHook(() => useProgress('book', initial, vi.fn()));
    await settle();
    act(() => result.current.update(4, 0.25));
    act(() => result.current.update(4, 0.25));
    expect(queueProgress).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.flush();
    });
  });

  it('accepts an identical server position after a close/reopen race without asking the user to choose', async () => {
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(409, 'progress_conflict', 'Conflict', {
        current: { page: 4, position: 0.25, revision: 3 },
      }),
    );
    const { result } = renderHook(() => useProgress('book', initial, vi.fn()));
    await settle();
    act(() => result.current.update(4, 0.25));
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.conflict).toBeNull();
    expect(result.current.status).toBe('synced');
    expect(removeProgress).toHaveBeenCalled();
  });
});
