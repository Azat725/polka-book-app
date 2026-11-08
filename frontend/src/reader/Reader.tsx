import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  List,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAccessToken } from '../shared/api';
import type { Book, Progress, Settings } from '../shared/types';
import { useDocument } from './useDocument';
import { useProgress } from './useProgress';
import { useReadingSession } from './useReadingSession';
import { useAnnotations } from './useAnnotations';
import { useBookSettings } from './useBookSettings';
import { PdfPage, type TextSelection } from './PdfPage';
import { ReaderDialog } from './ReaderDialog';
import { ReaderSettings } from './ReaderSettings';
import { SearchPanel } from './SearchPanel';
import { AnnotationsPanel } from './AnnotationsPanel';
import {
  anchorOffset,
  clampPage,
  decideSwipe,
  locatePageAnchor,
  type PageMetric,
} from './geometry';
import { playPageSound, stopPageSound } from './sound';
import type { CurlAnimation } from './curl';
import './reader.css';

interface Props {
  book: Book;
  settings: Settings;
  onClose(): void;
  onBookChange(): void;
}
type Panel = 'search' | 'annotations' | 'settings' | 'note' | null;
const highlightColors = { yellow: '#E5BE59', green: '#72BC8A', pink: '#E191A6', blue: '#76ACDD' };

function pageMetrics(container: HTMLElement): PageMetric[] {
  const bounds = container.getBoundingClientRect();
  return Array.from(container.querySelectorAll<HTMLElement>('[data-page-number]'), (node) => ({
    page: Number(node.dataset.pageNumber),
    top: node.getBoundingClientRect().top - bounds.top + container.scrollTop,
    height:
      node.querySelector('.pdf-page')?.getBoundingClientRect().height ??
      Math.max(1, node.offsetHeight - 30),
  }));
}

export function Reader({ book, settings, onClose, onBookChange }: Props) {
  const { t } = useTranslation('reader');
  const pdf = useDocument(book.id);
  const document = pdf.document;
  const scroll = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const bookSettings = useBookSettings(book.id, settings);
  const preferences = bookSettings.preferences;
  const [page, setPage] = useState(book.progress?.page || 1);
  const [position, setPosition] = useState(book.progress?.position || 0);
  const [goto, setGoto] = useState<string | null>(null);
  const zoom = preferences.zoom;
  const changeBookSettings = bookSettings.change;
  const setZoom = useCallback(
    (value: number) => changeBookSettings({ zoom: value }),
    [changeBookSettings],
  );
  const [rotation, setRotation] = useState(0);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight - 170 });
  const observedSize = useRef({ width: 0, height: 0 });
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const knownRatios = useRef<Record<number, number>>({});
  const layoutIntent = useRef(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [color, setColor] = useState<keyof typeof highlightColors>('yellow');
  const [noteText, setNoteText] = useState('');
  const [password, setPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVersion, setSearchVersion] = useState(0);
  const searchTarget = useRef<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [turning, setTurning] = useState(false);
  const [curling, setCurling] = useState(false);
  const target = useRef<{
    page: number;
    position: number;
    kind?: 'layout';
    intent?: number;
  } | null>({ page: book.progress?.page || 1, position: book.progress?.position || 0 });
  const latestPosition = useRef({
    page: book.progress?.page || 1,
    position: book.progress?.position || 0,
    ready: false,
  });
  const curl = useRef<CurlAnimation | null>(null);
  const turnGeneration = useRef(0);
  const mounted = useRef(true);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef<{ x: number; y: number; at: number; edge: boolean } | null>(null);
  const pinching = useRef(false);
  const annotation = useAnnotations(book.id);
  const mode = preferences.reader_mode;
  const total = document?.numPages ?? Math.max(1, book.page_count);
  const spread = mode === 'flip' && size.width >= 920 && zoom === 1;
  const naturalRatio = ratios[page] ?? ratios[1] ?? Math.SQRT2;
  const availableWidth = Math.max(240, size.width - 32);
  const fittedWidth =
    mode === 'flip' || preferences.fit_mode === 'page'
      ? Math.min(
          availableWidth / (spread ? 2 : 1) - (spread ? 2 : 0),
          Math.max(240, size.height - 50) / naturalRatio,
          780,
        )
      : Math.min(availableWidth, 780);
  const pageWidth = Math.max(180, fittedWidth) * zoom;
  const filter = `${preferences.night_mode ? 'invert(0.9) hue-rotate(180deg) ' : ''}brightness(${preferences.brightness}) contrast(${preferences.contrast})`;
  const closePanel = useCallback(() => setPanel(null), []);

  const restore = useCallback((value: Progress) => {
    setPage(value.page);
    setPosition(value.position);
    setGoto(null);
    target.current = { page: value.page, position: value.position };
    latestPosition.current = {
      ...latestPosition.current,
      page: value.page,
      position: value.position,
    };
  }, []);
  const progress = useProgress(
    book.id,
    book.progress ?? { page: 1, position: 0, revision: 0 },
    restore,
  );
  useReadingSession(book.id, !!document && !pdf.passwordRequired && !pdf.error);

  const dimensions = useCallback((number: number, ratio: number) => {
    if (Math.abs((knownRatios.current[number] ?? 0) - ratio) < 0.001) return;
    const container = scroll.current;
    if (container && !target.current && !pinching.current)
      target.current = {
        ...locatePageAnchor(container.scrollTop, pageMetrics(container)),
        kind: 'layout',
        intent: layoutIntent.current,
      };
    knownRatios.current = { ...knownRatios.current, [number]: ratio };
    setRatios(knownRatios.current);
  }, []);

  useEffect(() => {
    const element = scroll.current;
    if (!element || !document) return;
    if (!target.current)
      target.current = {
        page: latestPosition.current.page,
        position: latestPosition.current.position,
      };
    const update = () => {
      if (
        observedSize.current.width === element.clientWidth &&
        observedSize.current.height === element.clientHeight
      )
        return;
      if (!target.current && !pinching.current)
        target.current = {
          ...locatePageAnchor(element.scrollTop, pageMetrics(element)),
          kind: 'layout',
          intent: layoutIntent.current,
        };
      observedSize.current = { width: element.clientWidth, height: element.clientHeight };
      setSize(observedSize.current);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [document]);

  useEffect(() => {
    if (!document || !target.current) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const value = target.current,
          container = scroll.current;
        if (!value || !container) return;
        if (value.kind === 'layout' && value.intent !== layoutIntent.current) {
          target.current = null;
          return;
        }
        const metrics = pageMetrics(container);
        if (!metrics.some((item) => item.page === clampPage(value.page, total))) return;
        container.scrollTop = anchorOffset(
          { page: clampPage(value.page, total), position: value.position },
          metrics,
        );
        target.current = null;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [document, mode, total, pageWidth, page, ratios]);

  const updateProgress = progress.update;
  const flushProgress = progress.flush;
  const onSearchMatch = useCallback(
    (number: number, anchor: number) => {
      if (searchTarget.current !== number || !scroll.current) return;
      searchTarget.current = null;
      if (target.current) target.current = { page: number, position: anchor };
      latestPosition.current = { page: number, position: anchor, ready: true };
      setPage(number);
      setPosition(anchor);
      updateProgress(number, anchor);
      scroll.current.scrollTop = anchorOffset(
        { page: number, position: anchor },
        pageMetrics(scroll.current),
      );
    },
    [updateProgress],
  );
  useEffect(() => {
    if (document && !pdf.passwordRequired && !pdf.error) latestPosition.current.ready = true;
  }, [document, pdf.passwordRequired, pdf.error]);

  useEffect(
    () => () => {
      const latest = latestPosition.current;
      if (latest.ready && getAccessToken()) {
        updateProgress(latest.page, latest.position);
        void flushProgress();
      }
    },
    [updateProgress, flushProgress],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      turnGeneration.current = -1;
      curl.current?.cancel();
      stopPageSound();
      clearTimeout(scrollTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function jump(number: number, anchor = 0) {
    const next = clampPage(number, total);
    curl.current?.cancel();
    curl.current = null;
    setCurling(false);
    turnGeneration.current++;
    target.current = { page: next, position: anchor };
    latestPosition.current = { page: next, position: anchor, ready: !!document };
    if (document) updateProgress(next, anchor);
    setPage(next);
    setPosition(anchor);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (mode === 'flip' && scroll.current) scroll.current.scrollTo({ top: 0, left: 0 });
    if (next === page && scroll.current) {
      scroll.current.scrollTop = anchorOffset(
        { page: next, position: anchor },
        pageMetrics(scroll.current),
      );
      target.current = null;
    }
  }

  async function turn(direction: 1 | -1) {
    const next = clampPage(page + direction * (spread ? 2 : 1), total);
    if (next === page) return;
    curl.current?.cancel();
    const generation = ++turnGeneration.current;
    if (preferences.sound_enabled && preferences.page_sound) playPageSound(preferences.volume);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const element = scroll.current?.querySelector<HTMLElement>(
      `[data-page-number="${spread && direction < 0 ? Math.min(page + 1, total) : page}"] .pdf-page`,
    );
    if (mode === 'flip' && zoom <= 1.02 && element && !reduced && !fallback) {
      try {
        const { animatePageCurl, pageSnapshot } = await import('./curl');
        if (generation !== turnGeneration.current || !mounted.current || !scroll.current) return;
        const snapshot = pageSnapshot(element);
        if (!snapshot) {
          jump(next);
          return;
        }
        const bounds = element.getBoundingClientRect();
        const effect = await animatePageCurl(
          scroll.current,
          snapshot,
          direction,
          520 / preferences.animation_speed,
          bounds,
        );
        if (generation !== turnGeneration.current || !mounted.current) {
          effect.cancel();
          return;
        }
        curl.current = effect;
        setCurling(true);
        setPage(next);
        setPosition(0);
        setSelection(null);
        window.getSelection()?.removeAllRanges();
        latestPosition.current = { page: next, position: 0, ready: true };
        updateProgress(next, 0);
        await effect.finished;
        snapshot.width = 0;
        snapshot.height = 0;
        if (generation === turnGeneration.current) {
          curl.current = null;
          if (mounted.current) setCurling(false);
        }
        return;
      } catch {
        if (mounted.current) setFallback(true);
      }
    }
    jump(next);
    if (mode === 'flip' && !reduced) {
      setTurning(true);
      window.setTimeout(() => {
        if (mounted.current) setTurning(false);
      }, 280);
    }
  }

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        panel ||
        pdf.passwordRequired ||
        progress.conflict ||
        bookSettings.conflict ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input,textarea,select,[contenteditable]'))
      )
        return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        void turn(1);
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        void turn(-1);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  useEffect(() => {
    const element = scroll.current;
    if (!element || !document) return;
    let initialDistance = 0,
      finalScale = 1;
    const base = zoom;
    function distance(event: TouchEvent) {
      return Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY,
      );
    }
    function start(event: TouchEvent) {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      pinching.current = true;
      pointer.current = null;
      initialDistance = distance(event);
      finalScale = 1;
    }
    function move(event: TouchEvent) {
      if (!pinching.current || event.touches.length !== 2) return;
      event.preventDefault();
      finalScale = Math.max(
        0.6 / base,
        Math.min(3 / base, distance(event) / Math.max(1, initialDistance)),
      );
      const pages = element?.firstElementChild as HTMLElement | null;
      if (pages) {
        pages.style.transformOrigin = 'top center';
        pages.style.transform = `scale(${finalScale})`;
      }
    }
    function end(event: TouchEvent) {
      if (!pinching.current || event.touches.length >= 2) return;
      pinching.current = false;
      const pages = element?.firstElementChild as HTMLElement | null;
      if (pages) pages.style.transform = '';
      target.current = { page, position };
      setZoom(Math.round(base * finalScale * 20) / 20);
    }
    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', end);
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end);
    };
  }, [document, zoom, page, position, setZoom]);

  function trackScroll() {
    if (target.current) return;
    const element = scroll.current;
    if (!element) return;
    const metrics = pageMetrics(element);
    if (!metrics.length) return;
    latestPosition.current = { ...locatePageAnchor(element.scrollTop, metrics), ready: true };
    if (scrollTimer.current) return;
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = undefined;
      const latest = latestPosition.current;
      setPage(latest.page);
      setPosition(latest.position);
      updateProgress(latest.page, latest.position);
    }, 100);
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    cancelLayoutRestore();
    if (
      mode !== 'flip' ||
      pinching.current ||
      event.button !== 0 ||
      (event.target instanceof HTMLElement && event.target.closest('button,input'))
    )
      return;
    curl.current?.cancel();
    setCurling(false);
    const bounds = event.currentTarget.getBoundingClientRect();
    pointer.current = {
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
      edge: event.clientX - bounds.left < 70 || bounds.right - event.clientX < 70,
    };
  }
  function cancelLayoutRestore() {
    layoutIntent.current++;
    if (target.current?.kind === 'layout') target.current = null;
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = pointer.current;
    pointer.current = null;
    if (!start || !start.edge || pinching.current || performance.now() - start.at > 650) return;
    const direction = decideSwipe(
      event.clientX - start.x,
      event.clientY - start.y,
      !!window.getSelection()?.toString(),
      zoom,
    );
    if (direction) void turn(direction);
  }

  function changePreferences(changes: Partial<Settings>) {
    changeBookSettings(changes);
    if (changes.reader_mode) {
      target.current = { page, position };
      setZoom(1);
    }
  }

  async function bookmark() {
    const saved = await annotation.create('bookmarks', {
      page,
      position,
      text: `${t('page')} ${page}`,
    });
    if (saved) setToast('bookmarked');
  }
  async function highlight() {
    if (!selection) return;
    const saved = await annotation.create('highlights', {
      page: selection.page,
      position: 0,
      text: selection.text,
      quads: selection.quads,
      prefix: selection.prefix,
      suffix: selection.suffix,
      color,
    });
    if (saved) {
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  }
  async function saveNote() {
    if (!noteText.trim()) return;
    const saved = await annotation.create('notes', {
      page: selection?.page ?? page,
      position,
      text: selection ? `“${selection.text}”\n\n${noteText.trim()}` : noteText.trim(),
      quads: selection?.quads ?? [],
      color,
    });
    if (saved) {
      setPanel(null);
      setNoteText('');
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  }
  async function close() {
    if (document) {
      const latest = latestPosition.current;
      progress.update(latest.page, latest.position);
      void progress.flush();
    }
    void bookSettings.flush();
    onBookChange();
    onClose();
  }
  function fullscreen() {
    const app = (window as Window & { Telegram?: { WebApp?: { requestFullscreen?: () => void } } })
      .Telegram?.WebApp;
    if (app?.requestFullscreen) {
      try {
        app.requestFullscreen();
      } catch {
        /* Browser fallback below. */
      }
    } else void root.current?.requestFullscreen?.().catch(() => undefined);
  }

  useEffect(() => {
    const back = (event: Event) => {
      event.preventDefault();
      if (progress.conflict || bookSettings.conflict) return;
      if (panel) {
        setPanel(null);
        return;
      }
      void close();
    };
    window.addEventListener('reader-back', back);
    return () => window.removeEventListener('reader-back', back);
  });

  const pageNode = (number: number, active: boolean) =>
    document && (
      <PdfPage
        key={`${number}:${active}`}
        document={document}
        pageNumber={number}
        width={pageWidth}
        rotation={rotation}
        active={active}
        estimatedRatio={ratios[number] ?? ratios[1] ?? Math.SQRT2}
        highlights={annotation.annotations.filter(
          (item) => item.page === number && item.kind === 'highlights',
        )}
        search={searchQuery}
        searchVersion={searchVersion}
        filter={filter}
        onDimensions={dimensions}
        onSelection={setSelection}
        onSearchMatch={onSearchMatch}
      />
    );

  return (
    <div
      ref={root}
      className="reader"
      data-texture={preferences.reader_texture}
      data-testid="pdf-reader"
    >
      <header className="reader-header">
        <button
          type="button"
          className="reader-icon"
          onClick={() => {
            void close();
          }}
          aria-label={t('back')}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className="reader-heading">
          <h1>{book.title}</h1>
          <small aria-live="polite">
            {t(progress.status)}
            {!progress.localAvailable ? ` · ${t('localUnavailable')}` : ''}
          </small>
        </div>
        <button
          type="button"
          className="reader-icon"
          disabled={!document}
          aria-label={t('search')}
          onClick={() => setPanel('search')}
        >
          <Search aria-hidden="true" />
        </button>
        <button
          type="button"
          className="reader-icon"
          disabled={!document || annotation.busy}
          aria-label={t('bookmark')}
          onClick={() => {
            void bookmark();
          }}
        >
          {annotation.annotations.some(
            (item) => item.kind === 'bookmarks' && item.page === page,
          ) ? (
            <BookmarkCheck aria-hidden="true" />
          ) : (
            <Bookmark aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="reader-icon"
          disabled={!document}
          aria-label={t('annotations')}
          onClick={() => {
            setPanel('annotations');
            void annotation.reload().catch(() => undefined);
          }}
        >
          <List aria-hidden="true" />
        </button>
        <button
          type="button"
          className="reader-icon"
          aria-label={t('settings')}
          onClick={() => setPanel('settings')}
        >
          <Settings2 aria-hidden="true" />
        </button>
      </header>

      {pdf.error ? (
        <div className="reader-loading">
          <BookOpen aria-hidden="true" />
          <h2>{t('errorTitle')}</h2>
          <p>{t('errorBody')}</p>
          <button type="button" className="reader-button primary" onClick={pdf.retry}>
            {t('retry')}
          </button>
        </div>
      ) : !document ? (
        <div className="reader-loading">
          <LoaderCircle className="reader-spinner" aria-hidden="true" />
          <p role="status">{t('loading')}</p>
        </div>
      ) : (
        <div
          ref={scroll}
          data-curling={curling}
          className={
            mode === 'scroll'
              ? 'reader-scroll'
              : `reader-flip-viewport ${turning ? 'reader-page-turn' : ''}`
          }
          onScroll={trackScroll}
          onWheel={cancelLayoutRestore}
          onTouchMove={cancelLayoutRestore}
          onPointerMove={(event) => {
            if (event.buttons || event.pointerType === 'touch') cancelLayoutRestore();
          }}
          onKeyDown={cancelLayoutRestore}
          onPointerDown={pointerDown}
          onPointerUp={pointerUp}
          onPointerCancel={() => {
            pointer.current = null;
          }}
          style={mode === 'flip' && zoom <= 1 ? { touchAction: 'pan-y' } : undefined}
        >
          {mode === 'scroll' ? (
            <div className="reader-pages">
              {Array.from({ length: total }, (_, index) =>
                pageNode(index + 1, Math.abs(index + 1 - page) <= 2),
              )}
            </div>
          ) : (
            <div className="reader-spread">
              {pageNode(page, true)}
              {spread && page < total && pageNode(page + 1, true)}
            </div>
          )}
        </div>
      )}

      {document && (
        <footer className="reader-footer">
          <div className="reader-navigation">
            <button
              type="button"
              className="reader-icon"
              disabled={page <= 1}
              onClick={() => {
                void turn(-1);
              }}
              aria-label={t('previous')}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                jump(Number(goto ?? page));
                setGoto(null);
              }}
            >
              <input
                type="number"
                min="1"
                max={total}
                value={goto ?? String(page)}
                aria-label={t('goto')}
                onChange={(event) => setGoto(event.target.value)}
                onBlur={() => {
                  if (goto !== null && Number(goto) > 0) jump(Number(goto));
                  setGoto(null);
                }}
              />
            </form>
            <span>
              {t('of')} {total}
            </span>
            <button
              type="button"
              className="reader-icon"
              disabled={page >= total}
              onClick={() => {
                void turn(1);
              }}
              aria-label={t('next')}
            >
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              className="reader-icon"
              aria-label={t('note')}
              onClick={() => {
                setNoteText('');
                setPanel('note');
              }}
            >
              <Pencil aria-hidden="true" />
            </button>
          </div>
          <input
            className="reader-progress"
            type="range"
            min="1"
            max={total}
            value={page}
            aria-label={t('page')}
            onChange={(event) => jump(Number(event.target.value))}
          />
          {mode === 'flip' && (
            <p className="reader-hint">
              {t(zoom > 1 ? 'zoomHelp' : fallback ? 'flipFallback' : 'flipHelp')}
            </p>
          )}
        </footer>
      )}

      {toast && (
        <div className="reader-toast" role="status">
          {t(toast)}
        </div>
      )}
      {annotation.error && !panel && (
        <div className="reader-toast" role="alert">
          {t(annotation.error)}
        </div>
      )}
      {selection && !panel && (
        <div
          className="reader-selection"
          role="toolbar"
          aria-label={t('selected')}
          onPointerDown={(event) => event.preventDefault()}
        >
          {(Object.keys(highlightColors) as (keyof typeof highlightColors)[]).map((name) => (
            <button
              key={name}
              type="button"
              className="reader-color"
              aria-label={t(name)}
              aria-pressed={color === name}
              onClick={() => setColor(name)}
            >
              <span style={{ backgroundColor: highlightColors[name] }} />
            </button>
          ))}
          <button
            type="button"
            className="reader-icon"
            aria-label={t('highlight')}
            disabled={annotation.busy}
            onClick={() => {
              void highlight();
            }}
          >
            <Highlighter aria-hidden="true" />
          </button>
          <button
            type="button"
            className="reader-icon"
            aria-label={t('quoteNote')}
            onClick={() => {
              setNoteText('');
              setPanel('note');
            }}
          >
            <Pencil aria-hidden="true" />
          </button>
          <button
            type="button"
            className="reader-icon"
            aria-label={t('cancel')}
            onClick={() => {
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {panel === 'settings' && (
        <ReaderDialog title={t('settings')} onClose={closePanel}>
          {!bookSettings.ready && !bookSettings.error && <p role="status">{t('loading')}</p>}
          {bookSettings.error && (
            <p role="alert" className="reader-error">
              {t('settingsSyncError')}{' '}
              <button
                type="button"
                className="reader-button"
                onClick={() => {
                  void (bookSettings.ready ? bookSettings.flush() : bookSettings.load());
                }}
              >
                {t('retry')}
              </button>
            </p>
          )}
          <ReaderSettings
            settings={preferences}
            disabled={!bookSettings.ready}
            zoom={zoom}
            fitMode={preferences.fit_mode}
            onFitMode={(value) => {
              target.current = { page, position };
              changeBookSettings({ fit_mode: value, zoom: 1 });
            }}
            onZoom={(value) => {
              target.current = { page, position };
              setZoom(value);
            }}
            onChange={changePreferences}
            onRotate={() => {
              target.current = { page, position };
              setRotation((value) => (value + 90) % 360);
              knownRatios.current = {};
              setRatios({});
            }}
            onFullscreen={fullscreen}
          />
        </ReaderDialog>
      )}
      {panel === 'search' && document && (
        <ReaderDialog title={t('search')} onClose={closePanel}>
          <SearchPanel
            document={document}
            onGo={(number, query) => {
              searchTarget.current = number;
              setSearchVersion((value) => value + 1);
              setSearchQuery(query);
              setPanel(null);
              jump(number);
            }}
          />
        </ReaderDialog>
      )}
      {panel === 'annotations' && (
        <ReaderDialog title={t('annotations')} onClose={closePanel}>
          <AnnotationsPanel
            bookId={book.id}
            annotations={annotation.annotations}
            busy={annotation.busy}
            error={annotation.error}
            onGo={(number, anchor) => {
              setPanel(null);
              jump(number, anchor);
            }}
            onRemove={annotation.remove}
            onEdit={annotation.edit}
          />
        </ReaderDialog>
      )}
      {panel === 'note' && (
        <ReaderDialog title={t(selection ? 'quoteNote' : 'note')} onClose={closePanel}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveNote();
            }}
          >
            {selection && <blockquote className="reader-quote">{selection.text}</blockquote>}
            <label>
              {t('note')}
              <textarea
                autoFocus
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                placeholder={t('notePlaceholder')}
                maxLength={selection ? 10_000 : 20_000}
              />
            </label>
            {annotation.error && (
              <p className="reader-error" role="alert">
                {t(annotation.error)}
              </p>
            )}
            <div className="reader-dialog-actions">
              <button type="button" className="reader-button" onClick={closePanel}>
                {t('cancel')}
              </button>
              <button
                type="submit"
                className="reader-button primary"
                disabled={!noteText.trim() || annotation.busy}
              >
                {t('save')}
              </button>
            </div>
          </form>
        </ReaderDialog>
      )}
      {pdf.passwordRequired && (
        <ReaderDialog
          title={t('passwordTitle')}
          onClose={() => {
            void close();
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              pdf.unlock(password);
              setPassword('');
            }}
          >
            <LockKeyhole size={30} aria-hidden="true" />
            <p>{t('passwordWarning')}</p>
            {pdf.incorrectPassword && (
              <p className="reader-error" role="alert">
                {t('passwordIncorrect')}
              </p>
            )}
            <label>
              {t('password')}
              <input
                autoFocus
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="reader-dialog-actions">
              <button type="submit" className="reader-button primary" disabled={!password}>
                {t('unlock')}
              </button>
            </div>
          </form>
        </ReaderDialog>
      )}
      {progress.conflict && (
        <ReaderDialog title={t('conflict')} dismissible={false} onClose={() => undefined}>
          <p>{t('conflictBody', { page: progress.conflict.page })}</p>
          <div className="reader-dialog-actions">
            <button
              type="button"
              className="reader-button"
              onClick={() => {
                void progress.resolveConflict('server');
              }}
            >
              {t('useServer')}
            </button>
            <button
              type="button"
              className="reader-button primary"
              onClick={() => {
                void progress.resolveConflict('local');
              }}
            >
              {t('useLocal')}
            </button>
          </div>
        </ReaderDialog>
      )}
      {bookSettings.conflict && (
        <ReaderDialog title={t('settingsConflict')} dismissible={false} onClose={() => undefined}>
          <p>{t('settingsConflictBody')}</p>
          <div className="reader-dialog-actions">
            <button
              type="button"
              className="reader-button"
              onClick={() => {
                target.current = { page, position };
                void bookSettings.resolveConflict('server');
              }}
            >
              {t('useServerSettings')}
            </button>
            <button
              type="button"
              className="reader-button primary"
              onClick={() => {
                void bookSettings.resolveConflict('local');
              }}
            >
              {t('useLocalSettings')}
            </button>
          </div>
        </ReaderDialog>
      )}
    </div>
  );
}
