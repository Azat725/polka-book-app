import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../shared/api';
import type { Progress } from '../shared/types';
import { loadProgress, queueProgress, removeProgress, type PendingProgress } from './storage';

export function useProgress(
  bookId: string,
  initial: Progress,
  restore: (progress: Progress) => void,
) {
  const [status, setStatus] = useState<'synced' | 'saving' | 'offline'>('synced');
  const [conflict, setConflict] = useState<Progress | null>(null);
  const [localAvailable, setLocalAvailable] = useState(true);
  const revision = useRef(initial.revision);
  const savedPosition = useRef(initial);
  const pending = useRef<PendingProgress | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const conflictRef = useRef(false);
  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  }, [restore]);

  const persist = useCallback((value: PendingProgress) => {
    void queueProgress({ ...value }).catch(() => {
      if (mounted.current) setLocalAvailable(false);
    });
  }, []);

  const flush = useCallback(async () => {
    if (saving.current || conflictRef.current || !pending.current) return;
    const value = { ...pending.current, revision: revision.current };
    saving.current = true;
    if (mounted.current) setStatus('saving');
    try {
      const saved = await api<Progress>(`/books/${bookId}/progress/`, {
        method: 'PUT',
        body: JSON.stringify(value),
      });
      revision.current = saved.revision;
      savedPosition.current = saved;
      if (pending.current?.client_mutation_id === value.client_mutation_id) pending.current = null;
      else if (pending.current) {
        pending.current.revision = saved.revision;
        persist(pending.current);
      }
      await removeProgress(bookId, value.client_mutation_id).catch(() => undefined);
      if (mounted.current) setStatus(pending.current ? 'offline' : 'synced');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const details = error.details as { current?: Progress } | undefined;
        let current = details?.current;
        if (!current)
          current = await api<Progress>(`/books/${bookId}/progress/`).catch(() => undefined);
        if (current) {
          if (
            current.page === value.page &&
            Math.abs(current.position - value.position) < 0.00001
          ) {
            revision.current = current.revision;
            savedPosition.current = current;
            if (pending.current?.client_mutation_id === value.client_mutation_id)
              pending.current = null;
            else if (pending.current) {
              pending.current.revision = current.revision;
              persist(pending.current);
            }
            await removeProgress(bookId, value.client_mutation_id).catch(() => undefined);
            if (mounted.current) setStatus(pending.current ? 'offline' : 'synced');
            return;
          }
          conflictRef.current = true;
          if (mounted.current) setConflict(current);
        }
      }
      if (mounted.current) setStatus('offline');
    } finally {
      saving.current = false;
    }
  }, [bookId, persist]);

  const update = useCallback(
    (page: number, position: number) => {
      const previous = pending.current ?? (revision.current > 0 ? savedPosition.current : null);
      if (previous?.page === page && Math.abs(previous.position - position) < 0.00001) return;
      const value: PendingProgress = {
        bookId,
        page,
        position,
        revision: revision.current,
        client_mutation_id: crypto.randomUUID(),
        updatedAt: Date.now(),
      };
      pending.current = value;
      persist(value);
      setStatus('offline');
    },
    [bookId, persist],
  );

  useEffect(() => {
    mounted.current = true;
    void loadProgress(bookId)
      .then((value) => {
        if (!value || !mounted.current || pending.current) return;
        pending.current = value;
        revision.current = value.revision;
        restoreRef.current(value);
        setStatus('offline');
        void flush();
      })
      .catch(() => {
        if (mounted.current) setLocalAvailable(false);
      });
    const timer = setInterval(() => {
      void flush();
    }, 3500);
    const saveOnHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const saveOnExit = () => {
      void flush();
    };
    window.addEventListener('online', saveOnExit);
    window.addEventListener('pagehide', saveOnExit);
    document.addEventListener('visibilitychange', saveOnHide);
    return () => {
      void flush();
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener('online', saveOnExit);
      window.removeEventListener('pagehide', saveOnExit);
      document.removeEventListener('visibilitychange', saveOnHide);
    };
  }, [bookId, flush]);

  async function resolveConflict(choice: 'server' | 'local') {
    if (!conflict) return;
    revision.current = conflict.revision;
    conflictRef.current = false;
    setConflict(null);
    if (choice === 'server') {
      savedPosition.current = conflict;
      const old = pending.current;
      pending.current = null;
      if (old) await removeProgress(bookId, old.client_mutation_id).catch(() => undefined);
      restoreRef.current(conflict);
      setStatus('synced');
    } else if (pending.current) {
      pending.current = {
        ...pending.current,
        revision: conflict.revision,
        client_mutation_id: crypto.randomUUID(),
      };
      persist(pending.current);
      await flush();
    }
  }

  return { update, flush, status, conflict, localAvailable, resolveConflict };
}
