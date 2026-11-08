import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../shared/api';
import { defaultSettings } from '../shared/types';
import { useBookSettings } from './useBookSettings';

vi.mock('../shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api')>()),
  api: vi.fn(),
}));
const initial = { ...defaultSettings, zoom: 1.4, fit_mode: 'width' as const, revision: 3 };
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue(initial);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('per-book reading settings', () => {
  it('loads that book’s zoom and appearance separately from global defaults', async () => {
    const { result } = renderHook(() => useBookSettings('book', defaultSettings));
    await settle();
    expect(api).toHaveBeenCalledWith('/books/book/reader-settings/');
    expect(result.current.preferences.zoom).toBe(1.4);
    expect(result.current.ready).toBe(true);
  });
  it('saves book appearance with its revision without changing global settings', async () => {
    const { result } = renderHook(() => useBookSettings('book', defaultSettings));
    await settle();
    act(() => result.current.change({ brightness: 0.7, zoom: 1.8 }));
    vi.mocked(api).mockResolvedValue({ ...initial, brightness: 0.7, zoom: 1.8, revision: 4 });
    await act(async () => {
      await result.current.flush();
    });
    expect(api).toHaveBeenLastCalledWith(
      '/books/book/reader-settings/',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ brightness: 0.7, zoom: 1.8, revision: 3 }),
      }),
    );
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/settings/')).toBe(false);
  });
  it('keeps sound preferences global rather than putting them into book overrides', async () => {
    const { result } = renderHook(() => useBookSettings('book', defaultSettings));
    await settle();
    act(() => result.current.change({ sound_enabled: true, page_sound: true }));
    await act(async () => {
      await result.current.flush();
    });
    expect(api).toHaveBeenLastCalledWith(
      '/settings/',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ sound_enabled: true, page_sound: true }),
      }),
    );
  });
  it('requires an explicit choice when another device changes book settings', async () => {
    const server = { ...initial, brightness: 1.2, revision: 5 };
    const { result } = renderHook(() => useBookSettings('book', defaultSettings));
    await settle();
    act(() => result.current.change({ brightness: 0.7 }));
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(409, 'reader_settings_conflict', 'Conflict', { current: server }),
    );
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.conflict).toEqual(server);
    expect(result.current.preferences.brightness).toBe(0.7);
    await act(async () => {
      await result.current.resolveConflict('server');
    });
    expect(result.current.preferences.brightness).toBe(1.2);
  });
  it('can keep the local choice using the latest server revision', async () => {
    const { result } = renderHook(() => useBookSettings('book', defaultSettings));
    await settle();
    act(() => result.current.change({ brightness: 0.65 }));
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(409, 'reader_settings_conflict', 'Conflict', {
        current: { ...initial, revision: 9 },
      }),
    );
    await act(async () => {
      await result.current.flush();
    });
    vi.mocked(api).mockResolvedValue({ ...initial, brightness: 0.65, revision: 10 });
    await act(async () => {
      await result.current.resolveConflict('local');
    });
    expect(JSON.parse(vi.mocked(api).mock.calls.at(-1)![1]!.body as string)).toEqual({
      brightness: 0.65,
      revision: 9,
    });
  });
  it('retains local choices and reports a network failure instead of claiming they are saved', async () => {
    const { result } = renderHook(() => useBookSettings('book', defaultSettings));
    await settle();
    act(() => result.current.change({ contrast: 1.4 }));
    vi.mocked(api).mockRejectedValueOnce(new TypeError('Offline'));
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.error).toBe(true);
    expect(result.current.preferences.contrast).toBe(1.4);
  });
  it('does not apply an older load response after a newer reload finishes', async () => {
    let completeOld!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve;
        }),
    );
    const { result } = renderHook(() => useBookSettings('book', defaultSettings));
    vi.mocked(api).mockResolvedValue({ ...initial, zoom: 2, revision: 8 });
    await act(async () => {
      await result.current.load();
    });
    await act(async () => {
      completeOld({ ...initial, zoom: 1.1, revision: 2 });
      await Promise.resolve();
    });
    expect(result.current.preferences.zoom).toBe(2);
  });
});
