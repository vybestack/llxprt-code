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
import { resolveToolFormat } from '../utils/toolFormatDetection.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import { extractModelParamsFromOptions } from './OpenAIClientFactory.js';
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
  return getCoreSystemPromptAsync({
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
}

type OpenAIInvocationRuntime = {
  ephemerals?: Record<string, unknown>;
  modelBehavior?: Record<string, unknown>;
};

type RequestBodyWithThinking = OpenAI.Chat.ChatCompletionCreateParams & {
  thinking?: { type: 'enabled' | 'disabled' };
};

function resolveReasoningConfig(
  requestBody: OpenAI.Chat.ChatCompletionCreateParams,
  options: NormalizedGenerateChatOptions,
): void {
  if ('thinking' in requestBody || 'reasoning_effort' in requestBody) {
    return;
  }
  const invocation = options.invocation as OpenAIInvocationRuntime;
  const reasoningEnabled = invocation.modelBehavior?.['reasoning.enabled'] as
    | boolean
    | undefined;
  const body = requestBody as RequestBodyWithThinking;
  if (reasoningEnabled === true) {
    body.thinking = { type: 'enabled' };
  } else if (reasoningEnabled === false) {
    body.thinking = { type: 'disabled' };
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
  // Apply request overrides
  const requestOverrides = extractModelParamsFromOptions(options);
  if (requestOverrides) {
    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Applying request overrides`, {
        overrideKeys: Object.keys(requestOverrides),
      });
    }
    Object.assign(requestBody, requestOverrides);
  }

  resolveReasoningConfig(requestBody, options);

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
