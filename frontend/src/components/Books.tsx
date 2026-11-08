import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, LockKeyhole, Heart, MoreHorizontal, LoaderCircle } from 'lucide-react';
import type { Book, Collection, Folder } from '../shared/types';
import { api } from '../shared/api';
import { Modal, formatBytes } from './Primitives';

export function BookCover({ book, hero = false }: { book: Book; hero?: boolean }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!book.cover_url) return;
    const controller = new AbortController();
    let objectUrl = '';
    void api<Blob>(`/books/${book.id}/cover/`, { signal: controller.signal })
      .then((blob) => {
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        /* The title remains a usable cover if its preview fails. */
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl('');
    };
  }, [book.id, book.cover_url]);
  const color = Array.from(book.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  return (
    <div className={`book-cover cover-color-${color} ${hero ? 'hero-cover' : ''}`}>
      {url ? (
        <img src={url} alt="" loading="lazy" />
      ) : (
        <div className="cover-lettering">
          <BookOpen size={hero ? 28 : 25} strokeWidth={1.25} />
          <span>{book.title}</span>
          {book.author && <small>{book.author}</small>}
        </div>
      )}
      <span className="book-spine" aria-hidden="true" />
      {book.processing_status === 'locked' && (
        <span className="cover-badge">
          <LockKeyhole size={15} />
        </span>
      )}
      {book.favorite && (
        <span className="cover-favorite">
          <Heart size={15} fill="currentColor" />
        </span>
      )}
    </div>
  );
}
export function BookCard({
  book,
  onOpen,
  onDetails,
}: {
  book: Book;
  onOpen(book: Book): void;
  onDetails(book: Book): void;
}) {
  const { t } = useTranslation();
  const ready = book.processing_status === 'ready' || book.processing_status === 'locked';
  const progress =
    book.page_count > 0
      ? Math.min(100, ((book.progress.page - 1 + book.progress.position) / book.page_count) * 100)
      : 0;
  return (
    <article className="book-card">
      <button
        className="book-open"
        onClick={() => (ready ? onOpen(book) : onDetails(book))}
        aria-label={`${t('open')}: ${book.title}`}
      >
        <BookCover book={book} />
      </button>
      {progress > 0 && (
        <div className="book-progress" aria-label={`${Math.round(progress)}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="book-caption">
        <div>
          <h3>{book.title}</h3>
          <p>
            {book.author ||
              (book.processing_status === 'processing'
                ? t('processing')
                : book.processing_status === 'error'
                  ? t('failed')
                  : t(book.status))}
          </p>
        </div>
        <button
          className="icon-button book-more"
          aria-label={`${t('details')}: ${book.title}`}
          onClick={() => onDetails(book)}
        >
          {book.processing_status === 'processing' ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <MoreHorizontal size={20} />
          )}
        </button>
      </div>
    </article>
  );
}
export function BookDetails({
  book,
  collections,
  folders,
  onClose,
  onChanged,
  onOpen,
  onError,
}: {
  book: Book;
  collections: Collection[];
  folders: Folder[];
  onClose(): void;
  onChanged(): void;
  onOpen(book: Book): void;
  onError(error: unknown): void;
}) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [status, setStatus] = useState(book.status);
  const [favorite, setFavorite] = useState(book.favorite);
  const [folder, setFolder] = useState(book.folder_id || '');
  const [selected, setSelected] = useState(book.collection_ids);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function execute(fn: () => Promise<void>, close = true) {
    setBusy(true);
    try {
      await fn();
      onChanged();
      if (close) onClose();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await api(`/books/${book.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: title.trim(),
        author: author.trim(),
        status,
        favorite,
        folder_id: folder || null,
      }),
    });
    for (const collection of collections) {
      const before = book.collection_ids.includes(collection.id);
      const after = selected.includes(collection.id);
      if (before !== after)
        await api(`/collections/${collection.id}/books/${book.id}/`, {
          method: after ? 'PUT' : 'DELETE',
        });
    }
  }
  return (
    <Modal title={t('details')} onClose={onClose}>
      <div className="book-detail-top">
        <BookCover book={book} />
        <div>
          <p className="eyebrow">PDF</p>
          <strong>{formatBytes(book.size_bytes, i18n.language)}</strong>
          {book.page_count > 0 && (
            <p>{t('page', { page: book.progress.page, total: book.page_count })}</p>
          )}
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {t('cover')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void execute(async () => {
                  const body = new FormData();
                  body.append('file', file);
                  await api(`/books/${book.id}/covers/`, { method: 'POST', body });
                }, false);
            }}
          />
        </div>
      </div>
      {book.processing_status === 'locked' && <p className="notice">{t('lockedWarning')}</p>}
      {book.processing_status === 'error' && (
        <div className="notice error-notice">
          <p>{t('failed')}</p>
          <button
            className="button subtle"
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                await api(`/books/${book.id}/processing-retries/`, { method: 'POST' });
              })
            }
          >
            {t('retry')}
          </button>
        </div>
      )}
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void execute(save);
        }}
      >
        <label>
          {t('title')}
          <input
            required
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          {t('author')}
          <input
            maxLength={200}
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
          />
        </label>
        <div className="form-two">
          <label>
            {t('status')}
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as Book['status'])}
            >
              {['want', 'reading', 'read'].map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('folder')}
            <select value={folder} onChange={(event) => setFolder(event.target.value)}>
              <option value="">{t('noFolder')}</option>
              {folders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={favorite}
            onChange={(event) => setFavorite(event.target.checked)}
          />
          {t('favorites')}
        </label>
        {collections.length > 0 && (
          <fieldset>
            <legend>{t('collections')}</legend>
            {collections.map((item) => (
              <label className="check-row" key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    )
                  }
                />
                {item.name}
              </label>
            ))}
          </fieldset>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button danger subtle"
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                await api(`/books/${book.id}/`, { method: 'DELETE' });
              })
            }
          >
            {t('toTrash')}
          </button>
          <button className="button primary" disabled={busy || !title.trim()}>
            {busy && <LoaderCircle size={17} className="spin" />}
            {t('save')}
          </button>
        </div>
      </form>
      {(book.processing_status === 'ready' || book.processing_status === 'locked') && (
        <button className="button full" onClick={() => onOpen(book)}>
          <BookOpen size={18} />
          {t('open')}
        </button>
      )}
    </Modal>
  );
}
