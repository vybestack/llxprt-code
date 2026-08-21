/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type OpenAI from 'openai';
import { type NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { type DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { convertToolsToOpenAI, type OpenAITool } from './schemaConverter.js';
import { resolveToolFormat } from '../utils/toolFormatDetection.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import { extractModelParamsFromOptions } from './OpenAIClientFactory.js';
import { sanitizePromptCacheKey } from '../openai-responses/sanitizePromptCacheKey.js';
import { applyOpenAIChatReasoning } from './openai-chat-reasoning.js';
import { type Config } from '@vybestack/llxprt-code-core/config/config.js';

export interface RequestContext {
  model: string;
  detectedFormat: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  requestBody: OpenAI.Chat.ChatCompletionCreateParams;
  messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[];
}

/**
 * Convert tools to OpenAI format and handle empty-array guard.
 */
function convertAndGuardTools(
  tools: NormalizedGenerateChatOptions['tools'],
  model: string,
  detectedFormat: string,
  logger: DebugLogger,
): OpenAITool[] | undefined {
  let formattedTools: OpenAITool[] | undefined = convertToolsToOpenAI(tools);

  // CRITICAL FIX: Ensure we never pass an empty tools array
  if (Array.isArray(formattedTools) && formattedTools.length === 0) {
    logger.warn(
      () =>
        `[OpenAIProvider] CRITICAL: Formatted tools is empty array! Setting to undefined to prevent API errors.`,
      {
        model,
        inputTools: tools,
        inputToolsLength: tools?.length,
        inputFirstGroup: tools?.[0],
        stackTrace: new Error().stack,
      },
    );
    formattedTools = undefined;
  }

  // Debug log the conversion result
  if (logger.enabled && formattedTools !== undefined) {
    logger.debug(() => `[OpenAIProvider] Tool conversion summary:`, {
      detectedFormat,
      inputHadTools: !!tools,
      inputToolsLength: tools?.length,
      inputFirstGroup: tools?.[0],
      inputFunctionDeclarationsLength: tools?.[0]?.functionDeclarations?.length,
      outputHasTools: formattedTools.length > 0,
      outputToolsLength: formattedTools.length,
      outputToolNames: formattedTools.map((t) => t.function.name),
    });
  }

  return formattedTools;
}

type OpenAIChatRequestBody = OpenAI.Chat.ChatCompletionCreateParams &
  Record<string, unknown>;

/**
 * The invocation context is required; only a legacy subrecord (modelBehavior,
 * ephemerals) can be explicitly undefined in fixtures built before the
 * invocation contract hardened, and a missing subrecord reads as empty at the
 * transport boundary.
 */
function readInvocationRecord(
  record: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  return record ?? {};
}

function resolveReasoningConfig(
  requestBody: OpenAIChatRequestBody,
  options: NormalizedGenerateChatOptions,
  ephemeralSettings: Readonly<Record<string, unknown>>,
  model: string,
  providerName: string,
  logger: DebugLogger,
): void {
  const baseUrl =
    options.resolved.baseURL ??
    (typeof ephemeralSettings['base-url'] === 'string'
      ? ephemeralSettings['base-url']
      : undefined);

  applyOpenAIChatReasoning({
    body: requestBody,
    modelBehavior: readInvocationRecord(options.invocation.modelBehavior),
    baseUrl,
    model,
    providerName,
    logger,
  });
}

/**
 * Apply reasoning, max-tokens, and stream-options to the request body.
 */
function applyRequestBodyOverrides(
  requestBody: OpenAIChatRequestBody,
  options: NormalizedGenerateChatOptions,
  ephemeralSettings: Readonly<Record<string, unknown>>,
  model: string,
  maxTokens: number | undefined,
  streamingEnabled: boolean,
  providerName: string,
  logger: DebugLogger,
): void {
  // Apply request overrides, sanitizing prompt_cache_key at the transport
  // boundary so an overlong value (e.g. a subagent runtimeId) never reaches
  // the API (issue #2853). Non-string or empty cache keys are dropped.
  // All other model params are forwarded unchanged.
  const requestOverrides = extractModelParamsFromOptions(options);
  if (requestOverrides) {
    const sanitizedOverrides = sanitizeOverridesCacheKey(
      requestOverrides,
      logger,
    );
    if (logger.enabled && sanitizedOverrides) {
      logger.debug(() => `[OpenAIProvider] Applying request overrides`, {
        overrideKeys: Object.keys(sanitizedOverrides),
      });
    }
    if (sanitizedOverrides) {
      Object.assign(requestBody, sanitizedOverrides);
    }
  }

  resolveReasoningConfig(
    requestBody,
    options,
    ephemeralSettings,
    model,
    providerName,
    logger,
  );

  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
    requestBody.max_tokens = maxTokens;
  }

  // Add stream options if streaming is enabled
  const streamOptions = (ephemeralSettings['stream-options'] as
    | { include_usage?: boolean }
    | undefined) ?? { include_usage: true };

  if (streamingEnabled) {
    Object.assign(requestBody, { stream_options: streamOptions });
  }
}

/**
 * Sanitize a single extracted model-params record, clamping/dropping only
 * the `prompt_cache_key` field (issue #2853). All other keys are preserved
 * verbatim so that provider-specific extensions and canonical Chat
 * Completions fields (service_tier, store, verbosity, etc.) continue to
 * pass through. Returns undefined when the cache key was the only entry
 * and it was dropped.
 */
function sanitizeOverridesCacheKey(
  overrides: Record<string, unknown>,
  logger: DebugLogger,
): Record<string, unknown> | undefined {
  const value = overrides['prompt_cache_key'];
  if (value === undefined) {
    return overrides;
  }
  const result: Record<string, unknown> = { ...overrides };
  if (typeof value === 'string' && value.trim() !== '') {
    result['prompt_cache_key'] = sanitizePromptCacheKey(value);
  } else {
    delete result['prompt_cache_key'];
    logger.debug(
      () =>
        `Dropping invalid prompt_cache_key from modelParams (type=${typeof value})`,
    );
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function resolveMaxTokens(
  metadataValue: unknown,
  ephemeralValue: unknown,
): number | undefined {
  if (typeof metadataValue === 'number') {
    return metadataValue;
  }
  return typeof ephemeralValue === 'number' ? ephemeralValue : undefined;
}

/**
 * Prepare OpenAI API request from normalized options
 * Extracts all the request preparation logic from generateChatCompletionImpl
 */
export async function prepareRequest(
  options: NormalizedGenerateChatOptions,
  defaultModel: string,
  config: Config | undefined,
  logger: DebugLogger,
  providerName?: string,
): Promise<RequestContext> {
  const { contents, tools, metadata } = options;
  const model = options.resolved.model || defaultModel;
  const ephemeralSettings = readInvocationRecord(options.invocation.ephemerals);

  // Detect the tool format to use BEFORE building messages
  // Check for provider toolFormat override before auto-detecting
  const settings = options.settings;
  const resolvedProviderName = providerName ?? 'openai';
  const detectedFormat = resolveToolFormat(
    model,
    resolvedProviderName,
    settings,
    logger,
  );

  logger.debug(
    () =>
      `[OpenAIProvider] Using tool format '${detectedFormat}' for model '${model}'`,
    {
      model,
      detectedFormat,
      provider: resolvedProviderName,
    },
  );

  // Convert IContent to OpenAI messages format
  const messages = buildMessagesWithReasoning(
    contents,
    options,
    detectedFormat,
    config,
  );

  // Convert tools and guard against empty array
  const formattedTools = convertAndGuardTools(
    tools,
    model,
    detectedFormat,
    logger,
  );

  // Get streaming setting
  const streamingSetting = ephemeralSettings['streaming'];
  const streamingEnabled = streamingSetting !== 'disabled';

  // Issue #3136: The agent layer owns system-prompt assembly. The provider
  // transports options.systemInstruction verbatim — it never rebuilds a core
  // prompt. Projection paths may call this without an instruction; in that
  // case an empty system message is used so the estimate still resolves.
  const systemPrompt = options.systemInstruction ?? '';

  // Add system prompt as the first message
  const messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const maxTokens = resolveMaxTokens(
    metadata.maxTokens,
    ephemeralSettings['max-tokens'],
  );

  // Build request
  const requestBody: OpenAIChatRequestBody = {
    model,
    messages: messagesWithSystem,
    stream: streamingEnabled,
  };

  if (formattedTools && formattedTools.length > 0) {
    requestBody.tools = formattedTools;
    requestBody.tool_choice = 'auto';
  }

  // Apply reasoning, max-tokens, and stream-options overrides
  applyRequestBodyOverrides(
    requestBody,
    options,
    ephemeralSettings,
    model,
    maxTokens,
    streamingEnabled,
    resolvedProviderName,
    logger,
  );

  return {
    model,
    detectedFormat,
    formattedTools,
    streamingEnabled,
    requestBody,
    messagesWithSystem,
  };
}
