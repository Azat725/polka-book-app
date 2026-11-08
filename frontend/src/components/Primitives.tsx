import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, BookOpen, Upload, LoaderCircle } from 'lucide-react';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label={t('close')} onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function EmptyState({
  title,
  text,
  onUpload,
  compact = false,
}: {
  title: string;
  text?: string;
  onUpload?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`empty-state ${compact ? 'empty-compact' : ''}`}>
      <div className="empty-art" aria-hidden="true">
        <span />
        <span />
        <span />
        <BookOpen size={40} strokeWidth={1} />
      </div>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {onUpload && (
        <button className="button primary" onClick={onUpload}>
          <Upload size={18} />
          {t('upload')}
        </button>
      )}
    </div>
  );
}
export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={26} />
      <span>{t('loading')}</span>
    </div>
  );
}
export function ErrorNotice({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="notice error-notice">
      <p>{message || t('error')}</p>
      {onRetry && (
        <button className="button subtle" onClick={onRetry}>
          {t('retry')}
        </button>
      )}
    </div>
  );
}
export function formatBytes(bytes: number, language = 'ru') {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const unit = bytes >= 1e9 ? 'gigabyte' : 'megabyte';
  return new Intl.NumberFormat(language, { style: 'unit', unit, maximumFractionDigits: 1 }).format(
    bytes / (unit === 'gigabyte' ? 1e9 : 1e6),
  );
}
