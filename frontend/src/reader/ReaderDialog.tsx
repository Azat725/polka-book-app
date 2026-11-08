import { useEffect, useId, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function ReaderDialog({
  title,
  onClose,
  children,
  dismissible = true,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  dismissible?: boolean;
}) {
  const { t } = useTranslation('reader');
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    (
      el?.querySelector<HTMLElement>('input,textarea,select') ??
      el?.querySelector<HTMLElement>('button')
    )?.focus();
    return () => {
      previous?.focus();
    };
  }, [dismissible]);
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (dismissible) onClose();
    }
    if (event.key !== 'Tab') return;
    const nodes = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('button,input,textarea,select,[tabindex]'),
    ).filter((node) => !node.hasAttribute('disabled') && node.tabIndex >= 0);
    const first = nodes[0],
      last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return (
    <div
      className="reader-scrim"
      onPointerDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="reader-dialog"
        onKeyDown={keyboard}
      >
        <div className="reader-dialog-header">
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <button
              type="button"
              className="reader-icon"
              onClick={onClose}
              aria-label={t('cancel')}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        {children}
      </section>
    </div>
  );
}
