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
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { shouldIncludeSubagentDelegation } from '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { mergeSystemInstruction } from '../utils/systemInstructionMerge.js';
import { resolveToolFormat } from '../utils/toolFormatDetection.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import { extractModelParamsFromOptions } from './OpenAIClientFactory.js';
import { sanitizePromptCacheKey } from '../openai-responses/sanitizePromptCacheKey.js';
import {
  resolveReasoningDialect,
  applyReasoningDialect,
  hasExplicitReasoningField,
} from './openaiReasoningDialect.js';
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

/**
 * Resolve the system prompt from user memory, MCP instructions, and config.
 */
async function resolveSystemPrompt(
  options: NormalizedGenerateChatOptions,
  tools: NormalizedGenerateChatOptions['tools'],
  model: string,
  config: Config | undefined,
): Promise<string> {
  const flattenedToolNames =
    tools?.flatMap((group) =>
      group.functionDeclarations
        .map((decl) => decl.name)
        .filter((name): name is string => !!name),
    ) ?? [];
  const toolNamesArg =
    tools === undefined ? undefined : Array.from(new Set(flattenedToolNames));

  const userMemory = await resolveUserMemory(
    options.userMemory,
    () => options.invocation.userMemory,
  );
  const mcpClientManager =
    typeof config?.getMcpClientManager === 'function'
      ? config.getMcpClientManager()
      : undefined;
  const mcpInstructions = mcpClientManager
    ? mcpClientManager.getMcpInstructions()
    : undefined;
  const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
    toolNamesArg ?? [],
    () =>
      typeof config?.getSubagentManager === 'function'
        ? config.getSubagentManager()
        : undefined,
  );
  const corePrompt = await getCoreSystemPromptAsync({
    userMemory,
    mcpInstructions,
    model,
    tools: toolNamesArg,
    includeSubagentDelegation,
    interactionMode:
      config != null &&
      typeof config.isInteractive === 'function' &&
      config.isInteractive() === true
        ? 'interactive'
        : 'non-interactive',
  });
  // Issue #2410: Merge the caller-supplied system instruction (e.g. a
  // subagent persona/task prompt) with the core system prompt so the
  // instruction reaches the Chat Completions API as the system message.
  return mergeSystemInstruction(corePrompt, options.systemInstruction);
}

type OpenAIInvocationRuntime = {
  ephemerals?: Record<string, unknown>;
  modelBehavior?: Record<string, unknown>;
};

type RequestBodyWithThinking = OpenAI.Chat.ChatCompletionCreateParams & {
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning?: Record<string, unknown>;
};

function resolveReasoningConfig(
  requestBody: OpenAI.Chat.ChatCompletionCreateParams,
  options: NormalizedGenerateChatOptions,
  ephemeralSettings: Record<string, unknown>,
): void {
  const body = requestBody as RequestBodyWithThinking;

  // Short-circuit: if the user already set a reasoning field explicitly (via
  // modelParams, which are Object.assigned into the body just before this
  // call), do not auto-inject anything — the user value wins and stays the
  // only reasoning representation on the wire.
  if (hasExplicitReasoningField(body)) {
    return;
  }

  const invocation = options.invocation as OpenAIInvocationRuntime;
  const reasoningEnabled = invocation.modelBehavior?.['reasoning.enabled'] as
    | boolean
    | undefined;
  const reasoningEffort = invocation.modelBehavior?.['reasoning.effort'] as
    | string
    | undefined;

  const baseUrl =
    options.resolved.baseURL ??
    (typeof ephemeralSettings['base-url'] === 'string'
      ? ephemeralSettings['base-url']
      : undefined);

  const dialect = resolveReasoningDialect(baseUrl);
  const applied = applyReasoningDialect(dialect, {
    enabled: reasoningEnabled,
    effort: reasoningEffort,
  });
  if (applied === null) {
    return;
  }

  if (applied.key === 'thinking') {
    body.thinking = applied.value;
  } else {
    body.reasoning = applied.value;
  }
}

/**
 * Apply reasoning, max-tokens, and stream-options to the request body.
 */
function applyRequestBodyOverrides(
  requestBody: OpenAI.Chat.ChatCompletionCreateParams,
  options: NormalizedGenerateChatOptions,
  ephemeralSettings: Record<string, unknown>,
  maxTokens: number | undefined,
  streamingEnabled: boolean,
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

  resolveReasoningConfig(requestBody, options, ephemeralSettings);

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
  const invocation = options.invocation as OpenAIInvocationRuntime;
  const ephemeralSettings = invocation.ephemerals ?? {};

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

  // Resolve and build system prompt
  const systemPrompt = await resolveSystemPrompt(options, tools, model, config);

  // Add system prompt as the first message
  const messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const maxTokens =
    (metadata.maxTokens as number | undefined) ??
    (ephemeralSettings['max-tokens'] as number | undefined);

  // Build request
  const requestBody: OpenAI.Chat.ChatCompletionCreateParams = {
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
    maxTokens,
    streamingEnabled,
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
