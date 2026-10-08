import { Select } from '@base-ui/react/select';
import { useI18n } from '../i18n';
import type { ApprovalMode } from '../seris';

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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3 3.5 6v5.5c0 4.2 3.4 7.6 8.5 9.5 5.1-1.9 8.5-5.3 8.5-9.5V6Z" />
          {value === 'allow-all' ? <path d="m8 12 2.5 2.5L16 9" /> : <path d="M12 8v5m0 3h.01" />}
        </svg>
        <span>{choices.find(choice => choice.value === value)!.label}</span>
        <Select.Icon>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="top" align="start" sideOffset={8} alignItemWithTrigger={false} className="z-[60] outline-none">
          <Select.Popup className="approval-mode-popup">
            <p className="approval-mode-heading">{t('Permissions for this chat')}</p>
            <Select.List>
              {choices.map(choice => (
                <Select.Item key={choice.value} value={choice.value} className="approval-mode-option">
                  <span className="approval-mode-check">
                    <Select.ItemIndicator>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                    </Select.ItemIndicator>
                  </span>
                  <span className="approval-mode-copy">
                    <Select.ItemText>{choice.label}</Select.ItemText>
                    <span className="approval-mode-description">{choice.description}</span>
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
