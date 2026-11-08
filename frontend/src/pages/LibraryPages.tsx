import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Plus, Search, LockKeyhole, FolderHeart } from 'lucide-react';
import type { Book, Collection, Folder, Settings, User } from '../shared/types';
import { BookCard, BookCover } from '../components/Books';
import { EmptyState } from '../components/Primitives';

interface Props {
  books: Book[];
  settings: Settings;
  onOpen(book: Book): void;
  onDetails(book: Book): void;
  onUpload(): void;
}
export function HomePage({
  books,
  settings,
  user,
  collections,
  currentBook,
  favoriteBooks,
  onOpen,
  onDetails,
  onUpload,
}: Props & { user: User; collections: Collection[]; currentBook?: Book; favoriteBooks?: Book[] }) {
  const { t } = useTranslation();
  const current =
    currentBook ||
    books.find(
      (book) => book.status === 'reading' && ['ready', 'locked'].includes(book.processing_status),
    ) ||
    books.find(
      (book) => book.progress.page > 1 && ['ready', 'locked'].includes(book.processing_status),
    );
  const favorites = favoriteBooks || books.filter((book) => book.favorite);
  return (
    <section className="page home-page">
      <div className="home-intro">
        <div>
          <p className="eyebrow">{t('personal')}</p>
          <h1>{t('tagline')}</h1>
          <p className="muted">{t('greeting', { name: user.first_name })}</p>
        </div>
        <span className="private-label">
          <LockKeyhole size={14} />
          {t('private')}
        </span>
      </div>
      {current ? (
        <button className="continue-card" onClick={() => onOpen(current)}>
          <div className="continue-copy">
            <p className="eyebrow">{t('continue')}</p>
            <h2>{current.title}</h2>
            <p>{current.author}</p>
            {current.page_count > 0 && (
              <div className="continue-progress">
                <span
                  style={{
                    width: `${current.page_count ? Math.min(100, ((current.progress.page - 1 + current.progress.position) / current.page_count) * 100) : 0}%`,
                  }}
                />
              </div>
            )}
            <div className="continue-bottom">
              <span>
                {t(current.page_count ? 'page' : 'pageOnly', {
                  page: current.progress.page,
                  total: current.page_count,
                })}
              </span>
              <span>
                {t('continue')}
                <ArrowRight size={17} />
              </span>
            </div>
          </div>
          <BookCover book={current} hero />
        </button>
      ) : (
        <div className="welcome-card">
          <div>
            <p className="eyebrow">{t('private')}</p>
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyText')}</p>
            <button className="button cream" onClick={onUpload}>
              <Plus size={19} />
              {t('upload')}
            </button>
          </div>
          <div className="welcome-books" aria-hidden="true">
            <span />
            <span />
            <span />
            <BookOpen size={48} strokeWidth={1} />
          </div>
        </div>
      )}
      <div className="section-heading">
        <h2>{t('recent')}</h2>
        <Link className="text-link" to="/library">
          {t('allBooks')}
          <ArrowRight size={17} />
        </Link>
      </div>
      {books.length ? (
        <div
          data-shelf={settings.shelf_style}
          className={`book-grid size-${settings.cover_size} density-${settings.density}`}
        >
          {books.slice(0, 6).map((book) => (
            <BookCard key={book.id} book={book} onOpen={onOpen} onDetails={onDetails} />
          ))}
        </div>
      ) : (
        <div className="empty-shelf">
          <span />
          <span />
          <span />
          <p>{t('uploadHelp')}</p>
        </div>
      )}
      {favorites.length > 0 && (
        <>
          <div className="section-heading">
            <h2>{t('favorites')}</h2>
          </div>
          <div data-shelf={settings.shelf_style} className="book-shelf">
            {favorites.map((book) => (
              <BookCard key={book.id} book={book} onOpen={onOpen} onDetails={onDetails} />
            ))}
          </div>
        </>
      )}
      <div className="section-heading">
        <h2>{t('collections')}</h2>
        <Link to="/library" className="text-link">
          {t('organize')}
          <ArrowRight size={17} />
        </Link>
      </div>
      <div className="collection-preview">
        {collections.length ? (
          collections.slice(0, 4).map((collection, index) => (
            <Link
              key={collection.id}
              to={`/library?collection=${collection.id}`}
              className={`collection-tile cover-color-${index % 4}`}
            >
              <FolderHeart size={26} strokeWidth={1.1} />
              <span>{collection.name}</span>
              <ArrowRight size={20} />
            </Link>
          ))
        ) : (
          <p className="muted">{t('noCollections')}</p>
        )}
      </div>
    </section>
  );
}
export function LibraryPage({
  books,
  settings,
  onOpen,
  onDetails,
  onUpload,
  search,
  setSearch,
  status,
  setStatus,
  sort,
  setSort,
  collection,
  setCollection,
  folder,
  setFolder,
  collections,
  folders,
  onManage,
  next,
  loadMore,
}: Props & {
  search: string;
  setSearch(value: string): void;
  status: string;
  setStatus(value: string): void;
  sort: string;
  setSort(value: string): void;
  collection: string;
  setCollection(value: string): void;
  folder: string;
  setFolder(value: string): void;
  collections: Collection[];
  folders: Folder[];
  onManage(): void;
  next: boolean;
  loadMore(): void;
}) {
  const { t } = useTranslation();
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t('personal')}</p>
          <h1>{t('myLibrary')}</h1>
        </div>
        <button className="button primary" onClick={onUpload}>
          <Plus size={20} />
          <span className="hide-small">{t('upload')}</span>
        </button>
      </div>
      <div className="library-tools">
        <label className="search-field">
          <Search size={19} />
          <span className="sr-only">{t('search')}</span>
          <input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">{t('sort')}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="-created_at">{t('newest')}</option>
            <option value="title">{t('titleSort')}</option>
            <option value="-progress">{t('progressSort')}</option>
          </select>
        </label>
      </div>
      <div className="filter-row" role="group" aria-label={t('status')}>
        {['', 'want', 'reading', 'read', 'favorite'].map((value) => (
          <button
            key={value}
            className={`chip ${status === value ? 'selected' : ''}`}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          >
            {t(value === '' ? 'all' : value === 'favorite' ? 'favorites' : value)}
          </button>
        ))}
      </div>
      <div className="organization-row">
        <select
          aria-label={t('collections')}
          value={collection}
          onChange={(event) => setCollection(event.target.value)}
        >
          <option value="">{t('collections')}</option>
          {collections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('folders')}
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
        >
          <option value="">{t('folders')}</option>
          {folders.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button className="button subtle" onClick={onManage}>
          <Plus size={18} />
          <span>{t('organize')}</span>
        </button>
      </div>
      {books.length ? (
        <div
          data-shelf={settings.shelf_style}
          className={`book-grid size-${settings.cover_size} density-${settings.density}`}
        >
          {books.map((book) => (
            <BookCard key={book.id} book={book} onOpen={onOpen} onDetails={onDetails} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={t(search || status || folder || collection ? 'noResults' : 'emptyTitle')}
          text={t(search || status || folder || collection ? 'noResultsText' : 'emptyText')}
          onUpload={onUpload}
        />
      )}
      {next && (
        <div className="load-more">
          <button className="button subtle" onClick={loadMore}>
            {t('more')}
          </button>
        </div>
      )}
    </section>
  );
}
