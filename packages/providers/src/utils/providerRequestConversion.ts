/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { OutputLimitConfig } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AnthropicConversationConversionOptions as AnthropicMessageConversionOptions } from '../anthropic/AnthropicMessageNormalizer.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { callerOwnedAnthropicDump } from '../anthropic/caller-owned-anthropic-dump.js';
import { nativeRawAnthropicDump } from '../anthropic/native-raw-anthropic-dump.js';
import { nativeChatDump } from '../openai/native-chat-dump.js';
import { inMemoryRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ReasoningMessageOptions } from '../openai/OpenAIRequestBuilder.js';

/** Reasoning options for a `/dump` conversion under the given policy. */
export function openAIDumpOptions(
  policy: Readonly<Record<string, unknown>> = {},
): ReasoningMessageOptions {
  return { invocation: { ephemerals: policy } };
}

/** Anthropic conversion options for a `/dump` under the given policy. */
export function anthropicDumpOptions(
  policy?: Readonly<Record<string, unknown>>,
  config?: OutputLimitConfig,
  model?: string,
  baseURL?: string,
): AnthropicMessageConversionOptions {
  return {
    isOAuth: false,
    stripFromContext:
      (policy?.['reasoning.stripFromContext'] as
        | 'all'
        | 'allButLast'
        | 'none'
        | undefined) ?? 'none',
    includeInContext:
      (policy?.['reasoning.includeInContext'] as boolean | undefined) ?? false,
    reasoningEnabled: true,
    config,
    currentModel: model,
    currentBaseURL: baseURL,
    unprefixToolName: (name) => name,
    logger: new DebugLogger('llxprt:providers:dumpConversion:anthropic'),
  };
}

export type DumpProviderFamily = 'openai' | 'anthropic' | 'other';

/**
 * The wire family a `/dump` is converted for. Gemini-family names are
 * `other`: Gemini wire conversion is owned by the
 * @vybestack/llxprt-plugin-google-gemini plugin (#2763), never by the base
 * package.
 */
export function dumpProviderFamily(providerName: string): DumpProviderFamily {
  const provider = providerName.toLowerCase().trim();
  if (
    provider === 'openai' ||
    provider === 'openaivercel' ||
    provider.startsWith('openai-')
  ) {
    return 'openai';
  }
  if (provider === 'anthropic' || provider.startsWith('anthropic-')) {
    return 'anthropic';
  }
  return 'other';
}

export function withModel(
  body: Record<string, unknown>,
  model: string | undefined,
): Record<string, unknown> {
  if (!model) {
    return body;
  }
  return { model, ...body };
}

export function buildProviderDumpBodyStream(params: {
  providerName: string;
  history: HistoryDumpSource | IContent[];
  policy?: Readonly<Record<string, unknown>>;
  config?: OutputLimitConfig;
  model?: string;
  baseURL?: string;
}): Record<string, unknown> {
  const family = dumpProviderFamily(params.providerName);
  const history = params.history;
  const source: HistoryDumpSource = Array.isArray(history)
    ? {
        callerOwnedRows: {
          ...inMemoryRequestSelection(history),
          callerOwned: true,
        },
        async *rows() {
          yield* history;
        },
      }
    : history;
  if (family === 'openai') {
    return withModel(
      {
        messages: nativeChatDump(source, params.policy, params.config),
      },
      params.model,
    );
  }
  if (family === 'anthropic') {
    const options = anthropicDumpOptions(
      params.policy,
      params.config,
      params.model,
      params.baseURL,
    );
    return withModel(
      {
        messages:
          source.callerOwnedRows === undefined
            ? nativeRawAnthropicDump(source, options)
            : callerOwnedAnthropicDump(source.callerOwnedRows, options),
      },
      params.model,
    );
  }
  // Callers that need a real Gemini body must ask the runtime provider (see
  // the CLI dumpcontext command).
  return { history: source.rows() };
}
