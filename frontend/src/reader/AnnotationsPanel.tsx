import { useState } from 'react';
import { Bookmark, Highlighter, Pencil, Trash2, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../shared/api';
import type { ReaderAnnotation, AnnotationKind } from './useAnnotations';

interface Props {
  bookId: string;
  annotations: ReaderAnnotation[];
  busy: boolean;
  error: string | null;
  onGo(page: number, position?: number): void;
  onRemove(annotation: ReaderAnnotation): Promise<void>;
  onEdit(annotation: ReaderAnnotation, text: string): Promise<boolean>;
}

export function AnnotationsPanel({
  bookId,
  annotations,
  busy,
  error,
  onGo,
  onRemove,
  onEdit,
}: Props) {
  const { t } = useTranslation('reader');
  const [filter, setFilter] = useState<AnnotationKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ReaderAnnotation | null>(null);
  const [text, setText] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const visible = annotations.filter(
    (item) =>
      (filter === 'all' || item.kind === filter) &&
      item.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  async function download() {
    setExporting(true);
    setExportError(false);
    try {
      const response = await authenticatedFetch(
        `/exports/annotations/?format=markdown&book_id=${encodeURIComponent(bookId)}`,
      );
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'reading-notes.md';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="reader-tabs">
        {(['all', 'bookmarks', 'highlights', 'notes'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {t(kind)}
          </button>
        ))}
      </div>
      <label>
        {t('search')}
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {error && (
        <p role="alert" className="reader-error">
          {t(error)}
        </p>
      )}
      {!visible.length && <p>{t('noAnnotations')}</p>}
      {visible.map((item) => (
        <article key={item.id} className="reader-annotation">
          <div className="reader-annotation-header">
            <button type="button" onClick={() => onGo(item.page, item.position)}>
              {item.kind === 'bookmarks' ? (
                <Bookmark size={14} aria-hidden="true" />
              ) : item.kind === 'highlights' ? (
                <Highlighter size={14} aria-hidden="true" />
              ) : (
                <Pencil size={14} aria-hidden="true" />
              )}{' '}
              {t('page')} {item.page}
            </button>
            <button
              type="button"
              className="reader-icon"
              aria-label={t('edit')}
              disabled={busy}
              onClick={() => {
                setEditing(item);
                setText(item.text);
              }}
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="reader-icon"
              aria-label={t('delete')}
              disabled={busy}
              onClick={() => {
                void onRemove(item);
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
          {editing?.id === item.id ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onEdit(item, text).then((ok) => {
                  if (ok) setEditing(null);
                });
              }}
            >
              <label>
                {t('note')}
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={20_000}
                />
              </label>
              <div className="reader-dialog-actions">
                <button type="button" className="reader-button" onClick={() => setEditing(null)}>
                  {t('cancel')}
                </button>
                <button type="submit" className="reader-button primary" disabled={busy}>
                  {t('save')}
                </button>
              </div>
            </form>
          ) : (
            <p>{item.text}</p>
          )}
        </article>
      ))}
      <div className="reader-dialog-actions">
        <button
          type="button"
          className="reader-button"
          disabled={exporting}
          onClick={() => {
            void download();
          }}
        >
          <Download size={16} aria-hidden="true" /> {t(exporting ? 'exporting' : 'export')}
        </button>
      </div>
      {exportError && (
        <p role="alert" className="reader-error">
          {t('exportError')}
        </p>
      )}
    </>
  );
}
