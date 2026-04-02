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
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { DebugLogger } from '../../debug/index.js';
import { convertToolsToOpenAI, type OpenAITool } from './schemaConverter.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { shouldIncludeSubagentDelegation } from '../../prompt-config/subagent-delegation.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { detectToolFormat } from '../utils/toolFormatDetection.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import { extractModelParamsFromOptions } from './OpenAIClientFactory.js';
import type { Config } from '../../config/config.js';

export interface RequestContext {
  model: string;
  detectedFormat: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  requestBody: OpenAI.Chat.ChatCompletionCreateParams;
  messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[];
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
): Promise<RequestContext> {
  const { contents, tools, metadata } = options;
  const model = options.resolved.model || defaultModel;
  const ephemeralSettings = options.invocation.ephemerals;

  // Detect the tool format to use BEFORE building messages
  const detectedFormat = detectToolFormat(model, logger);

  logger.debug(
    () =>
      `[OpenAIProvider] Using tool format '${detectedFormat}' for model '${model}'`,
    {
      model,
      detectedFormat,
      provider: 'openai',
    },
  );

  // Convert IContent to OpenAI messages format
  const messages = buildMessagesWithReasoning(
    contents,
    options,
    detectedFormat,
    config,
  );

  // Convert Gemini format tools to OpenAI format
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
  if (logger.enabled && formattedTools != null) {
    logger.debug(() => `[OpenAIProvider] Tool conversion summary:`, {
      detectedFormat,
      inputHadTools: !!tools,
      inputToolsLength: tools?.length,
      inputFirstGroup: tools?.[0],
      inputFunctionDeclarationsLength: tools?.[0]?.functionDeclarations?.length,
      outputHasTools: true,
      outputToolsLength: formattedTools.length,
      outputToolNames: formattedTools.map((t) => t.function.name),
    });
  }

  // Get streaming setting
  const streamingSetting = ephemeralSettings['streaming'];
  const streamingEnabled = streamingSetting !== 'disabled';

  // Build system prompt
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- config may be a partial mock in tests
  const mcpInstructions = config?.getMcpClientManager?.()?.getMcpInstructions();
  const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
    toolNamesArg ?? [],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- config may be a partial mock in tests
    () => config?.getSubagentManager?.(),
  );
  const systemPrompt = await getCoreSystemPromptAsync({
    tools: toolNamesArg,

    interactionMode:
      config?.isInteractive?.() === true ? 'interactive' : 'non-interactive',
    userMemory,
    mcpInstructions,
    model,
    includeSubagentDelegation,
  });

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

  if (formattedTools != null && formattedTools.length > 0) {
    requestBody.tools = formattedTools;
    requestBody.tool_choice = 'auto';
  }

  // Apply request overrides
  const requestOverrides = extractModelParamsFromOptions(options);
  if (requestOverrides != null) {
    if (logger.enabled) {
      logger.debug(() => `[OpenAIProvider] Applying request overrides`, {
        overrideKeys: Object.keys(requestOverrides),
      });
    }
    Object.assign(requestBody, requestOverrides);
  }

  // Inject thinking parameter for reasoning models
  if (!('thinking' in requestBody) && !('reasoning_effort' in requestBody)) {
    const reasoningEnabled = options.invocation.modelBehavior[
      'reasoning.enabled'
    ] as boolean | undefined;
    if (reasoningEnabled === true) {
      (requestBody as unknown as Record<string, unknown>)['thinking'] = {
        type: 'enabled',
      };
    } else if (reasoningEnabled === false) {
      (requestBody as unknown as Record<string, unknown>)['thinking'] = {
        type: 'disabled',
      };
    }
  }

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

  return {
    model,
    detectedFormat,
    formattedTools,
    streamingEnabled,
    requestBody,
    messagesWithSystem,
  };
}
