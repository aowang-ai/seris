import type {
  LocalModelService,
  ModelConnectionInput,
  ModelDiscovery,
  ModelOption,
} from '../protocol.js';
import { providerCatalog } from './streamFactory.js';

export function normalizeModelEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid API endpoint');
  const base = value.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('Invalid API endpoint');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid API endpoint');
  return base;
}
const positive = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 10000000
    ? v
    : undefined;
const chatModel = (id: string) =>
  !/(embed|rerank|whisper|tts|dall-e|moderation|transcri|image-generation)/i.test(
    id,
  );

/** Only lists models. No inference, model downloads, process startup or credential persistence. */
export async function discoverModels(
  input: Pick<ModelConnectionInput, 'provider' | 'baseUrl'>,
  key?: string,
  fetcher: typeof fetch = fetch,
  timeout = 8000,
): Promise<ModelDiscovery> {
  const catalog = providerCatalog().find((p) => p.id === input.provider);
  if (!catalog) throw new Error('Unknown provider');
  const base = normalizeModelEndpoint(input.baseUrl);
  const root = base.replace(/\/(v1|api\/v[01])$/, '');
  const anthropic = [
    'anthropic',
    'anthropic-compatible',
    'kimi-coding',
  ].includes(input.provider);
  const google = input.provider === 'google';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (anthropic) {
    headers['anthropic-version'] = '2023-06-01';
    if (key) headers['x-api-key'] = key;
  } else if (google) {
    if (key) headers['x-goog-api-key'] = key;
  } else if (key) headers.authorization = `Bearer ${key}`;
  const signal = AbortSignal.timeout(timeout);
  async function json(url: string): Promise<any> {
    let response: Response;
    try {
      response = await fetcher(url, { headers, signal, redirect: 'error' });
    } catch {
      throw new Error('Model service unavailable');
    }
    if ([401, 403].includes(response.status))
      throw new Error('Model service authentication failed');
    if (!response.ok)
      throw new Error(`Model list request failed (HTTP ${response.status})`);
    // Do not echo service bodies: errors may contain credentials.
    try {
      return await response.json();
    } catch {
      throw new Error('Invalid model list');
    }
  }
  const models = new Map<string, ModelOption>();
  function add(id: unknown, raw: any = {}) {
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      id.length > 200 ||
      !chatModel(id) ||
      raw.type === 'embedding'
    )
      return;
    const known = catalog!.models.find((m) => m.id === id);
    const model: ModelOption = {
      id,
      name:
        typeof (raw.display_name ?? raw.displayName ?? raw.name) === 'string'
          ? String(raw.display_name ?? raw.displayName ?? raw.name).slice(
              0,
              200,
            )
          : (known?.name ?? id),
      ...(known ?? {}),
    };
    const context = positive(
      raw.max_context_length ??
        raw.inputTokenLimit ??
        raw.context_length ??
        raw.context_length_max,
    );
    const output = positive(raw.outputTokenLimit);
    if (context) model.contextWindow = context;
    if (output) model.maxTokens = output;
    if (raw.capabilities?.trained_for_tool_use !== undefined)
      model.toolUse = raw.capabilities.trained_for_tool_use === true;
    if (Array.isArray(raw.capabilities)) {
      model.toolUse = raw.capabilities.includes('tools');
      model.reasoning = raw.capabilities.includes('thinking');
    }
    models.set(id, model);
  }
  if (input.provider === 'ollama') {
    const body = await json(`${root.replace(/\/api$/, '')}/api/tags`);
    if (!Array.isArray(body.models)) throw new Error('Invalid model list');
    for (const m of body.models) add(m.name, m);
  } else if (input.provider === 'lmstudio') {
    // The native API includes downloaded but unloaded models; /v1/models can omit them.
    let body: any;
    try {
      body = await json(`${root}/api/v1/models`);
    } catch (e) {
      if (!(e instanceof Error) || !/HTTP (404|405)/.test(e.message)) throw e;
      body = await json(`${root}/v1/models`);
    }
    const list = body.models ?? body.data;
    if (!Array.isArray(list)) throw new Error('Invalid model list');
    for (const m of list) add(m.key ?? m.id, m);
  } else {
    const endpoint =
      anthropic && !/\/v1$/.test(base) ? `${base}/v1/models` : `${base}/models`;
    let page = new URL(endpoint);
    for (let n = 0; n < 10; n++) {
      if (anthropic) page.searchParams.set('limit', '100');
      if (google) page.searchParams.set('pageSize', '100');
      const body = await json(page.href);
      const list = google ? body.models : body.data;
      if (!Array.isArray(list)) throw new Error('Invalid model list');
      for (const m of list) {
        if (
          google &&
          !m.supportedGenerationMethods?.includes('generateContent')
        )
          continue;
        add(google ? m.name?.replace(/^models\//, '') : m.id, m);
      }
      if (google && body.nextPageToken)
        page.searchParams.set('pageToken', body.nextPageToken);
      else if (anthropic && body.has_more && body.last_id)
        page.searchParams.set('after_id', body.last_id);
      else break;
    }
  }
  return {
    models: [...models.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 1000),
  };
}

export async function detectLocalModels(
  fetcher: typeof fetch = fetch,
): Promise<LocalModelService[]> {
  return Promise.all(
    (['ollama', 'lmstudio'] as const).map(async (provider) => {
      const baseUrl =
        provider === 'ollama'
          ? 'http://127.0.0.1:11434/v1'
          : 'http://127.0.0.1:1234/v1';
      try {
        const result = await discoverModels(
          { provider, baseUrl },
          undefined,
          fetcher,
          2000,
        );
        return {
          provider,
          baseUrl,
          ...result,
          status: result.models.length ? 'ready' : 'empty',
        } as LocalModelService;
      } catch (e) {
        return {
          provider,
          baseUrl,
          models: [],
          status:
            e instanceof Error &&
            e.message === 'Model service authentication failed'
              ? 'unauthorized'
              : 'unavailable',
        } as LocalModelService;
      }
    }),
  );
}
