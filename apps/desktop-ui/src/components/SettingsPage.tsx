import { useEffect, useState } from 'react';
import { useI18n, type Language } from '../i18n';
import {
  seris,
  type ModelConfig,
  type LocalModelService,
  type ProviderInfo,
} from '../seris';
import { ServiceEditor } from './ServiceEditor';
import { ModelPicker, connectionModelChoices } from './ModelPicker';
import { Modal } from './Modal';
import type { MessageKey } from '../locales';

const inputClass =
  'min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-ring disabled:opacity-50';
const buttonClass =
  'rounded-md border border-border px-3 py-1.5 text-[12px] transition-colors hover:bg-secondary disabled:opacity-50';
export function SettingsPage({
  config,
  connected,
  onConfigChange,
}: {
  config: ModelConfig | null;
  connected: boolean;
  onConfigChange: (config: ModelConfig) => void;
}) {
  const { t, language, setLanguage } = useI18n();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [local, setLocal] = useState<LocalModelService[]>([]);
  const [scanning, setScanning] = useState(false);
  const [active, setActive] = useState(config?.selected?.connectionId ?? '');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<MessageKey | ''>('');
  useEffect(() => {
    if (!connected) return;
    let live = true;
    setScanning(true);
    void seris
      .providers()
      .then((p) => {
        if (!live) return;
        setProviders(p);
        setActive(
          (a) => a || config?.selected?.connectionId || `new:${p[0].id}`,
        );
      })
      .catch(() => {
        if (live) setFeedback('Unable to update model settings');
      });
    void seris
      .localModels()
      .then((s) => {
        if (live) setLocal(s);
      })
      .catch(() => {
        if (live) setFeedback('Unable to detect local services');
      })
      .finally(() => {
        if (live) setScanning(false);
      });
    return () => {
      live = false;
    };
  }, [connected]);
  async function scan() {
    if (scanning || !connected) return;
    setScanning(true);
    try {
      setLocal(await seris.localModels());
    } catch {
      setFeedback('Unable to detect local services');
    } finally {
      setScanning(false);
    }
  }
  async function act(op: () => Promise<ModelConfig>, message: MessageKey) {
    if (busy || !connected) return;
    setBusy(true);
    setFeedback('');
    try {
      const next = await op();
      onConfigChange(next);
      setFeedback(message);
      return next;
    } catch {
      setFeedback(
        message === 'Connection tested'
          ? 'Connection test failed'
          : 'Unable to update model settings',
      );
    } finally {
      setBusy(false);
    }
  }
  function name(p: ProviderInfo) {
    return p.id === 'local'
      ? t('Local model')
      : p.id === 'openai-compatible'
        ? t('OpenAI compatible')
        : p.id === 'anthropic-compatible'
          ? t('Anthropic compatible')
          : p.name;
  }
  const connection = config?.connections.find((c) => c.id === active);
  const provider = providers.find(
    (p) => p.id === (connection?.provider ?? active.replace(/^new:/, '')),
  );
  const filtered = providers.filter((p) =>
    `${name(p)} ${p.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  function choose(id: string) {
    setActive(id);
    setFeedback('');
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-7">
          <h1 className="text-[20px] font-medium tracking-tight">
            {t('Settings')}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {t('Manage your workspace preferences.')}
          </p>
        </header>
        <section
          className="mb-7 flex items-center justify-between gap-4"
          aria-labelledby="language-settings-title"
        >
          <div>
            <h2
              id="language-settings-title"
              className="text-[14px] font-medium"
            >
              {t('Language')}
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {t('Choose the display language. Changes apply immediately.')}
            </p>
          </div>
          <select
            aria-label={t('Language')}
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="rounded-md border border-input bg-background px-3 py-2 text-[13px]"
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </section>
        {config?.credentialError && (
          <p role="alert" className="mb-4 text-[12px] text-destructive">
            {t(
              'System keychain is unavailable. Unlock it and restart Seris, or re-enter your key.',
            )}
          </p>
        )}
        <section aria-labelledby="model-settings-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="model-settings-title" className="text-[14px] font-medium">
                {t('Models')}
              </h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {t(
                  'Switches apply to your next message. Active runs keep their current model.',
                )}
              </p>
            </div>
            {config?.configured && (
              <div className="w-[240px]">
                <ModelPicker
                  choices={connectionModelChoices(config)}
                  value={config.selected}
                  disabled={busy || !connected}
                  favorites
                  onChange={(s) =>
                    void act(
                      () => seris.selectModel(s),
                      'Current model updated',
                    )
                  }
                />
              </div>
            )}
          </div>
          <div className="grid min-h-[480px] grid-cols-[180px_minmax(0,1fr)] overflow-hidden rounded-xl border border-border">
            <nav
              aria-label={t('Services')}
              className="max-h-[620px] overflow-y-auto border-r border-border bg-secondary/20 p-2"
            >
              <div className="flex items-center justify-between px-2 py-2">
                <span className="text-[12px] font-medium">{t('Services')}</span>
                <button
                  type="button"
                  aria-label={t('Add service')}
                  title={t('Add service')}
                  className="rounded p-1 text-[16px] hover:bg-secondary"
                  disabled={!connected || busy}
                  onClick={() => {
                    setSearch('');
                    setAdding(true);
                  }}
                >
                  +
                </button>
              </div>
              <div className="space-y-1">
                {config?.connections
                  .filter(
                    (c) =>
                      !['ollama', 'lmstudio'].includes(c.provider) ||
                      c.baseUrl !==
                        providers.find((p) => p.id === c.provider)?.baseUrl,
                  )
                  .map((c) => (
                    <button
                      key={c.id}
                      disabled={busy}
                      onClick={() => choose(c.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] transition-colors ${active === c.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.configured ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                      />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
              </div>
              <div className="mt-3 space-y-1">
                {providers
                  .filter(
                    (p) =>
                      !['ollama', 'lmstudio', 'local'].includes(p.id) &&
                      !config?.connections.some((c) => c.provider === p.id),
                  )
                  .map((p) => (
                    <button
                      key={p.id}
                      disabled={busy}
                      onClick={() => choose(`new:${p.id}`)}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] transition-colors ${active === `new:${p.id}` ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
                      <span className="truncate">{name(p)}</span>
                    </button>
                  ))}
              </div>
              <div className="mt-5 flex items-center justify-between px-2">
                <span className="text-[11px] text-muted-foreground">
                  {t('Local services')}
                </span>
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  disabled={scanning || !connected}
                  onClick={() => void scan()}
                >
                  {scanning ? t('Detecting…') : t('Detect')}
                </button>
              </div>
              {providers
                .filter((p) => ['ollama', 'lmstudio'].includes(p.id))
                .map((p) => {
                  const detected = local.find((s) => s.provider === p.id);
                  const saved = config?.connections.find(
                    (c) => c.provider === p.id && c.baseUrl === p.baseUrl,
                  );
                  return (
                    <button
                      key={p.id}
                      disabled={busy}
                      onClick={() => choose(saved?.id ?? `new:${p.id}`)}
                      className={`mt-1 w-full rounded-md px-3 py-2 text-left transition-colors ${active === `new:${p.id}` || active === saved?.id ? 'bg-secondary' : 'hover:bg-secondary/60'}`}
                    >
                      <span className="text-[12px]">
                        {saved?.name ?? p.name}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {detected?.status === 'ready'
                          ? t('{count} models found', {
                              count: detected.models.length,
                            })
                          : detected?.status === 'empty'
                            ? t('No models installed')
                            : detected?.status === 'unauthorized'
                              ? t('Authentication required')
                              : scanning
                                ? t('Detecting…')
                                : t('Not connected')}
                      </span>
                    </button>
                  );
                })}
              {!config?.connections.length && (
                <p className="px-3 pt-5 text-[11px] leading-relaxed text-muted-foreground">
                  {t(
                    'Choose a provider to connect, or use a detected local service.',
                  )}
                </p>
              )}
            </nav>
            <div className="min-w-0 p-5">
              {provider ? (
                <ServiceEditor
                  key={active}
                  provider={{ ...provider, name: name(provider) }}
                  connection={connection}
                  local={local.find((s) => s.provider === provider.id)}
                  config={config}
                  connected={connected}
                  locked={busy}
                  onBusyChange={setBusy}
                  onSave={async (draft) => {
                    const next = await seris.saveConnection(draft);
                    onConfigChange(next);
                    const saved =
                      next.connections.find((c) => c.id === draft.id) ??
                      next.connections.at(-1)!;
                    setActive(saved.id);
                    setFeedback('Connection saved');
                    return saved;
                  }}
                  onRemove={
                    connection
                      ? async () => {
                          const next = await act(
                            () => seris.removeConnection(connection.id),
                            'Connection removed',
                          );
                          if (next)
                            setActive(
                              next.selected?.connectionId ??
                                `new:${provider.id}`,
                            );
                        }
                      : undefined
                  }
                  onTest={
                    connection
                      ? async () => {
                          await act(
                            () => seris.testConnection(connection.id),
                            'Connection tested',
                          );
                        }
                      : undefined
                  }
                />
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  {t('Waiting for the core connection…')}
                </p>
              )}
            </div>
          </div>
          {feedback && (
            <p role="status" className="mt-3 text-[12px] text-muted-foreground">
              {t(feedback)}
            </p>
          )}
          {!connected && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              {t('Waiting for the core connection…')}
            </p>
          )}
        </section>
      </div>
      <Modal
        open={adding}
        title={t('Add service')}
        onClose={() => setAdding(false)}
      >
        <div className="p-4">
          <input
            aria-label={t('Search providers')}
            placeholder={t('Search providers…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
            autoFocus
          />
          <div className="mt-3 max-h-[360px] overflow-y-auto">
            {filtered.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center justify-between rounded-md px-3 py-3 text-left text-[13px] transition-colors hover:bg-secondary"
                onClick={() => {
                  choose(`new:${p.id}`);
                  setAdding(false);
                }}
              >
                <span>{name(p)}</span>
                <span className="text-[11px] text-muted-foreground">
                  {p.requiresKey ? t('Cloud service') : t('Local service')}
                </span>
              </button>
            ))}
            {!filtered.length && (
              <p className="p-5 text-center text-[12px] text-muted-foreground">
                {t('No matching providers')}
              </p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
