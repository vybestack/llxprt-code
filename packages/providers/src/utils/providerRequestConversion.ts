/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { convertToAnthropicMessages } from '../anthropic/AnthropicMessageNormalizer.js';
import { convertHistoryToGeminiFormat } from '../gemini/GeminiMessageConverter.js';
import {
  buildMessagesWithReasoning,
  type ReasoningMessageOptions,
} from '../openai/OpenAIRequestBuilder.js';

interface MinimalSettings {
  get?: (key: string) => unknown;
}

function asMinimalSettings(value: unknown): MinimalSettings | undefined {
  if (
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    typeof (value as { get?: unknown }).get === 'function'
  ) {
    return value as MinimalSettings;
  }
  return undefined;
}

function createSettings(overrides?: unknown): SettingsService {
  const minimal = asMinimalSettings(overrides);
  return {
    get: (key: string) => minimal?.get?.(key),
  } as SettingsService;
}

function createOptions(settings?: unknown): ReasoningMessageOptions {
  return {
    settings: createSettings(settings),
  };
}

export function buildOpenAIDumpMessages(
  history: IContent[],
  settings?: unknown,
  config?: Config,
): unknown[] {
  return buildMessagesWithReasoning(
    history,
    createOptions(settings),
    'openai',
    config,
  );
}

export function buildAnthropicDumpMessages(
  history: IContent[],
  settings?: unknown,
  config?: Config,
): unknown[] {
  return convertToAnthropicMessages(history, {
    isOAuth: false,
    stripFromContext:
      (asMinimalSettings(settings)?.get?.('reasoning.stripFromContext') as
        | 'all'
        | 'allButLast'
        | 'none'
        | undefined) ?? 'none',
    includeInContext:
      (asMinimalSettings(settings)?.get?.('reasoning.includeInContext') as
        | boolean
        | undefined) ?? false,
    reasoningEnabled: true,
    config,
    unprefixToolName: (name) => name,
    logger: new DebugLogger('llxprt:providers:dumpConversion:anthropic'),
  });
}

export function buildGeminiDumpContents(
  history: IContent[],
  model?: string,
  config?: Config,
): unknown[] {
  return convertHistoryToGeminiFormat(history, model, config);
}

function normalizeProviderName(providerName: string): string {
  return providerName.toLowerCase().trim();
}

function isOpenAICompatibleProvider(providerName: string): boolean {
  const provider = normalizeProviderName(providerName);
  return (
    provider === 'openai' ||
    provider === 'openaivercel' ||
    provider.startsWith('openai-')
  );
}

function isAnthropicCompatibleProvider(providerName: string): boolean {
  const provider = normalizeProviderName(providerName);
  return provider === 'anthropic' || provider.startsWith('anthropic-');
}

function isGeminiCompatibleProvider(providerName: string): boolean {
  const provider = normalizeProviderName(providerName);
  return provider === 'gemini' || provider.startsWith('gemini-');
}

function withModel(
  body: Record<string, unknown>,
  model: string | undefined,
): Record<string, unknown> {
  if (!model) {
    return body;
  }
  return { model, ...body };
}

export function buildProviderDumpBody(params: {
  providerName: string;
  history: IContent[];
  settings?: unknown;
  config?: Config;
  model?: string;
}): Record<string, unknown> {
  if (isOpenAICompatibleProvider(params.providerName)) {
    return withModel(
      {
        messages: buildOpenAIDumpMessages(
          params.history,
          params.settings,
          params.config,
        ),
      },
      params.model,
    );
  }
  if (isAnthropicCompatibleProvider(params.providerName)) {
    return withModel(
      {
        messages: buildAnthropicDumpMessages(
          params.history,
          params.settings,
          params.config,
        ),
      },
      params.model,
    );
  }
  if (isGeminiCompatibleProvider(params.providerName)) {
    return withModel(
      {
        contents: buildGeminiDumpContents(
          params.history,
          params.model,
          params.config,
        ),
      },
      params.model,
    );
  }
  return { history: params.history };
}
