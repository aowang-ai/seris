/**
 * loop/modelFactory.ts — build a pi Model for an Anthropic-compatible endpoint.
 */

import type { Model } from '@earendil-works/pi-ai';

export interface AnthropicCompatEnv {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function anthropicCompatFromEnv(): AnthropicCompatEnv | null {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY;
  const model =
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ??
    process.env.ANTHROPIC_MODEL ??
    'claude-sonnet-4-5';
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model };
}

export function makeAnthropicCompatModel(env: AnthropicCompatEnv): Model<'anthropic-messages'> {
  return {
    id: env.model,
    name: env.model,
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: env.baseUrl,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
  };
}
