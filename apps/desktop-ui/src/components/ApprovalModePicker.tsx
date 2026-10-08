import { Select } from '@base-ui/react/select';
import { useI18n } from '../i18n';
import type { ApprovalMode } from '../seris';

function PermissionIcon({ mode }: { mode: ApprovalMode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 3.5 6v5.5c0 4.2 3.4 7.6 8.5 9.5 5.1-1.9 8.5-5.3 8.5-9.5V6Z" />
      {mode === 'allow-all' ? <path d="M12 8v5m0 3h.01" /> : <path d="m8 12 2.5 2.5L16 9" />}
    </svg>
  );
}

export function ApprovalModePicker({ value, onChange, disabled }: {
  value: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const choices: { value: ApprovalMode; label: string; description: string }[] = [
    { value: 'ask', label: t('Ask every time'), description: t('Ask before saving strategies or using terminal and browser tools.') },
    { value: 'allow-all', label: t('Allow all actions'), description: t('Allow actions in this chat without asking each time.') },
  ];
  return (
    <Select.Root<ApprovalMode> value={value} items={choices} disabled={disabled} onValueChange={mode => { if (mode) onChange(mode); }}>
      <Select.Trigger
        aria-label={t('Action permissions')}
        title={t('Permissions apply to this chat and are remembered when you reopen it.')}
        className={`approval-mode-trigger ${value === 'allow-all' ? 'allows-all' : ''}`}
      >
        <PermissionIcon mode={value} />
        <span>{value === 'allow-all' ? t('Allow all') : t('Ask every time')}</span>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="top" align="start" sideOffset={8} alignItemWithTrigger={false} className="z-[60] outline-none">
          <Select.Popup className="approval-mode-popup">
            <p className="approval-mode-heading">{t('Permissions for this chat')}</p>
            <Select.List>
              {choices.map(choice => (
                <Select.Item key={choice.value} value={choice.value} className="approval-mode-option">
                  <span className={`approval-mode-option-icon ${choice.value === 'allow-all' ? 'allows-all' : ''}`}>
                    <PermissionIcon mode={choice.value} />
                  </span>
                  <span className="approval-mode-copy">
                    <Select.ItemText>{choice.label}</Select.ItemText>
                    <span className="approval-mode-description">{choice.description}</span>
                  </span>
                  <span className="approval-mode-check">
                    <Select.ItemIndicator>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                    </Select.ItemIndicator>
                  </span>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
