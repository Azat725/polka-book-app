import { useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from './pdf.worker.ts?worker&url';
import { createPdfTransport } from './transport';

GlobalWorkerOptions.workerSrc = workerUrl;

export function useDocument(bookId: string) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [incorrectPassword, setIncorrectPassword] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const passwordCallback = useRef<((password: string) => void) | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setDocument(null);
        setError(false);
        setPasswordRequired(false);
      }
    });
    const controller = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    async function load() {
      const range = await createPdfTransport(bookId, controller, () => {
        if (active) setError(true);
        void task?.destroy();
      });
      if (!active) return;
      task = getDocument({
        range,
        cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
        wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
        disableAutoFetch: true,
        disableStream: true,
        rangeChunkSize: 256 * 1024,
        enableXfa: false,
        maxImageSize: 24_000_000,
      });
      task.onPassword = (callback: (password: string) => void, reason: number) => {
        if (!active) return;
        passwordCallback.current = callback;
        setIncorrectPassword(reason === PasswordResponses.INCORRECT_PASSWORD);
        setPasswordRequired(true);
      };
      const pdf = await task.promise;
      if (!active) return;
      setDocument(pdf);
      setPasswordRequired(false);
    }
    void load().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      passwordCallback.current = null;
      controller.abort();
      void task?.destroy();
    };
  }, [bookId, attempt]);

  function unlock(password: string) {
    passwordCallback.current?.(password);
    setPasswordRequired(false);
  }

  return {
    document,
    error,
    passwordRequired,
    incorrectPassword,
    unlock,
    retry: () => setAttempt((value) => value + 1),
  };
}
