import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Match {
  page: number;
  count: number;
  excerpt: string;
}

export function SearchPanel({
  document,
  onGo,
}: {
  document: PDFDocumentProxy;
  onGo(page: number, query: string): void;
}) {
  const { t } = useTranslation('reader');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const lastQuery = useRef('');

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function search(event: FormEvent) {
    event.preventDefault();
    const target = query.trim();
    if (!target) return;
    const version = ++generation.current;
    lastQuery.current = target;
    setMatches([]);
    setSearching(true);
    setScanned(0);
    setSearched(true);
    setError(false);
    try {
      const needle = target.replace(/\s+/g, ' ').toLocaleLowerCase();
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        if (version !== generation.current) return;
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        if (version !== generation.current) return;
        const text = content.items
          .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
          .join('')
          .replace(/\s+/g, ' ');
        const lower = text.toLocaleLowerCase();
        let index = lower.indexOf(needle),
          count = 0,
          first = -1;
        while (index !== -1) {
          if (first < 0) first = index;
          count++;
          index = lower.indexOf(needle, index + Math.max(1, needle.length));
        }
        if (count)
          setMatches((old) => [
            ...old,
            {
              page: pageNumber,
              count,
              excerpt: text.slice(Math.max(0, first - 55), first + target.length + 100).trim(),
            },
          ]);
        setScanned(pageNumber);
        if (pageNumber % 4 === 0)
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } catch {
      if (version === generation.current) setError(true);
    } finally {
      if (version === generation.current) setSearching(false);
    }
  }

  return (
    <>
      <form
        className="reader-search-row"
        onSubmit={(event) => {
          void search(event);
        }}
      >
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          maxLength={500}
        />
        <button
          type="submit"
          className="reader-icon"
          aria-label={t('search')}
          disabled={!query.trim()}
        >
          <Search aria-hidden="true" />
        </button>
      </form>
      <p>{t('searchHelp')}</p>
      {searching && (
        <>
          <p role="status">{t('searchBusy', { page: scanned, total: document.numPages })}</p>
          <button
            type="button"
            className="reader-button"
            onClick={() => {
              generation.current++;
              setSearching(false);
            }}
          >
            {t('searchCancel')}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="reader-error">
          {t('errorBody')}
        </p>
      )}
      {searched && !searching && !matches.length && !error && (
        <p role="status">{t('searchEmpty')}</p>
      )}
      <div className="reader-results">
        {matches.map((match) => (
          <button
            type="button"
            key={match.page}
            className="reader-result"
            onClick={() => onGo(match.page, lastQuery.current)}
          >
            <strong>{t('searchResult', { page: match.page, count: match.count })}</strong>
            <p>{match.excerpt}</p>
          </button>
        ))}
      </div>
    </>
  );
}
