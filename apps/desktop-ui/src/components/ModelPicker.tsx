import { Combobox } from '@base-ui/react/combobox';
import { useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import type { ModelConfig, ModelOption, ModelSelection } from '../seris';

export interface ModelChoice {
  key: string;
  group: string;
  model: ModelOption;
  selection: ModelSelection;
}
export function connectionModelChoices(config: ModelConfig): ModelChoice[] {
  return config.connections
    .filter((c) => c.configured)
    .flatMap((c) => {
      const models = [...(c.models ?? [{ id: c.modelId, name: c.modelId }])];
      if (
        config.selected?.connectionId === c.id &&
        !models.some((m) => m.id === config.selected!.modelId)
      )
        models.push({
          id: config.selected.modelId,
          name: config.selected.modelId,
        });
      return models.map((model) => ({
        key: `${c.id}:${model.id}`,
        group: c.name,
        model,
        selection: { connectionId: c.id, modelId: model.id },
      }));
    });
}

/** Base UI owns filtering, keyboard navigation, focus and popup dismissal. */
export function ModelPicker({
  choices,
  value,
  onChange,
  disabled,
  compact = false,
  favorites = false,
}: {
  choices: ModelChoice[];
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  disabled?: boolean;
  compact?: boolean;
  favorites?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [pins, setPins] = useState<string[]>(() => {
    try {
      const p = JSON.parse(localStorage.getItem('seris.pinnedModels') ?? '[]');
      return Array.isArray(p) ? p.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const groups = useMemo(() => {
    const result = new Map<string, ModelChoice[]>();
    if (favorites && choices.some((c) => pins.includes(c.key)))
      result.set(t('Favorites'), []);
    for (const choice of choices) {
      const group =
        favorites && pins.includes(choice.key) ? t('Favorites') : choice.group;
      const items = result.get(group) ?? [];
      items.push(choice);
      result.set(group, items);
    }
    return [...result].map(([label, items]) => ({ label, items }));
  }, [choices, favorites, pins, t]);
  const selected =
    choices.find(
      (c) =>
        c.selection.connectionId === value?.connectionId &&
        c.model.id === value?.modelId,
    ) ?? null;
  function pin(key: string) {
    const next = pins.includes(key)
      ? pins.filter((k) => k !== key)
      : [...pins, key];
    setPins(next);
    localStorage.setItem('seris.pinnedModels', JSON.stringify(next));
  }
  return (
    <Combobox.Root<ModelChoice>
      items={groups}
      value={selected}
      disabled={disabled}
      autoHighlight
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={() => setQuery('')}
      itemToStringLabel={(c) => `${c.model.name} ${c.model.id} ${c.group}`}
      isItemEqualToValue={(a, b) => a.key === b.key}
      onValueChange={(c) => {
        if (c) onChange(c.selection);
      }}
    >
      <Combobox.Trigger
        aria-label={t('Model')}
        title={
          selected ? `${selected.group} · ${selected.model.id}` : undefined
        }
        className={
          compact
            ? 'flex min-w-0 max-w-[240px] items-center gap-1.5 text-[11px] outline-none'
            : 'flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none focus-visible:border-ring'
        }
      >
        <span className="min-w-0 truncate">
          {selected?.model.name ?? t('Choose a model')}
        </span>
        <svg
          className="shrink-0"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          sideOffset={8}
          align="start"
          className="z-[60] outline-none"
        >
          <Combobox.Popup className="w-[340px] max-w-[calc(100vw-32px)] origin-[var(--transform-origin)] overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-lg transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 motion-reduce:transition-none">
            <div className="border-b border-border p-2">
              <Combobox.Input
                aria-label={t('Search models')}
                placeholder={t('Search models…')}
                className="w-full bg-transparent px-2 py-2 text-[13px] outline-none"
              />
            </div>
            <Combobox.Empty className="p-5 empty:p-0 text-center text-[12px] text-muted-foreground">
              {t('No matching models')}
            </Combobox.Empty>
            <Combobox.List className="max-h-[320px] overflow-y-auto overscroll-contain p-1">
              {(group: { label: string; items: ModelChoice[] }) => (
                <Combobox.Group key={group.label} items={group.items}>
                  <Combobox.GroupLabel className="px-3 pb-1 pt-3 text-[11px] text-muted-foreground">
                    {group.label}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(choice: ModelChoice) => (
                      <Combobox.Item
                        key={choice.key}
                        value={choice}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[12px] outline-none data-[highlighted]:bg-secondary"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {choice.model.name}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {choice.model.id}
                          </span>
                        </span>
                        <Combobox.ItemIndicator aria-hidden="true">
                          ✓
                        </Combobox.ItemIndicator>
                        {favorites && (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={
                              pins.includes(choice.key)
                                ? t('Unpin model')
                                : t('Pin model')
                            }
                            aria-pressed={pins.includes(choice.key)}
                            className="p-1 text-muted-foreground hover:text-foreground"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              pin(choice.key);
                            }}
                          >
                            {pins.includes(choice.key) ? '★' : '☆'}
                          </button>
                        )}
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
