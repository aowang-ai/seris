import { useEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { useI18n } from '../i18n';
import {
  seris,
  type ModelConfig,
  type ModelConnectionInput,
  type ModelOption,
  type ProviderInfo,
  type ConnectionStatus,
  type LocalModelService,
} from '../seris';
import { ModelPicker } from './ModelPicker';
import { TextDetails } from './TextDetails';
import type { MessageKey } from '../locales';

const inputClass =
  'min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none focus:border-ring disabled:opacity-50';
const buttonClass =
  'rounded-md border border-border px-3 py-1.5 text-[12px] transition-colors hover:bg-secondary disabled:opacity-50';
const initialDraft = (
  p: ProviderInfo,
  c?: ConnectionStatus,
): ModelConnectionInput => ({
  id: c?.id,
  name: c?.name ?? p.name,
  provider: c?.provider ?? p.id,
  baseUrl: c?.baseUrl ?? p.baseUrl,
  modelId: c?.modelId ?? p.defaultModelId,
  requiresKey: c?.requiresKey ?? p.requiresKey,
  api: c?.api,
  contextWindow: c?.contextWindow,
  maxTokens: c?.maxTokens,
  reasoning: c?.reasoning,
  models:
    c?.models ??
    (c
      ? [
          {
            id: c.modelId,
            name: p.models.find((m) => m.id === c.modelId)?.name ?? c.modelId,
          },
        ]
      : p.models.filter((m) => m.id === p.defaultModelId)),
  apiKey: '',
});

export function ServiceEditor({
  provider,
  connection,
  local,
  config,
  connected,
  locked,
  onBusyChange,
  onSave,
  onRemove,
  onTest,
}: {
  provider: ProviderInfo;
  connection?: ConnectionStatus;
  local?: LocalModelService;
  config: ModelConfig | null;
  connected: boolean;
  locked?: boolean;
  onBusyChange: (busy: boolean) => void;
  onSave: (input: ModelConnectionInput) => Promise<ConnectionStatus>;
  onRemove?: () => Promise<void>;
  onTest?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => initialDraft(provider, connection));
  const [available, setAvailable] = useState<ModelOption[]>(() =>
    local?.models.length
      ? local.models
      : [
          ...new Map(
            [...provider.models, ...(connection?.models ?? [])].map((m) => [
              m.id,
              m,
            ]),
          ).values(),
        ],
  );
  const [source, setSource] = useState<'catalog' | 'service'>(
    local?.status === 'ready' ? 'service' : 'catalog',
  );
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('connection');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState(false);
  const [manualId, setManualId] = useState('');
  const [feedback, setFeedback] = useState<{
    message: MessageKey;
    values?: Record<string, number>;
    detail?: string;
    error?: boolean;
  } | null>(null);
  useEffect(() => setErrorDetail(null), [feedback]);
  const request = useRef(0);
  const discoveryAbort = useRef<AbortController | null>(null);
  const savedEndpoint = connection?.baseUrl.replace(/\/+$/, '');
  const unchangedEndpoint =
    connection?.provider === draft.provider &&
    savedEndpoint === draft.baseUrl.trim().replace(/\/+$/, '');
  const needsKey =
    draft.requiresKey && (!unchangedEndpoint || !connection?.configured);
  const selected = draft.models ?? [];
  const dirty =
    JSON.stringify({ ...draft, apiKey: '' }) !==
      JSON.stringify(initialDraft(provider, connection)) || !!draft.apiKey;
  const isLocal = ['local', 'ollama', 'lmstudio'].includes(draft.provider);
  function setWorking(value: boolean, saving = false) {
    setBusy(value);
    if (saving) onBusyChange(value);
  }
  function accept(models: ModelOption[]) {
    setAvailable(models);
    setSource('service');
    setSearch('');
    // Preserve explicit choices and custom IDs. First-time local setup gets one usable default.
    setDraft((d) =>
      d.models?.length || !models.length
        ? d
        : { ...d, modelId: models[0].id, models: [models[0]] },
    );
  }
  async function discover() {
    if (!connected || busy) return;
    const version = ++request.current;
    discoveryAbort.current?.abort();
    discoveryAbort.current = new AbortController();
    setWorking(true);
    setFeedback(null);
    try {
      const result = await seris.discoverModels(
        draft,
        discoveryAbort.current.signal,
      );
      if (request.current !== version) return;
      accept(result.models);
      setFeedback({
        values: { count: result.models.length },
        message: result.models.length
          ? '{count} models found'
          : 'The service has no chat models available.',
      });
    } catch (e) {
      if (request.current !== version) return;
      const detail = e instanceof Error ? e.message : String(e);
      const message: MessageKey =
        detail === 'Model service authentication failed'
          ? 'Check the API key or server authentication.'
          : detail === 'Model service unavailable'
            ? isLocal
              ? 'Start the local model server, then try again.'
              : 'Unable to reach this service. Check the endpoint and try again.'
            : 'Unable to fetch models. You can retry or add a custom model.';
      setFeedback({ message, detail, error: true });
    } finally {
      if (request.current === version) setWorking(false);
    }
  }
  useEffect(() => {
    // The Settings scan already probes these endpoints. Reuse it instead of probing twice.
    const usesDetectedEndpoint =
      ['ollama', 'lmstudio'].includes(provider.id) &&
      draft.baseUrl === provider.baseUrl;
    if (isLocal && !usesDetectedEndpoint && !draft.requiresKey && connected)
      void discover();
    return () => {
      request.current++;
      discoveryAbort.current?.abort();
      onBusyChange(false);
    };
  }, []);
  useEffect(() => {
    if (!local || local.baseUrl !== draft.baseUrl || busy || draft.requiresKey)
      return;
    if (local.status === 'ready' || local.status === 'empty') {
      accept(local.models);
      setFeedback(
        local.status === 'empty'
          ? { message: 'The service has no chat models available.' }
          : null,
      );
    } else {
      setFeedback({
        message:
          local.status === 'unauthorized'
            ? 'Check the API key or server authentication.'
            : 'Start the local model server, then try again.',
        error: true,
      });
    }
  }, [local]);
  function toggle(model: ModelOption) {
    const models = selected.some((m) => m.id === model.id)
      ? selected.filter((m) => m.id !== model.id)
      : [...selected, model];
    setDraft({
      ...draft,
      models,
      modelId: models.some((m) => m.id === draft.modelId)
        ? draft.modelId
        : (models[0]?.id ?? ''),
    });
  }
  async function save() {
    setWorking(true, true);
    setFeedback(null);
    try {
      const saved = await onSave(draft);
      setDraft(initialDraft(provider, saved));
      setFeedback(null);
    } catch (e) {
      setFeedback({
        message: 'Unable to update model settings',
        detail: e instanceof Error ? e.message : String(e),
        error: true,
      });
    } finally {
      setWorking(false, true);
    }
  }
  const displayed = [
    ...new Map([...available, ...selected].map((m) => [m.id, m])).values(),
  ].filter((m) =>
    `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const invalid = e.currentTarget.querySelector<HTMLInputElement | HTMLSelectElement>('input:invalid, select:invalid');
          if (invalid) {
            setTab(invalid.closest('[data-service-panel]')?.getAttribute('data-service-panel') ?? 'connection');
            requestAnimationFrame(() => invalid.reportValidity());
            return;
          }
          void save();
        }}
      >
        <header className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-[16px] font-medium">{provider.name}</h3>
          <span className="text-[11px] text-muted-foreground">
            {connection
              ? connection.configured
                ? connection.testedAt &&
                  connection.testedModelId ===
                    (config?.selected?.connectionId === connection.id
                      ? config.selected.modelId
                      : connection.modelId)
                  ? t('Tested')
                  : t('Not tested')
                : t('Setup required')
              : t('New service')}
          </span>
        </header>
        <fieldset disabled={busy || locked || !connected}>
          <Tabs.Root value={tab} onValueChange={(value) => setTab(String(value))}>
            <Tabs.List className="surface-tabs" aria-label={t('Model settings')}>
              <Tabs.Tab value="connection" disabled={busy || locked || !connected}>{t('Connection and models')}</Tabs.Tab>
              <Tabs.Tab value="parameters" disabled={busy || locked || !connected}>{t('Model parameters')}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="connection" keepMounted data-service-panel="connection" className="service-tab-panel space-y-4">
              <label className="block text-[12px]">
                {t('Service name')}
                <input
                  required
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
              {(!provider.requiresKey ||
                ['openai-compatible', 'anthropic-compatible'].includes(
                  provider.id,
                )) && (
                <label className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={draft.requiresKey}
                    onChange={(e) =>
                      setDraft({ ...draft, requiresKey: e.target.checked })
                    }
                  />
                  {t('Requires API key')}
                </label>
              )}
              {['local', 'ollama', 'lmstudio', 'openai-compatible'].includes(
                draft.provider,
              ) && (
                <label className="block text-[12px]">
                  {t('API protocol')}
                  <select
                    aria-label={t('API protocol')}
                    className={`${inputClass} mt-1.5`}
                    value={draft.api ?? 'openai-completions'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        api: e.target.value as ModelConnectionInput['api'],
                      })
                    }
                  >
                    <option value="openai-completions">Chat Completions</option>
                    <option value="openai-responses">Responses</option>
                  </select>
                </label>
              )}

              {draft.requiresKey && (
                <label className="block text-[12px]">
                  {t('API key')}
                  <input
                    type="password"
                    autoComplete="off"
                    className={`${inputClass} mt-1.5`}
                    value={draft.apiKey ?? ''}
                    onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                    required={needsKey}
                    placeholder={
                      connection && !needsKey
                        ? t('Leave blank to keep the saved key')
                        : undefined
                    }
                  />
                </label>
              )}
              {draft.requiresKey && (
                <p className="text-[11px] text-muted-foreground">
                  {config?.credentialStorage === 'keychain'
                    ? t('Keys are saved in your system keychain.')
                    : t(
                        'Keys are kept for this core session. Use environment variables for automatic CLI startup.',
                      )}
                </p>
              )}
              <label className="block text-[12px]">
                {t('API endpoint')}
                <input
                  type="url"
                  required
                  className={`${inputClass} mt-1.5`}
                  value={draft.baseUrl}
                  onChange={(e) => {
                    request.current++;
                    setDraft({ ...draft, baseUrl: e.target.value });
                    setSource('catalog');
                    setAvailable(draft.models ?? []);
                  }}
                />
              </label>
              <div className="border-t border-border pt-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-[13px] font-medium">
                      {t('Available models')}
                    </h4>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {source === 'service'
                        ? t('From this service')
                        : provider.models.length
                          ? t(
                              'Built-in catalog · availability depends on your account',
                            )
                          : t('Fetch the model list from your server.')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={
                      busy || !draft.baseUrl || (needsKey && !draft.apiKey?.trim())
                    }
                    onClick={() => void discover()}
                  >
                    {busy ? t('Fetching…') : t('Fetch models')}
                  </button>
                </div>
                <input
                  aria-label={t('Search models')}
                  placeholder={t('Search models…')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={inputClass}
                />
                <div
                  className="mt-2 max-h-[250px] overflow-y-auto rounded-md border border-border"
                  aria-label={t('Available models')}
                >
                  {displayed.map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 text-[12px] last:border-0 hover:bg-secondary/50"
                    >
                      <input
                        type="checkbox"
                        aria-label={m.name}
                        checked={selected.some((x) => x.id === m.id)}
                        onChange={() => toggle(m)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.name}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {m.id}
                        </span>
                      </span>
                      {m.toolUse !== undefined && (
                        <span className="text-[10px] text-muted-foreground">
                          {m.toolUse ? t('Tool calling') : t('No tool calling')}
                        </span>
                      )}
                      {m.reasoning && (
                        <span className="text-[10px] text-muted-foreground">
                          {t('Reasoning')}
                        </span>
                      )}
                    </label>
                  ))}
                  {!displayed.length && (
                    <p className="p-5 text-center text-[12px] text-muted-foreground">
                      {search
                        ? t('No matching models')
                        : t('No models yet. Fetch models to continue.')}
                    </p>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    {t('{count} models enabled', { count: selected.length })}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setManual(!manual)}
                  >
                    {t('Add custom model')}
                  </button>
                </div>
                {manual && (
                  <div className="mt-3 flex gap-2">
                    <input
                      aria-label={t('Custom model ID')}
                      placeholder={t('Custom model ID')}
                      value={manualId}
                      onChange={(e) => setManualId(e.target.value)}
                      className={inputClass}
                      maxLength={200}
                    />
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={!manualId.trim()}
                      onClick={() => {
                        const id = manualId.trim();
                        const model = available.find((m) => m.id === id) ?? {
                          id,
                          name: id,
                        };
                        setAvailable((a) =>
                          a.some((m) => m.id === id) ? a : [...a, model],
                        );
                        if (!selected.some((m) => m.id === id))
                          setDraft({
                            ...draft,
                            modelId: draft.modelId || id,
                            models: [...selected, model],
                          });
                        setSearch('');
                        setManualId('');
                        setManual(false);
                      }}
                    >
                      {t('Add')}
                    </button>
                  </div>
                )}
              </div>
              {!!selected.length && (
                <div className="space-y-1.5">
                  <p className="text-[12px]">{t('Default model')}</p>
                  <ModelPicker
                    choices={selected.map((model) => ({
                      key: model.id,
                      group: draft.name,
                      model,
                      selection: { connectionId: draft.id ?? '', modelId: model.id },
                    }))}
                    value={{ connectionId: draft.id ?? '', modelId: draft.modelId }}
                    disabled={busy || locked || !connected}
                    onChange={(s) => setDraft({ ...draft, modelId: s.modelId })}
                  />
                </div>
              )}
            </Tabs.Panel>
            <Tabs.Panel value="parameters" keepMounted data-service-panel="parameters" className="service-tab-panel space-y-4">
              <p className="text-[11px] text-muted-foreground">
                {t(
                  'Known models use the provider’s capabilities. Only override these for custom models.',
                )}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(['contextWindow', 'maxTokens'] as const).map((field) => (
                  <label key={field} className="block text-[12px]">
                    {field === 'contextWindow'
                      ? t('Context window')
                      : t('Max output tokens')}
                    <input
                      type="number"
                      min={1}
                      max={10000000}
                      placeholder={t('Automatic')}
                      value={draft[field] ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [field]: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                      className={`${inputClass} mt-1.5`}
                    />
                  </label>
                ))}
              </div>
              <label className="block text-[12px]">
                {t('Reasoning support')}
                <select
                  value={
                    draft.reasoning === undefined
                      ? 'auto'
                      : String(draft.reasoning)
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reasoning:
                        e.target.value === 'auto'
                          ? undefined
                          : e.target.value === 'true',
                    })
                  }
                  className={`${inputClass} mt-1.5`}
                >
                  <option value="auto">{t('Automatic')}</option>
                  <option value="true">{t('Supported')}</option>
                  <option value="false">{t('Not supported')}</option>
                </select>
              </label>

            </Tabs.Panel>
          </Tabs.Root>
        </fieldset>
        {feedback && (
          <div
            role={feedback.error ? 'alert' : 'status'}
            className={`mt-3 text-[12px] ${feedback.error ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            <p>{t(feedback.message, feedback.values)}</p>
            {feedback.detail && (
              feedback.detail.length <= 180 && !feedback.detail.includes('\n') ? (
                <p className="mt-1 break-words text-muted-foreground">{feedback.detail}</p>
              ) : (
                <button type="button" className="detail-link mt-2" aria-haspopup="dialog" onClick={() => setErrorDetail(feedback.detail!)}>
                  {t('View details')}
                </button>
              )
            )}
          </div>
        )}
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <div className="flex gap-2">
            {onTest && (
              <button
                type="button"
                className={buttonClass}
                disabled={
                  busy || locked || !connected || !connection?.configured || dirty
                }
                title={dirty ? t('Save changes before testing.') : undefined}
                onClick={() => void onTest()}
              >
                {t('Test connection')}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy || locked || !connected}
                onClick={() => void onRemove()}
              >
                {t('Remove')}
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={
              busy || locked || !connected || !selected.length || !draft.modelId
            }
            className="rounded-md bg-primary px-4 py-2 text-[12px] text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {busy ? t('Working…') : t('Save changes')}
          </button>
        </div>
      </form>
      <TextDetails open={errorDetail !== null} title={t('Error details')} text={errorDetail ?? ''} onClose={() => setErrorDetail(null)} />
    </>
  );
}
