import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../shared/api';
import type { Settings } from '../shared/types';

export type BookReaderPreferences = Settings & {
  revision: number;
  zoom: number;
  fit_mode: 'width' | 'page';
};
type Changes = Partial<BookReaderPreferences>;
const bookFields = new Set([
  'reader_mode',
  'brightness',
  'contrast',
  'night_mode',
  'animation_speed',
  'zoom',
  'fit_mode',
]);
const globalFields = new Set(['sound_enabled', 'page_sound', 'ui_sound', 'volume']);

export function useBookSettings(bookId: string, defaults: Settings) {
  const [preferences, setPreferences] = useState<BookReaderPreferences>({
    ...defaults,
    revision: 0,
    zoom: 1,
    fit_mode: 'width',
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState<BookReaderPreferences | null>(null);
  const revision = useRef(0);
  const loadGeneration = useRef(0);
  const loaded = useRef(false);
  const mounted = useRef(true);
  const saving = useRef(false);
  const blocked = useRef(false);
  const pendingBook = useRef<Changes>({});
  const pendingGlobal = useRef<Changes>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const invalidateLoads = useCallback(() => {
    loadGeneration.current++;
  }, []);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const server = await api<BookReaderPreferences>(`/books/${bookId}/reader-settings/`);
      if (generation !== loadGeneration.current || !mounted.current) return;
      revision.current = server.revision;
      loaded.current = true;
      if (mounted.current) {
        setPreferences({ ...server, ...pendingBook.current, ...pendingGlobal.current });
        setReady(true);
        setError(false);
      }
    } catch {
      if (mounted.current && generation === loadGeneration.current) setError(true);
    }
  }, [bookId]);

  const flush = useCallback(
    async function flushSettings(): Promise<void> {
      clearTimeout(timer.current);
      if (!loaded.current || saving.current || blocked.current) return;
      const book = { ...pendingBook.current },
        global = { ...pendingGlobal.current };
      if (!Object.keys(book).length && !Object.keys(global).length) return;
      saving.current = true;
      let succeeded = false;
      try {
        if (Object.keys(book).length) {
          const server = await api<BookReaderPreferences>(`/books/${bookId}/reader-settings/`, {
            method: 'PATCH',
            body: JSON.stringify({ ...book, revision: revision.current }),
          });
          revision.current = server.revision;
          for (const key of Object.keys(book) as (keyof Changes)[])
            if (pendingBook.current[key] === book[key]) delete pendingBook.current[key];
        }
        if (Object.keys(global).length) {
          await api('/settings/', { method: 'PATCH', body: JSON.stringify(global) });
          for (const key of Object.keys(global) as (keyof Changes)[])
            if (pendingGlobal.current[key] === global[key]) delete pendingGlobal.current[key];
        }
        succeeded = true;
        if (mounted.current) setError(false);
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 409) {
          const current = reason.details.current as BookReaderPreferences | undefined;
          if (current) {
            blocked.current = true;
            if (mounted.current) setConflict(current);
          }
        }
        if (mounted.current) setError(true);
      } finally {
        saving.current = false;
        if (
          succeeded &&
          !mounted.current &&
          (Object.keys(pendingBook.current).length || Object.keys(pendingGlobal.current).length)
        )
          void flushSettings();
      }
    },
    [bookId],
  );

  const change = useCallback(
    (changes: Changes) => {
      setPreferences((previous) => ({ ...previous, ...changes }));
      for (const key of Object.keys(changes) as (keyof Changes)[]) {
        if (bookFields.has(key)) Object.assign(pendingBook.current, { [key]: changes[key] });
        else if (globalFields.has(key))
          Object.assign(pendingGlobal.current, { [key]: changes[key] });
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, 650);
    },
    [flush],
  );

  useEffect(() => {
    mounted.current = true;
    void load();
    const online = () => {
      if (!loaded.current) void load();
      else void flush();
    };
    window.addEventListener('online', online);
    return () => {
      mounted.current = false;
      invalidateLoads();
      window.removeEventListener('online', online);
      clearTimeout(timer.current);
      void flush();
    };
  }, [load, flush, invalidateLoads]);

  async function resolveConflict(choice: 'server' | 'local') {
    if (!conflict) return;
    revision.current = conflict.revision;
    blocked.current = false;
    setConflict(null);
    if (choice === 'server') {
      pendingBook.current = {};
      setPreferences({ ...conflict, ...pendingGlobal.current });
      setError(false);
    }
    await flush();
  }

  return { preferences, ready, error, conflict, change, flush, load, resolveConflict };
}
