import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bookmark,
  ArrowUpRight,
  Trash2,
  RotateCcw,
  Download,
  LogOut,
  BookOpen,
  Clock3,
  HardDrive,
  FolderPlus,
} from 'lucide-react';
import { api } from '../shared/api';
import type { Annotation, Book, Collection, Folder, Me, Page } from '../shared/types';
import { EmptyState, Modal, formatBytes, Loading, ErrorNotice } from '../components/Primitives';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function NotesPage({
  onOpen,
  onError,
}: {
  onOpen(book: Book): void;
  onError(error: unknown): void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState('bookmark');
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const list = useInfiniteQuery({
    queryKey: ['annotations', kind, query],
    queryFn: ({ pageParam }) =>
      api<Page<Annotation & { book_title?: string }>>(
        `/annotations/?kind=${kind}&search=${encodeURIComponent(query)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next || undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.results) || [];
  const path = kind === 'bookmark' ? 'bookmarks' : kind === 'highlight' ? 'highlights' : 'notes';
  async function open(annotation: Annotation) {
    try {
      const book = await api<Book>(`/books/${annotation.book_id}/`);
      onOpen({
        ...book,
        progress: { ...book.progress, page: annotation.page, position: annotation.position },
      });
    } catch (error) {
      onError(error);
    }
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('notesFeature')}</p>
          <h1>{t('bookmarks')}</h1>
        </div>
        <Bookmark size={28} strokeWidth={1.2} />
      </div>
      <div className="filter-row">
        {[
          ['bookmark', 'bookmarks'],
          ['highlight', 'highlights'],
          ['note', 'notes'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={`chip ${kind === value ? 'selected' : ''}`}
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <label className="form-stack">
        {t('notesSearch')}
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {list.isError ? (
        <ErrorNotice onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          title={t(query ? 'noResults' : 'notesEmpty')}
          text={t(query ? 'noResultsText' : 'notesEmptyText')}
        />
      ) : (
        <div className="annotations-list">
          {items.map((item) => (
            <article className="annotation-card" key={item.id}>
              <p className="eyebrow">
                {item.book_title || t('reader')} · {t('goToPage', { page: item.page })}
              </p>
              <p className="annotation-text">{item.text || t('goToPage', { page: item.page })}</p>
              <div>
                <button className="button subtle" onClick={() => void open(item)}>
                  <ArrowUpRight size={17} />
                  {t('open')}
                </button>
                {kind === 'note' && (
                  <button
                    className="button subtle"
                    onClick={() => {
                      setEditing(item);
                      setText(item.text);
                    }}
                  >
                    {t('edit')}
                  </button>
                )}
                <button
                  className="icon-button danger"
                  aria-label={t('delete')}
                  onClick={() =>
                    void api(`/${path}/${item.id}/`, { method: 'DELETE' })
                      .then(() => list.refetch())
                      .catch(onError)
                  }
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {list.hasNextPage && (
        <button className="button subtle" onClick={() => void list.fetchNextPage()}>
          {t('more')}
        </button>
      )}
      {editing && (
        <Modal title={t('notes')} onClose={() => setEditing(null)}>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void api(`/notes/${editing.id}/`, {
                method: 'PATCH',
                body: JSON.stringify({ text, revision: editing.revision }),
              })
                .then(() => {
                  setEditing(null);
                  return list.refetch();
                })
                .catch(onError);
            }}
          >
            <label>
              {t('notes')}
              <textarea
                value={text}
                required
                maxLength={20000}
                onChange={(event) => setText(event.target.value)}
                rows={6}
              />
            </label>
            <button className="button primary">{t('save')}</button>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function OrganizeDialog({
  collections,
  folders,
  onClose,
  onChanged,
  onError,
}: {
  collections: Collection[];
  folders: Folder[];
  onClose(): void;
  onChanged(): void;
  onError(error: unknown): void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState('collections');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; kind: string } | null>(null);
  return (
    <Modal title={t('manageCollections')} onClose={onClose}>
      <div className="filter-row">
        {['collections', 'folders'].map((value) => (
          <button
            key={value}
            className={`chip ${kind === value ? 'selected' : ''}`}
            onClick={() => setKind(value)}
          >
            {t(value)}
          </button>
        ))}
      </div>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void api(`/${kind}/`, {
            method: 'POST',
            body: JSON.stringify({
              name: name.trim(),
              ...(kind === 'folders' ? { parent_id: parent || null } : {}),
            }),
          })
            .then(() => {
              setName('');
              onChanged();
            })
            .catch(onError);
        }}
      >
        <label>
          {t('name')}
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {kind === 'folders' && (
          <label>
            {t('folder')}
            <select value={parent} onChange={(event) => setParent(event.target.value)}>
              <option value="">{t('noFolder')}</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="button primary" disabled={!name.trim()}>
          <FolderPlus size={18} />
          {t(kind === 'collections' ? 'createCollection' : 'createFolder')}
        </button>
      </form>
      <div className="organize-list">
        {(kind === 'collections' ? collections : folders).map((item) => (
          <div className="list-row" key={item.id}>
            <span>{item.name}</span>
            <button
              className="icon-button"
              aria-label={`${t('delete')}: ${item.name}`}
              onClick={() => setConfirm({ id: item.id, kind })}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>
      {confirm && (
        <div className="notice">
          <p>{t(confirm.kind === 'collections' ? 'removeCollection' : 'removeFolder')}</p>
          <div className="button-row">
            <button
              className="button danger"
              onClick={() =>
                void api(`/${confirm.kind}/${confirm.id}/`, { method: 'DELETE' })
                  .then(() => {
                    setConfirm(null);
                    onChanged();
                  })
                  .catch(onError)
              }
            >
              {t('delete')}
            </button>
            <button className="button subtle" onClick={() => setConfirm(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
export function ProfileDialog({
  me,
  onClose,
  onLogout,
  onChanged,
  onError,
}: {
  me: Me;
  onClose(): void;
  onLogout(): void;
  onChanged(): void;
  onError(error: unknown): void;
}) {
  const { t, i18n } = useTranslation();
  const [trash, setTrash] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['trash'],
    queryFn: ({ pageParam }) =>
      api<Page<Book>>(`/trash/${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next || undefined,
    enabled: trash,
  });
  const trashItems = list.data?.pages.flatMap((page) => page.results) || [];
  const stats = me.statistics;
  const [busy, setBusy] = useState(false);
  async function execute(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
      if (trash) await list.refetch();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  const exportNotes = (format: 'json' | 'markdown') =>
    void execute(async () => {
      const response = await api<Blob | object>(`/exports/annotations/?format=${format}`);
      const blob =
        response instanceof Blob
          ? response
          : new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
      download(blob, `polka-notes.${format === 'json' ? 'json' : 'md'}`);
    });
  return (
    <Modal title={t(trash ? 'trash' : 'profile')} onClose={onClose} wide>
      {!trash ? (
        <>
          <div className="profile-heading">
            <span className="profile-avatar">{me.user.first_name.charAt(0)}</span>
            <div>
              <h3>{me.user.first_name}</h3>
              {me.user.username && <p className="muted">@{me.user.username}</p>}
            </div>
          </div>
          <div className="stats-grid">
            <div>
              <BookOpen size={19} />
              <strong>{stats.books}</strong>
              <span>{t('totalBooks')}</span>
            </div>
            <div>
              <Bookmark size={19} />
              <strong>{stats.read}</strong>
              <span>{t('finishedBooks')}</span>
            </div>
            <div>
              <Clock3 size={19} />
              <strong>{t('minutes', { count: Math.floor(stats.reading_seconds / 60) })}</strong>
              <span>{t('activeReading')}</span>
            </div>
            <div>
              <HardDrive size={19} />
              <strong>{formatBytes(stats.storage_bytes, i18n.language)}</strong>
              <span>{t('storage')}</span>
            </div>
          </div>
          <section className="settings-group">
            <h3>{t('export')}</h3>
            <div className="button-row">
              <button
                className="button subtle"
                disabled={busy}
                onClick={() => exportNotes('markdown')}
              >
                <Download size={17} />
                {t('exportMd')}
              </button>
              <button className="button subtle" disabled={busy} onClick={() => exportNotes('json')}>
                {t('exportJson')}
              </button>
            </div>
          </section>
          <div className="profile-actions">
            <button className="button subtle" onClick={() => setTrash(true)}>
              <Trash2 size={18} />
              {t('trash')}
            </button>
            <button className="button subtle" onClick={onLogout}>
              <LogOut size={18} />
              {t('logout')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{t('trashHelp')}</p>
          {list.isError ? (
            <ErrorNotice onRetry={() => void list.refetch()} />
          ) : list.isPending ? (
            <Loading />
          ) : !trashItems.length ? (
            <EmptyState title={t('emptyTrash')} compact />
          ) : (
            <>
              <div className="trash-list">
                {trashItems.map((book) => (
                  <div className="list-row" key={book.id}>
                    <div>
                      <strong>{book.title}</strong>
                      <small>{book.author}</small>
                    </div>
                    <div>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`${t('restore')}: ${book.title}`}
                        onClick={() =>
                          void execute(() => api(`/trash/${book.id}/restore/`, { method: 'POST' }))
                        }
                      >
                        <RotateCcw size={19} />
                      </button>
                      <button
                        className="icon-button danger"
                        disabled={busy}
                        aria-label={`${t('permanentDelete')}: ${book.title}`}
                        onClick={() => setConfirm(book.id)}
                      >
                        <Trash2 size={19} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {list.hasNextPage && (
                <button className="button subtle" onClick={() => void list.fetchNextPage()}>
                  {t('more')}
                </button>
              )}
              <button className="button danger subtle" onClick={() => setConfirm('all')}>
                <Trash2 size={18} />
                {t('clearTrash')}
              </button>
            </>
          )}
          <button className="button subtle" onClick={() => setTrash(false)}>
            {t('profile')}
          </button>
        </>
      )}
      {confirm && (
        <div className="notice error-notice">
          <p>{t('permanentWarning')}</p>
          <div className="button-row">
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void execute(() =>
                  confirm === 'all'
                    ? api('/trash/purge/', { method: 'POST' })
                    : api(`/trash/${confirm}/`, { method: 'DELETE' }),
                ).then(() => setConfirm(null))
              }
            >
              {t('permanentDelete')}
            </button>
            <button className="button subtle" onClick={() => setConfirm(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
