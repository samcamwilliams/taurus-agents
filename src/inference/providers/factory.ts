import type { InferenceProvider } from './base.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIResponsesProvider } from './openai-responses.js';
import { OpenAIChatCompletionsProvider } from './openai-chatcompletions.js';
import { getSecret } from '../../core/config/index.js';

/** Override map — tests register mock providers here so resolveProvider returns them. */
const providerOverrides = new Map<string, InferenceProvider>();

/** Register a provider override for a given backend prefix (e.g. 'mock'). */
export function registerProviderOverride(backend: string, provider: InferenceProvider): void {
  providerOverrides.set(backend, provider);
}

/** Clear all provider overrides. */
export function clearProviderOverrides(): void {
  providerOverrides.clear();
}

/**
 * Registry of OpenAI Chat Completions-compatible providers.
 *
 * Adding a new provider is a one-liner — just add an entry here.
 * The factory will resolve it automatically via OpenAIChatCompletionsProvider.
 */
const CHAT_COMPLETIONS_REGISTRY: Record<string, {
  envKey: string;
  baseURL: string;
  headers?: Record<string, string>;
}> = {
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': 'https://github.com/taurus-agents',
      'X-OpenRouter-Title': 'Taurus Agents',
    },
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    headers: { 'x-goog-api-client': 'taurus-agents/1.0' },
  },
  groq: {
    envKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
  },
  together: {
    envKey: 'TOGETHER_API_KEY',
    baseURL: 'https://api.together.xyz/v1',
  },
  fireworks: {
    envKey: 'FIREWORKS_API_KEY',
    baseURL: 'https://api.fireworks.ai/inference/v1',
  },
};

/**
 * Resolve a provider from a model string.
 *
 * Model format: provider/model-id (provider prefix is REQUIRED)
 *   - "anthropic/claude-sonnet-4-20250514" → AnthropicProvider
 *   - "openai/gpt-4o"                     → OpenAIResponsesProvider
 *   - "xai/grok-4-0709"                   → OpenAIResponsesProvider (+ x_search)
 *   - "gemini/gemini-2.5-pro"             → OpenAIChatCompletionsProvider
 *   - "openrouter/deepseek/deepseek-r1"   → OpenAIChatCompletionsProvider
 *   - "local/model-name"                  → OpenAIChatCompletionsProvider (local endpoint)
 *   - "custom/model-name"                 → OpenAIChatCompletionsProvider (custom endpoint)
 *
 * The full prefixed model string is passed through to the provider in each
 * InferenceRequest — providers strip the prefix before calling their API.
 */
export function resolveProvider(model: string): InferenceProvider {
  const firstSlash = model.indexOf('/');
  if (firstSlash === -1) {
    throw new Error(
      `Model "${model}" is missing a provider prefix. Use "anthropic/${model}", "openai/${model}", etc.`,
    );
  }

  const backend = model.slice(0, firstSlash);

  // Test overrides (registered by integration tests)
  const override = providerOverrides.get(backend);
  if (override) return override;

  // Native providers
  switch (backend) {
    case 'anthropic': {
      const apiKey = getSecret('ANTHROPIC_API_KEY');
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for anthropic/ models');
      return new AnthropicProvider(apiKey);
    }

    case 'openai': {
      const apiKey = getSecret('OPENAI_API_KEY');
      if (!apiKey) throw new Error('OPENAI_API_KEY is required for openai/ models');
      return new OpenAIResponsesProvider({
        apiKey,
        serverTools: [{ type: 'image_generation' }],
      });
    }

    case 'xai': {
      const apiKey = getSecret('XAI_API_KEY');
      if (!apiKey) throw new Error('XAI_API_KEY is required for xai/ models');
      return new OpenAIResponsesProvider({
        apiKey,
        baseURL: 'https://api.x.ai/v1',
        name: 'xai',
        serverTools: [{ type: 'x_search' as any }],
      });
    }

    case 'local': {
      const baseURL = getSecret('LOCAL_PROVIDER_BASE_URL') || 'http://localhost:1234/v1';
      return new OpenAIChatCompletionsProvider({
        apiKey: getSecret('LOCAL_PROVIDER_API_KEY') || 'local',
        baseURL,
        name: 'local',
      });
    }

    case 'custom': {
      const apiKey = getSecret('CUSTOM_PROVIDER_API_KEY');
      const baseURL = getSecret('CUSTOM_PROVIDER_BASE_URL');
      if (!apiKey) throw new Error('CUSTOM_PROVIDER_API_KEY is required for custom/ models');
      if (!baseURL) throw new Error('CUSTOM_PROVIDER_BASE_URL is required for custom/ models');
      return new OpenAIChatCompletionsProvider({
        apiKey,
        baseURL,
        name: 'custom',
      });
    }

  }

  // Chat Completions-compatible registry
  const entry = CHAT_COMPLETIONS_REGISTRY[backend];
  if (entry) {
    const apiKey = getSecret(entry.envKey);
    if (!apiKey) throw new Error(`${entry.envKey} is required for ${backend}/ models`);
    return new OpenAIChatCompletionsProvider({
      apiKey,
      baseURL: entry.baseURL,
      name: backend,
      defaultHeaders: entry.headers,
    });
  }

  throw new Error(
    `Unknown provider "${backend}" in model "${model}".`,
  );
}
