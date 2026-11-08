import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { useTranslation } from 'react-i18next';
import type { Annotation } from '../shared/types';
import { pdfQuadToRect, rectToPdfQuad } from './geometry';
import { markSearchText } from './search';

export interface TextSelection {
  page: number;
  text: string;
  quads: number[][];
  prefix: string;
  suffix: string;
}
const colors: Record<string, string> = {
  yellow: '#E5BE59',
  green: '#72BC8A',
  pink: '#E191A6',
  blue: '#76ACDD',
};

interface Props {
  document: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  rotation: number;
  active: boolean;
  estimatedRatio: number;
  highlights: Annotation[];
  search: string;
  searchVersion: number;
  filter: string;
  onDimensions(page: number, ratio: number): void;
  onSelection(selection: TextSelection | null): void;
  onSearchMatch(page: number, position: number): void;
}

export function PdfPage({
  document,
  pageNumber,
  width,
  rotation,
  active,
  estimatedRatio,
  highlights,
  search,
  searchVersion,
  filter,
  onDimensions,
  onSelection,
  onSearchMatch,
}: Props) {
  const { t } = useTranslation('reader');
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ReturnType<PDFPageProxy['getViewport']> | null>(null);
  const [rendered, setRendered] = useState<{ key: string; error: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const height = width * estimatedRatio;
  const renderKey = `${pageNumber}:${width}:${rotation}:${attempt}`;
  const ready = active && rendered?.key === renderKey && !rendered.error;
  const error = active && rendered?.key === renderKey && rendered.error;

  useEffect(() => {
    const target = canvas.current,
      textTarget = text.current;
    if (!active || !target || !textTarget) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    let pdfPage: PDFPageProxy | undefined;
    void document
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return;
        pdfPage = page;
        const natural = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
        const next = page.getViewport({
          scale: width / natural.width,
          rotation: (page.rotate + rotation) % 360,
        });
        setViewport(next);
        onDimensions(pageNumber, next.height / next.width);
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(6_000_000 / (next.width * next.height)),
        );
        target.width = Math.max(1, Math.floor(next.width * pixelRatio));
        target.height = Math.max(1, Math.floor(next.height * pixelRatio));
        target.style.width = `${next.width}px`;
        target.style.height = `${next.height}px`;
        const context = target.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas unavailable');
        renderTask = page.render({
          canvas: target,
          canvasContext: context,
          viewport: next,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        textTarget.replaceChildren();
        textTarget.style.setProperty('--scale-factor', String(next.scale));
        textTarget.style.setProperty('--user-unit', String(page.userUnit));
        textTarget.style.setProperty('--total-scale-factor', String(next.scale * page.userUnit));
        textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textTarget,
          viewport: next,
        });
        await textLayer.render();
        if (!cancelled) setRendered({ key: renderKey, error: false });
      })
      .catch((reason) => {
        if (
          !cancelled &&
          reason?.name !== 'RenderingCancelledException' &&
          reason?.name !== 'AbortException'
        )
          setRendered({ key: renderKey, error: true });
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      textTarget.replaceChildren();
      target.width = 0;
      target.height = 0;
      pdfPage?.cleanup();
    };
  }, [document, pageNumber, width, rotation, active, attempt, onDimensions, renderKey]);

  useEffect(() => {
    if (!text.current) return;
    const match = markSearchText(text.current, search);
    if (match && shell.current && viewport && ready) {
      const anchor = Math.max(
        0,
        Math.min(
          1,
          (match.getBoundingClientRect().top - shell.current.getBoundingClientRect().top - 8) /
            viewport.height,
        ),
      );
      const frame = requestAnimationFrame(() => onSearchMatch(pageNumber, anchor));
      return () => cancelAnimationFrame(frame);
    }
  }, [search, ready, searchVersion, viewport, pageNumber, onSearchMatch]);

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !shell.current || !viewport)
      return;
    const range = selection.getRangeAt(0);
    if (
      !text.current?.contains(range.startContainer) ||
      !text.current?.contains(range.endContainer)
    )
      return;
    const bounds = shell.current.getBoundingClientRect();
    const quads = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 1 && rect.height > 1)
      .map((rect) =>
        rectToPdfQuad(
          {
            left: rect.left - bounds.left,
            top: rect.top - bounds.top,
            width: rect.width,
            height: rect.height,
          },
          viewport,
        ),
      );
    const selectedText = selection.toString().trim();
    const before = range.cloneRange();
    before.selectNodeContents(text.current);
    before.setEnd(range.startContainer, range.startOffset);
    const after = range.cloneRange();
    after.selectNodeContents(text.current);
    after.setStart(range.endContainer, range.endOffset);
    if (selectedText && quads.length)
      onSelection({
        page: pageNumber,
        text: selectedText.slice(0, 20_000),
        quads: quads.slice(0, 200),
        prefix: before.toString().slice(-80),
        suffix: after.toString().slice(0, 80),
      });
  }, [viewport, pageNumber, onSelection]);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const selectionChanged = () => {
      clearTimeout(timer);
      timer = setTimeout(captureSelection, 120);
    };
    window.document.addEventListener('selectionchange', selectionChanged);
    return () => {
      clearTimeout(timer);
      window.document.removeEventListener('selectionchange', selectionChanged);
    };
  }, [active, captureSelection]);

  return (
    <div
      className="pdf-page-slot"
      data-page-number={pageNumber}
      style={{ width, height: height + 30 }}
    >
      <div
        ref={shell}
        className="pdf-page"
        style={{ width, height, filter }}
        onPointerUp={() => window.setTimeout(captureSelection, 30)}
        onKeyUp={captureSelection}
      >
        {active && <canvas ref={canvas} aria-label={`${t('page')} ${pageNumber}`} />}
        {active && <div className={`textLayer ${search ? 'searching' : ''}`} ref={text} />}
        {active && viewport && (
          <div className="pdf-highlights" aria-hidden="true">
            {highlights.flatMap((highlight) =>
              (highlight.quads ?? [])
                .filter((quad) => quad.length === 8)
                .map((quad, index) => {
                  const rect = pdfQuadToRect(quad, viewport);
                  return (
                    <span
                      key={`${highlight.id}-${index}`}
                      className="pdf-highlight"
                      style={{
                        ...rect,
                        backgroundColor:
                          colors[highlight.color] ?? highlight.color ?? colors.yellow,
                      }}
                    />
                  );
                }),
            )}
          </div>
        )}
        {!ready && !error && (
          <div className="pdf-page-placeholder" aria-live="polite">
            {active ? t('loadingPage') : `${t('page')} ${pageNumber}`}
          </div>
        )}
        {error && (
          <div className="pdf-page-placeholder pdf-page-error">
            <div>
              <p>{t('pageError')}</p>
              <button
                type="button"
                className="reader-button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t('retry')}
              </button>
            </div>
          </div>
        )}
      </div>
      <span className="pdf-page-number" aria-hidden="true">
        {pageNumber}
      </span>
    </div>
  );
}
