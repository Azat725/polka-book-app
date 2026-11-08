import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Home,
  LibraryBig,
  Bookmark,
  Settings2,
  LockKeyhole,
  RefreshCw,
  ArrowUpRight,
  X,
  Search,
} from 'lucide-react';
import { api, ApiError, authenticate, clearSession } from './shared/api';
import {
  defaultSettings,
  type Book,
  type Collection,
  type Folder,
  type Me,
  type Page,
  type Settings,
} from './shared/types';
import { resolveTheme, accentText } from './shared/themes';
import { setupTelegram, telegram } from './shared/telegram';
import { ErrorNotice, Loading } from './components/Primitives';
import { BookDetails } from './components/Books';
import { Onboarding } from './components/Onboarding';
import { UploadDialog } from './components/UploadDialog';
import { HomePage, LibraryPage } from './pages/LibraryPages';
import { SettingsPage } from './pages/SettingsPage';
import { NotesPage, OrganizeDialog, ProfileDialog } from './pages/PersonalPages';
import { clearReaderStorage } from './reader/storage';

const Reader = lazy(() => import('./reader/Reader').then((module) => ({ default: module.Reader })));
const navigation = [
  { path: '/', key: 'home', Icon: Home },
  { path: '/library', key: 'library', Icon: LibraryBig },
  { path: '/bookmarks', key: 'bookmarks', Icon: Bookmark },
  { path: '/settings', key: 'settings', Icon: Settings2 },
];

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Avoid sending document content to third-party error services. */
  }
  render() {
    return this.state.failed ? <FatalError /> : this.props.children;
  }
}
function FatalError() {
  const { t } = useTranslation();
  return (
    <div className="fatal-error">
      <BookOpen size={48} />
      <p>{t('fatalError')}</p>
      <button className="button primary" onClick={() => window.location.reload()}>
        {t('reload')}
      </button>
    </div>
  );
}
function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
function AuthScreen({
  busy,
  expired,
  error,
  onRetry,
}: {
  busy: boolean;
  expired: boolean;
  error: boolean;
  onRetry(): void;
}) {
  const { t } = useTranslation();
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  return (
    <main className="auth-screen">
      <header>
        <span className="wordmark">{t('brand')}</span>
        <span className="private-label">
          <LockKeyhole size={15} />
          PDF · Telegram
        </span>
      </header>
      <div className="auth-body">
        <div className="auth-copy">
          <p className="eyebrow">{t('personal')}</p>
          <h1>{t('authTitle')}</h1>
          <p>{t('authText')}</p>
          {busy ? (
            <Loading />
          ) : (
            <>
              <p className="auth-hint">{t(expired ? 'authExpired' : 'authHint')}</p>
              {bot && /^[A-Za-z0-9_]{5,32}$/.test(bot) && (
                <a
                  className="button cream"
                  href={`https://t.me/${bot}?startapp`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('authOpen')}
                  <ArrowUpRight size={20} />
                </a>
              )}
              {error && (
                <button className="button subtle" onClick={onRetry}>
                  <RefreshCw size={18} />
                  {t('retry')}
                </button>
              )}
            </>
          )}
        </div>
        <div className="auth-illustration" aria-hidden="true">
          <div className="auth-book back">
            <span>II</span>
          </div>
          <div className="auth-book front">
            <BookOpen size={64} strokeWidth={1} />
            <span>полка.</span>
            <i />
          </div>
          <span className="auth-stamp">
            <LockKeyhole size={20} />
          </span>
        </div>
      </div>
      <div className="auth-features">
        {[
          [LockKeyhole, 'privacyFeature', 'privacyText'],
          [RefreshCw, 'syncFeature', 'syncText'],
          [Bookmark, 'notesFeature', 'notesText'],
        ].map(([Icon, title, text]) => {
          const FeatureIcon = Icon as typeof BookOpen;
          return (
            <div key={String(title)}>
              <FeatureIcon size={23} strokeWidth={1.2} />
              <strong>{t(String(title))}</strong>
              <p>{t(String(text))}</p>
            </div>
          );
        })}
      </div>
    </main>
  );
}
export function App() {
  const client = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [expired, setExpired] = useState(false);
  const started = useRef(false);
  const login = useCallback(async () => {
    setBusy(true);
    setError(false);
    try {
      const authenticated = await authenticate();
      client.clear();
      setMe(authenticated);
      setExpired(false);
    } catch (error) {
      setError(error instanceof ApiError && error.code !== 'telegram_required');
    } finally {
      setBusy(false);
    }
  }, [client]);
  useEffect(() => {
    const cleanup = setupTelegram();
    if (!started.current) {
      started.current = true;
      void login();
    }
    const expire = () => {
      clearSession();
      client.clear();
      setMe(null);
      setExpired(true);
      window.setTimeout(() => {
        void clearReaderStorage().catch(() => undefined);
      }, 0);
    };
    window.addEventListener('session-expired', expire);
    return () => {
      cleanup();
      window.removeEventListener('session-expired', expire);
    };
  }, [login, client]);
  return (
    <ErrorBoundary>
      {me ? (
        <Application
          initial={me}
          onLogout={() => {
            setMe(null);
            setExpired(true);
          }}
        />
      ) : (
        <AuthScreen busy={busy} expired={expired} error={error} onRetry={() => void login()} />
      )}
    </ErrorBoundary>
  );
}
function Application({ initial, onLogout }: { initial: Me; onLogout(): void }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me/'), initialData: initial });
  const settings = useMemo<Settings>(
    () => ({ ...defaultSettings, ...me.data.settings }),
    [me.data.settings],
  );
  const [preview, setPreview] = useState<Settings | null>(null);
  const [systemMode, setSystemMode] = useState<'light' | 'dark'>(
    () =>
      telegram()?.colorScheme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const [upload, setUpload] = useState(false);
  const [details, setDetails] = useState<Book | null>(null);
  const [reader, setReader] = useState<Book | null>(null);
  const [organize, setOrganize] = useState(false);
  const [profile, setProfile] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('-created_at');
  const online = useOnline();
  const shown = preview || settings;
  const isLibrary = location.pathname === '/library';
  const showError = useCallback(
    (value: unknown) => {
      const code =
        value instanceof ApiError ? value.code : value instanceof Error ? value.message : '';
      setError(i18n.exists(code) ? i18n.t(code) : i18n.t('error'));
    },
    [i18n],
  );
  const changed = useCallback(() => {
    void client.invalidateQueries();
  }, [client]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () =>
      setSystemMode(telegram()?.colorScheme || (media.matches ? 'dark' : 'light'));
    media.addEventListener('change', update);
    telegram()?.onEvent?.('themeChanged', update);
    return () => {
      media.removeEventListener('change', update);
      telegram()?.offEvent?.('themeChanged', update);
    };
  }, []);
  useEffect(() => {
    const mode = shown.mode === 'system' ? systemMode : shown.mode;
    const colors = resolveTheme(shown.theme, mode, shown.custom_colors);
    Object.entries(colors).forEach(([key, value]) =>
      document.documentElement.style.setProperty(`--${key}`, value),
    );
    document.documentElement.style.setProperty('--on-accent', accentText(colors.accent));
    document.documentElement.style.colorScheme = mode;
    document.documentElement.lang = shown.language;
    document.body.dataset.texture = shown.texture;
    void i18n.changeLanguage(shown.language);
    telegram()?.setHeaderColor?.(colors.bg);
    telegram()?.setBackgroundColor?.(colors.bg);
  }, [shown, systemMode, i18n]);
  useEffect(() => {
    const app = telegram();
    const back = () => {
      if (reader) {
        if (window.dispatchEvent(new Event('reader-back', { cancelable: true }))) setReader(null);
      } else if (details) setDetails(null);
      else if (upload) setUpload(false);
      else if (profile) setProfile(false);
      else if (organize) setOrganize(false);
      else navigate('/');
    };
    const visible = reader || details || upload || profile || organize || location.pathname !== '/';
    if (visible) app?.BackButton?.show();
    else app?.BackButton?.hide();
    app?.BackButton?.onClick(back);
    return () => app?.BackButton?.offClick(back);
  }, [reader, details, upload, profile, organize, location.pathname, navigate]);
  useEffect(() => {
    let context: AudioContext | null = null;
    let oscillator: OscillatorNode | null = null;
    const click = (event: MouseEvent) => {
      if (
        !settings.sound_enabled ||
        !settings.ui_sound ||
        document.hidden ||
        !(event.target instanceof Element) ||
        !event.target.closest('button,a')
      )
        return;
      try {
        context ||= new AudioContext();
        void context.resume();
        oscillator?.stop();
        const voice = context.createOscillator();
        const gain = context.createGain();
        voice.type = 'sine';
        voice.frequency.setValueAtTime(640, context.currentTime);
        gain.gain.setValueAtTime(settings.volume * 0.035, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.045);
        voice.connect(gain).connect(context.destination);
        voice.start();
        voice.stop(context.currentTime + 0.05);
        oscillator = voice;
      } catch {
        /* Audio availability never prevents reading. */
      }
    };
    document.addEventListener('click', click);
    return () => {
      document.removeEventListener('click', click);
      void context?.close();
    };
  }, [settings.sound_enabled, settings.ui_sound, settings.volume]);
  const query = new URLSearchParams();
  if (isLibrary && debouncedSearch) query.set('search', debouncedSearch);
  if (isLibrary && status)
    query.set(
      status === 'favorite' ? 'favorite' : 'status',
      status === 'favorite' ? 'true' : status,
    );
  query.set('sort', isLibrary ? sort : '-created_at');
  if (isLibrary && params.get('collection')) query.set('collection_id', params.get('collection')!);
  if (isLibrary && params.get('folder')) query.set('folder_id', params.get('folder')!);
  const filter = query.toString();
  const books = useInfiniteQuery({
    queryKey: ['books', filter],
    queryFn: ({ pageParam }) =>
      api<Page<Book>>(
        `/books/?${filter}&limit=24${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next || undefined,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.results.some((book) => book.processing_status === 'processing'),
      )
        ? 1800
        : false,
  });
  const collections = useQuery({
    queryKey: ['collections'],
    queryFn: () => api<Page<Collection>>('/collections/'),
  });
  const continueReading = useQuery({
    queryKey: ['continue-reading'],
    queryFn: () => api<Page<Book>>('/books/?status=reading&sort=-last_read&limit=1'),
  });
  const favoriteBooks = useQuery({
    queryKey: ['favorite-books'],
    queryFn: () => api<Page<Book>>('/books/?favorite=true&limit=12'),
  });
  const folders = useQuery({
    queryKey: ['folders'],
    queryFn: () => api<Page<Folder>>('/folders/'),
  });
  const openBook = useCallback((book: Book) => {
    setDetails(null);
    setReader(book);
  }, []);
  async function saveSettings(value: Settings) {
    const result = await api<Settings>('/settings/', {
      method: 'PATCH',
      body: JSON.stringify({ ...value, revision: settings.revision }),
    });
    const next = { ...defaultSettings, ...result };
    client.setQueryData<Me>(['me'], (previous) =>
      previous ? { ...previous, settings: next } : previous,
    );
  }
  async function logout() {
    try {
      await api('/auth/logout/', { method: 'POST' });
    } catch {
      /* Local credentials must still be cleared when offline. */
    }
    clearSession();
    await clearReaderStorage().catch(() => undefined);
    client.clear();
    try {
      for (const key of Object.keys(localStorage))
        if (key.startsWith(`polka_upload:${initial.user.id}:`)) localStorage.removeItem(key);
    } catch {
      /* Optional resume metadata must not prevent logout. */
    }
    onLogout();
  }
  const items = books.data?.pages.flatMap((page) => page.results) || [];
  const bookProps = {
    books: items,
    settings,
    onOpen: openBook,
    onDetails: setDetails,
    onUpload: () => setUpload(true),
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="wordmark" to="/">
          {t('brand')}
        </Link>
        <div>
          <Link className="icon-button" to="/library" aria-label={t('search')}>
            <Search size={22} />
          </Link>
          <button
            className="avatar-button"
            onClick={() => setProfile(true)}
            aria-label={t('profile')}
          >
            {me.data.user.avatar_url ? (
              <img src={me.data.user.avatar_url} referrerPolicy="no-referrer" alt="" />
            ) : (
              me.data.user.first_name.charAt(0)
            )}
          </button>
        </div>
      </header>
      {!online && (
        <p className="notice offline-notice" role="status">
          {t('offline')}
        </p>
      )}
      {error && (
        <div className="global-error" role="alert">
          <span>{error}</span>
          <button className="icon-button" aria-label={t('close')} onClick={() => setError('')}>
            <X size={19} />
          </button>
        </div>
      )}
      {!settings.onboarding_done ? (
        <Onboarding
          onDone={() => saveSettings({ ...settings, onboarding_done: true }).catch(showError)}
        />
      ) : (
        <>
          <main className="main-content">
            {books.isError && <ErrorNotice onRetry={() => void books.refetch()} />}
            <Routes>
              <Route
                path="/"
                element={
                  books.isPending ? (
                    <Loading />
                  ) : (
                    <HomePage
                      {...bookProps}
                      currentBook={continueReading.data?.results[0]}
                      favoriteBooks={favoriteBooks.data?.results}
                      user={me.data.user}
                      collections={collections.data?.results || []}
                    />
                  )
                }
              />
              <Route
                path="/library"
                element={
                  <LibraryPage
                    {...bookProps}
                    search={search}
                    setSearch={setSearch}
                    status={status}
                    setStatus={setStatus}
                    sort={sort}
                    setSort={setSort}
                    collection={params.get('collection') || ''}
                    setCollection={(value) =>
                      setParams((previous) => {
                        if (value) previous.set('collection', value);
                        else previous.delete('collection');
                        return previous;
                      })
                    }
                    folder={params.get('folder') || ''}
                    setFolder={(value) =>
                      setParams((previous) => {
                        if (value) previous.set('folder', value);
                        else previous.delete('folder');
                        return previous;
                      })
                    }
                    collections={collections.data?.results || []}
                    folders={folders.data?.results || []}
                    onManage={() => setOrganize(true)}
                    next={!!books.hasNextPage}
                    loadMore={() => void books.fetchNextPage()}
                  />
                }
              />
              <Route
                path="/bookmarks"
                element={<NotesPage onOpen={openBook} onError={showError} />}
              />
              <Route
                path="/settings"
                element={
                  <SettingsPage
                    settings={settings}
                    onSave={saveSettings}
                    onPreview={setPreview}
                    onError={showError}
                  />
                }
              />
              <Route
                path="*"
                element={
                  <HomePage
                    {...bookProps}
                    user={me.data.user}
                    collections={collections.data?.results || []}
                  />
                }
              />
            </Routes>
          </main>
          <nav className="bottom-navigation" aria-label={t('library')}>
            {navigation.map(({ path, key, Icon }) => (
              <NavLink key={path} to={path} end={path === '/'}>
                <Icon size={23} strokeWidth={1.45} />
                <span>{t(key)}</span>
              </NavLink>
            ))}
          </nav>
        </>
      )}
      {upload && (
        <UploadDialog
          owner={me.data.user.id}
          onClose={() => setUpload(false)}
          onDone={() => changed()}
        />
      )}
      {details && (
        <BookDetails
          key={details.id}
          book={details}
          collections={collections.data?.results || []}
          folders={folders.data?.results || []}
          onClose={() => setDetails(null)}
          onChanged={changed}
          onOpen={openBook}
          onError={showError}
        />
      )}
      {organize && (
        <OrganizeDialog
          collections={collections.data?.results || []}
          folders={folders.data?.results || []}
          onClose={() => setOrganize(false)}
          onChanged={changed}
          onError={showError}
        />
      )}
      {profile && (
        <ProfileDialog
          me={me.data}
          onClose={() => setProfile(false)}
          onLogout={() => void logout()}
          onChanged={changed}
          onError={showError}
        />
      )}
      {reader && (
        <Suspense
          fallback={
            <div className="reader-opening">
              <Loading />
            </div>
          }
        >
          <Reader
            key={reader.id}
            book={reader}
            settings={settings}
            onClose={() => {
              setReader(null);
              changed();
            }}
            onBookChange={changed}
          />
        </Suspense>
      )}
    </div>
  );
}
