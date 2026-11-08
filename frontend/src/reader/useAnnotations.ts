import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../shared/api';
import type { Annotation, Page } from '../shared/types';

export type AnnotationKind = 'bookmarks' | 'highlights' | 'notes';
export type ReaderAnnotation = Annotation & { kind: AnnotationKind };

export function useAnnotations(bookId: string) {
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const kinds: AnnotationKind[] = ['bookmarks', 'highlights', 'notes'];
    const groups = await Promise.all(
      kinds.map(async (kind) => {
        const rows: ReaderAnnotation[] = [];
        let cursor: string | null | undefined;
        do {
          const result = await api<Page<Annotation>>(
            `/books/${bookId}/${kind}/?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          rows.push(...result.results.map((value) => ({ ...value, kind })));
          cursor = result.next;
        } while (cursor);
        return rows;
      }),
    );
    setAnnotations(groups.flat().sort((a, b) => a.page - b.page));
    setError(null);
  }, [bookId]);

  useEffect(() => {
    void Promise.resolve()
      .then(reload)
      .catch(() => setError('errorBody'));
  }, [reload]);

  async function create(
    kind: AnnotationKind,
    input: Partial<Annotation> & { prefix?: string; suffix?: string },
  ) {
    setBusy(true);
    setError(null);
    try {
      const annotation = await api<Annotation>(`/books/${bookId}/${kind}/`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setAnnotations((old) => [...old, { ...annotation, kind }].sort((a, b) => a.page - b.page));
      return annotation;
    } catch {
      setError('actionError');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function remove(value: ReaderAnnotation) {
    setError(null);
    setBusy(true);
    try {
      await api(`/${value.kind}/${value.id}/`, { method: 'DELETE' });
      setAnnotations((old) => old.filter((item) => item.id !== value.id));
    } catch {
      setError('actionError');
    } finally {
      setBusy(false);
    }
  }

  async function edit(value: ReaderAnnotation, text: string) {
    setError(null);
    setBusy(true);
    try {
      const saved = await api<Annotation>(`/${value.kind}/${value.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ text, revision: value.revision }),
      });
      setAnnotations((old) =>
        old.map((item) => (item.id === value.id ? { ...saved, kind: value.kind } : item)),
      );
      return true;
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409 ? 'annotationConflict' : 'actionError',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { annotations, error, busy, reload, create, remove, edit };
}
