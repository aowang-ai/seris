import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ModelConfig,
  ModelConnection,
  ModelConnectionInput,
  ModelSelection,
} from '../protocol.js';
import {
  buildKernel,
  providerCatalog,
  type KernelPair,
} from './streamFactory.js';
import { createSecretStore, type SecretStore } from './credentials.js';
import { dataPath } from './paths.js';
import { discoverModels, normalizeModelEndpoint } from './modelDiscovery.js';

type SavedConnection = ModelConnection & {
  testedAt?: number;
  testedModelId?: string;
};
interface SavedSettings {
  connections: SavedConnection[];
  selected: ModelSelection | null;
}
const catalog = providerCatalog();
const envKeys: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  moonshotai: ['MOONSHOT_API_KEY'],
  'moonshotai-cn': ['MOONSHOT_CN_API_KEY'],
  'kimi-coding': ['KIMI_API_KEY'],
};
const envValue = (names: string[], env: NodeJS.ProcessEnv) =>
  names.map((n) => env[n]?.trim()).find(Boolean);

/** Metadata is durable; secrets live only in the injected credential store or launch environment. */
export class ModelSettings {
  private state: SavedSettings = { connections: [], selected: null };
  private keys = new Map<string, string>();
  private credentialError = false;
  private queue: Promise<unknown> = Promise.resolve();
  kernel?: KernelPair;
  constructor(
    private file = dataPath('models.json'),
    private secrets: SecretStore = createSecretStore(),
    private env = process.env,
  ) {}
  async init(): Promise<void> {
    let stored = false;
    try {
      this.state = JSON.parse(readFileSync(this.file, 'utf8'));
      stored = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    // Environment-only launch stays useful for CLI and packaged smoke tests.
    if (!stored) {
      for (const p of catalog) {
        const key = envValue(envKeys[p.id] ?? [], this.env);
        if (!key) continue;
        const prefix = p.id.toUpperCase().replace(/-/g, '_');
        this.state.connections.push({
          id: randomUUID(),
          name: p.name,
          provider: p.id,
          baseUrl: this.env[`${prefix}_BASE_URL`]?.trim() || p.baseUrl,
          modelId:
            (p.id === 'anthropic'
              ? envValue(
                  ['ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_MODEL'],
                  this.env,
                )
              : this.env[`${prefix}_MODEL`]?.trim()) || p.defaultModelId,
          requiresKey: true,
        });
      }
      this.state.selected = this.state.connections[0]
        ? {
            connectionId: this.state.connections[0].id,
            modelId: this.state.connections[0].modelId,
          }
        : null;
    }
    await Promise.all(
      this.state.connections.map(async (c) => {
        let savedKey: string | undefined;
        try {
          savedKey = await this.secrets.read(c.id);
        } catch {
          this.credentialError = true;
        }
        const key = savedKey ?? this.environmentKey(c);
        if (key) this.keys.set(c.id, key);
      }),
    );
    this.kernel = this.resolve(this.state);
  }
  private environmentKey(c: ModelConnection): string | undefined {
    const p = catalog.find((p) => p.id === c.provider);
    if (!p || !envKeys[c.provider]) return;
    const prefix = c.provider.toUpperCase().replace(/-/g, '_');
    const endpoint = (
      this.env[`${prefix}_BASE_URL`]?.trim() || p.baseUrl
    ).replace(/\/+$/, '');
    return c.baseUrl.replace(/\/+$/, '') === endpoint
      ? envValue(envKeys[c.provider], this.env)
      : undefined;
  }
  private ready(c: ModelConnection) {
    return !c.requiresKey || !!this.keys.get(c.id);
  }
  config(): ModelConfig {
    return {
      connections: this.state.connections.map((c) => ({
        ...c,
        configured: this.ready(c),
      })),
      selected: this.state.selected ? { ...this.state.selected } : null,
      configured: !!this.kernel,
      credentialStorage: this.secrets.storage,
      ...(this.credentialError ? { credentialError: true } : {}),
    };
  }
  private resolve(state: SavedSettings): KernelPair | undefined {
    const c = state.connections.find(
      (c) => c.id === state.selected?.connectionId,
    );
    return c && this.ready(c)
      ? buildKernel(c, this.keys.get(c.id), state.selected!.modelId)
      : undefined;
  }
  private persist(state: SavedSettings): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
  private mutate<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op);
    this.queue = next.catch(() => undefined);
    return next;
  }
  async discover(input: ModelConnectionInput) {
    const existing = this.state.connections.find((c) => c.id === input.id);
    if (input.id && !existing) throw new Error('Unknown connection');
    const baseUrl = normalizeModelEndpoint(input.baseUrl);
    const sameEndpoint =
      existing?.provider === input.provider && existing.baseUrl === baseUrl;
    const suppliedKey =
      typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const key =
      suppliedKey || (sameEndpoint ? this.keys.get(existing!.id) : undefined);
    if (input.requiresKey && !key)
      throw new Error('API key is required for this connection');
    return discoverModels({ provider: input.provider, baseUrl }, key);
  }
  save(input: ModelConnectionInput): Promise<ModelConfig> {
    return this.mutate(async () => {
      const existing = this.state.connections.find((c) => c.id === input.id);
      if (input.id && !existing) throw new Error('Unknown connection');
      const p = catalog.find((p) => p.id === input.provider);
      if (!p) throw new Error('Unknown provider');
      const baseUrl = normalizeModelEndpoint(input.baseUrl);
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const modelId =
        typeof input.modelId === 'string' ? input.modelId.trim() : '';
      if (!name || name.length > 80 || !modelId || modelId.length > 200)
        throw new Error('Connection name and model are required');
      const c: ModelConnection = {
        id: existing?.id ?? randomUUID(),
        name,
        provider: p.id,
        baseUrl,
        modelId,
        requiresKey: envKeys[p.id] ? true : input.requiresKey !== false,
      };
      if (input.models !== undefined) {
        if (
          !Array.isArray(input.models) ||
          !input.models.length ||
          input.models.length > 1000
        )
          throw new Error('Choose at least one model');
        c.models = [];
        for (const m of input.models) {
          if (
            !m ||
            typeof m.id !== 'string' ||
            !m.id.trim() ||
            m.id.length > 200 ||
            typeof m.name !== 'string' ||
            !m.name.trim() ||
            m.name.length > 200
          )
            throw new Error('Invalid model');
          const option: NonNullable<ModelConnection['models']>[number] = {
            id: m.id.trim(),
            name: m.name.trim(),
          };
          for (const field of ['contextWindow', 'maxTokens'] as const) {
            if (m[field] === undefined) continue;
            if (
              !Number.isSafeInteger(m[field]) ||
              m[field]! < 1 ||
              m[field]! > 10000000
            )
              throw new Error('Invalid model token limit');
            option[field] = m[field];
          }
          for (const field of ['reasoning', 'toolUse'] as const) {
            if (m[field] === undefined) continue;
            if (typeof m[field] !== 'boolean')
              throw new Error('Invalid model capability');
            option[field] = m[field];
          }
          if (!c.models.some((x) => x.id === option.id)) c.models.push(option);
        }
        if (!c.models.some((m) => m.id === modelId))
          throw new Error('Choose a default model from the selected models');
      }
      if (['openai-compatible', 'local', 'ollama', 'lmstudio'].includes(p.id)) {
        if (
          input.api !== undefined &&
          !['openai-completions', 'openai-responses'].includes(input.api)
        )
          throw new Error('Invalid model API');
        c.api = input.api ?? 'openai-completions';
      }
      for (const field of ['contextWindow', 'maxTokens'] as const) {
        const value = input[field];
        if (value === undefined) continue;
        if (!Number.isSafeInteger(value) || value < 1 || value > 10000000)
          throw new Error('Invalid model token limit');
        c[field] = value;
      }
      if (input.reasoning !== undefined) {
        if (typeof input.reasoning !== 'boolean')
          throw new Error('Invalid reasoning capability');
        c.reasoning = input.reasoning;
      }
      const oldKey = this.keys.get(c.id);
      const sameEndpoint =
        existing?.provider === c.provider && existing.baseUrl === c.baseUrl;
      const newKey =
        typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
      // A saved vendor key must never follow an edited endpoint without explicit re-entry.
      const key = newKey || (sameEndpoint ? oldKey : undefined);
      if (c.requiresKey && !key)
        throw new Error('API key is required for this connection');
      buildKernel(c, key);
      const selected =
        this.state.selected?.connectionId === c.id
          ? {
              connectionId: c.id,
              modelId:
                sameEndpoint &&
                existing?.modelId === c.modelId &&
                (!c.models ||
                  c.models.some((m) => m.id === this.state.selected!.modelId))
                  ? this.state.selected.modelId
                  : c.modelId,
            }
          : (this.state.selected ?? { connectionId: c.id, modelId: c.modelId });
      // An edit can retain a different active model; validate it before touching the vault or disk.
      if (selected.connectionId === c.id) buildKernel(c, key, selected.modelId);
      const next = {
        connections: existing
          ? this.state.connections.map((x) => (x.id === c.id ? c : x))
          : [...this.state.connections, c],
        selected,
      };
      if (key !== oldKey) {
        if (key) await this.secrets.write(c.id, key);
        else await this.secrets.delete(c.id);
      }
      try {
        this.persist(next);
      } catch (e) {
        if (key !== oldKey) {
          if (oldKey) await this.secrets.write(c.id, oldKey);
          else await this.secrets.delete(c.id);
        }
        throw e;
      }
      if (key) this.keys.set(c.id, key);
      else this.keys.delete(c.id);
      this.state = next;
      this.kernel = this.resolve(next);
      this.credentialError = false;
      return this.config();
    });
  }
  select(selection: ModelSelection): Promise<ModelConfig> {
    return this.mutate(async () => {
      const c = this.state.connections.find(
        (c) => c.id === selection.connectionId,
      );
      if (!c || !this.ready(c)) throw new Error('Connection needs an API key');
      const modelId =
        typeof selection.modelId === 'string' ? selection.modelId.trim() : '';
      if (!modelId || modelId.length > 200)
        throw new Error('Model is required');
      if (c.models && !c.models.some((m) => m.id === modelId))
        throw new Error('Model is not enabled for this connection');
      const kernel = buildKernel(c, this.keys.get(c.id), modelId);
      const next = { ...this.state, selected: { connectionId: c.id, modelId } };
      this.persist(next);
      this.state = next;
      this.kernel = kernel;
      return this.config();
    });
  }
  remove(id: string): Promise<ModelConfig> {
    return this.mutate(async () => {
      if (!this.state.connections.some((c) => c.id === id))
        throw new Error('Unknown connection');
      const connections = this.state.connections.filter((c) => c.id !== id);
      const first = connections.find((c) => this.ready(c));
      const selected =
        this.state.selected?.connectionId === id
          ? first
            ? { connectionId: first.id, modelId: first.modelId }
            : null
          : this.state.selected;
      const next = { connections, selected };
      const key = this.keys.get(id);
      await this.secrets.delete(id);
      try {
        this.persist(next);
      } catch (e) {
        if (key) await this.secrets.write(id, key);
        throw e;
      }
      this.keys.delete(id);
      this.state = next;
      this.kernel = this.resolve(next);
      return this.config();
    });
  }
  test(id: string): Promise<ModelConfig> {
    return this.mutate(async () => {
      const c = this.state.connections.find((c) => c.id === id);
      if (!c || !this.ready(c)) throw new Error('Connection needs an API key');
      const modelId =
        this.state.selected?.connectionId === id
          ? this.state.selected.modelId
          : c.modelId;
      const key = this.keys.get(id);
      const { models, model } = buildKernel(c, key, modelId);
      try {
        const result = await models.completeSimple(
          model,
          {
            messages: [
              {
                role: 'user',
                content: 'Reply with OK.',
                timestamp: Date.now(),
              },
            ],
          },
          { maxTokens: 32, signal: AbortSignal.timeout(10000) },
        );
        if (result.stopReason === 'error' || result.stopReason === 'aborted')
          throw new Error(result.errorMessage || 'Connection test failed');
        const next = {
          ...this.state,
          connections: this.state.connections.map((x) =>
            x.id === id
              ? { ...x, testedAt: Date.now(), testedModelId: modelId }
              : x,
          ),
        };
        this.persist(next);
        this.state = next;
        return this.config();
      } catch (e) {
        // Provider errors can echo authentication; keep credentials out of gateway responses.
        const message =
          e instanceof Error ? e.message : 'Connection test failed';
        throw new Error(key ? message.split(key).join('[redacted]') : message);
      }
    });
  }
}
