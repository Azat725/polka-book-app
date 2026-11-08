import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, Check, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { uploadBook } from '../shared/upload';
import { ApiError } from '../shared/api';
import type { Book } from '../shared/types';
import { Modal, formatBytes } from './Primitives';

export function UploadDialog({
  owner,
  onClose,
  onDone,
}: {
  owner: string;
  onClose(): void;
  onDone(book: Book): void;
}) {
  const { t, i18n } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function start(selected: File) {
    if (state === 'uploading') return;
    setFile(selected);
    setState('uploading');
    setError('');
    setProgress(0);
    controller.current = new AbortController();
    try {
      const book = await uploadBook(selected, setProgress, controller.current.signal, owner);
      setState('done');
      onDone(book);
    } catch (error) {
      if (controller.current.signal.aborted) {
        setState('idle');
        return;
      }
      setState('error');
      const code =
        error instanceof ApiError ? error.code : error instanceof Error ? error.message : '';
      setError(i18n.exists(code) ? t(code) : t('error'));
    }
  }
  return (
    <Modal title={t('uploadTitle')} onClose={onClose}>
      <p className="muted">{t('uploadHelp')}</p>
      <div
        className={`upload-drop ${state}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const selected = event.dataTransfer.files[0];
          if (selected) void start(selected);
        }}
      >
        {state === 'done' ? (
          <Check size={42} strokeWidth={1.2} />
        ) : state === 'uploading' ? (
          <LoaderCircle size={42} className="spin" strokeWidth={1.2} />
        ) : (
          <FileText size={48} strokeWidth={1.1} />
        )}
        <h3>{file ? file.name : t('dropPdf')}</h3>
        {file && <p>{formatBytes(file.size, i18n.language)}</p>}
        {state === 'uploading' && (
          <>
            <progress value={progress} max={100} aria-label={t('uploadTransfer')} />
            <span>
              {progress}% · {t(progress < 100 ? 'uploadTransfer' : 'uploadProcessing')}
            </span>
          </>
        )}
        {state === 'done' && <p>{t('uploadReady')}</p>}
        {(state === 'idle' || state === 'error') && (
          <button className="button primary" onClick={() => input.current?.click()}>
            <Upload size={18} />
            {t('choosePdf')}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf"
          aria-label={t('choosePdf')}
          hidden
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void start(selected);
            event.target.value = '';
          }}
        />
      </div>
      {error && (
        <p className="notice error-notice" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {state === 'uploading' ? (
          <button
            className="button subtle"
            onClick={() => {
              controller.current?.abort();
              setState('idle');
            }}
          >
            {t('uploadCancel')}
          </button>
        ) : state === 'error' && file ? (
          <button className="button primary" onClick={() => void start(file)}>
            {t('uploadRetry')}
          </button>
        ) : (
          <button className="button primary" onClick={onClose}>
            {t('close')}
          </button>
        )}
      </div>
    </Modal>
  );
}
