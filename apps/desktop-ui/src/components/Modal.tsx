import { useI18n } from '../i18n';
import { type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';

/** Base UI owns focus, dismissal and retaining the popup through its exit transition. */
export function Modal({
  open,
  title,
  onClose,
  children,
  className = '',
  dismissible = true,
  initialFocus,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next) {
          if (dismissible) onClose();
          else details.cancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="market-modal-backdrop" />
        <Dialog.Viewport
          className={`market-modal-viewport ${className === 'market-search-modal' ? 'market-search-viewport' : ''}`}
        >
          <Dialog.Popup
            initialFocus={initialFocus}
            className={`market-modal ${className}`}
          >
            <div className="market-modal-content">
              <header>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Close
                  aria-label={t('Close {title}', { title })}
                  disabled={!dismissible}
                >
                  ×
                </Dialog.Close>
              </header>
              {children}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
