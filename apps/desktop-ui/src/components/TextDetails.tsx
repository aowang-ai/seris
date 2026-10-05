import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { Modal } from './Modal';

/** Long diagnostic output has its own scroll area, leaving the calling view in place. */
export function TextDetails({
  open,
  title,
  text,
  onClose,
}: {
  open: boolean;
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose} className="text-details">
      <TextOutput key={String(open)} text={text} />
    </Modal>
  );
}

export function TextOutput({ text, formatJson = false }: { text: string; formatJson?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const displayText = useMemo(() => {
    if (formatJson) {
      try { return JSON.stringify(JSON.parse(text), null, 2); } catch { /* Plain text output. */ }
    }
    return text;
  }, [text, formatJson]);
  useEffect(() => {
    setCopied(false);
    setCopyError(false);
  }, [text]);
  return (
    <div className="text-output">
      <div className="text-details-toolbar">
        <button type="button" onClick={() => {
          void navigator.clipboard.writeText(displayText).then(() => {
            setCopied(true);
            setCopyError(false);
          }).catch(() => setCopyError(true));
        }}>
          {copied ? t('copied') : t('copy')}
        </button>
        {copyError && <span role="alert">{t('Unable to copy. Select the text to copy it manually.')}</span>}
      </div>
      <pre tabIndex={0}>{displayText}</pre>
    </div>
  );
}
