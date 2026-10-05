/** Pi owns provider transports and model capabilities. Each run gets an immutable kernel. */
import {
  createModels,
  createProvider,
  type MutableModels,
  type Provider,
} from '@earendil-works/pi-ai/models';
import type { Api, Model } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { moonshotaiProvider } from '@earendil-works/pi-ai/providers/moonshotai';
import { moonshotaiCnProvider } from '@earendil-works/pi-ai/providers/moonshotai-cn';
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import type {
  ModelConnection,
  ProviderInfo,
  ProviderKind,
} from '../protocol.js';

const builtin: Partial<Record<ProviderKind, () => Provider>> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
  openrouter: openrouterProvider,
  deepseek: deepseekProvider,
  moonshotai: moonshotaiProvider,
  'moonshotai-cn': moonshotaiCnProvider,
  'kimi-coding': kimiCodingProvider,
};
const defaultApis = {
  anthropic: 'anthropic-messages',
  openai: 'openai-responses',
  google: 'google-generative-ai',
  openrouter: 'openai-completions',
  deepseek: 'openai-completions',
  moonshotai: 'openai-completions',
  'moonshotai-cn': 'openai-completions',
  'kimi-coding': 'anthropic-messages',
} as const;
const preferredModels: Partial<Record<ProviderKind, string>> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  google: 'gemini-2.5-flash',
  openrouter: 'anthropic/claude-sonnet-4.6',
};
const custom = [
  {
    id: 'openai-compatible',
    name: 'OpenAI compatible',
    baseUrl: '',
    defaultModelId: '',
    requiresKey: true,
  },
  {
    id: 'anthropic-compatible',
    name: 'Anthropic compatible',
    baseUrl: '',
    defaultModelId: '',
    requiresKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModelId: '',
    requiresKey: false,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModelId: '',
    requiresKey: false,
  },
  {
    id: 'local',
    name: 'Local model',
    baseUrl: 'http://localhost:11434/v1',
    defaultModelId: '',
    requiresKey: false,
  },
] as const;
export function providerCatalog(): ProviderInfo[] {
  return [
    ...Object.entries(builtin).map(([id, factory]) => {
      const provider = factory!();
      const models = provider.getModels();
      return {
        id: id as ProviderKind,
        name: provider.name,
        baseUrl: provider.baseUrl ?? '',
        requiresKey: true,
        defaultModelId:
          models.find((m) => m.id === preferredModels[id as ProviderKind])
            ?.id ??
          models[0]?.id ??
          '',
        models: models.map((m) => ({
          id: m.id,
          name: m.name,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          reasoning: m.reasoning,
        })),
      };
    }),
    ...custom.map((p) => ({ ...p, models: [] })),
  ];
}
export interface KernelPair {
  models: MutableModels;
  model: Model<Api>;
}
export function buildKernel(
  connection: ModelConnection,
  apiKey = '',
  modelId = connection.modelId,
): KernelPair {
  const factory = builtin[connection.provider];
  let provider: Provider;
  if (factory) provider = factory();
  else {
    const api =
      connection.provider === 'anthropic-compatible'
        ? 'anthropic-messages'
        : (connection.api ?? 'openai-completions');
    provider = createProvider({
      id: connection.provider,
      models: [],
      auth: {
        apiKey: { name: connection.name, resolve: async () => ({ auth: {} }) },
      },
      api:
        api === 'anthropic-messages'
          ? anthropicMessagesApi()
          : api === 'openai-responses'
            ? openAIResponsesApi()
            : openAICompletionsApi(),
    });
  }
  const known = provider.getModels().find((m) => m.id === modelId);
  const discovered = connection.models?.find((m) => m.id === modelId);
  const contextWindow =
    known?.contextWindow ?? discovered?.contextWindow ?? 32768;
  const api =
    known?.api ??
    (factory
      ? defaultApis[connection.provider as keyof typeof defaultApis]
      : connection.provider === 'anthropic-compatible'
        ? 'anthropic-messages'
        : (connection.api ?? 'openai-completions'));
  const model: Model<Api> = {
    ...(known ?? {
      id: modelId,
      name: discovered?.name ?? modelId,
      api,
      provider: provider.id,
      reasoning: discovered?.reasoning ?? false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: 4096,
    }),
    // Catalog maxTokens is a capability ceiling, not a sensible per-turn output budget.
    maxTokens: Math.min(
      known?.maxTokens ?? discovered?.maxTokens ?? 4096,
      8192,
      Math.floor(contextWindow / 4),
    ),
    baseUrl: connection.baseUrl,
    ...(connection.contextWindow === undefined
      ? {}
      : { contextWindow: connection.contextWindow }),
    ...(connection.maxTokens === undefined
      ? {}
      : { maxTokens: connection.maxTokens }),
    ...(connection.reasoning === undefined
      ? {}
      : { reasoning: connection.reasoning }),
  };
  if (model.maxTokens >= model.contextWindow)
    throw new Error('Output limit must be smaller than the context window');
  const models = createModels();
  // Preserve the built-in transport (including mixed API providers) and catalog compatibility flags.
  models.setProvider({
    ...provider,
    getModels: () => [model],
    getAllModels: () => [model],
    // OpenAI SDK requires a nonempty placeholder even for unauthenticated local servers.
    auth: {
      apiKey: {
        name: connection.name,
        resolve: async () =>
          connection.requiresKey && !apiKey
            ? undefined
            : { auth: { apiKey: apiKey || 'local' } },
      },
    },
  });
  return { models, model };
}
