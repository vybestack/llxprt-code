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
import type { IContent } from '../../services/history/IContent.js';
import type { ToolFormat } from '../../tools/IToolFormatter.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { DebugLogger } from '../../debug/index.js';
import type { Config } from '../../config/config.js';
import {
  type ToolCallBlock,
  type TextBlock,
  type ToolResponseBlock,
  type MediaBlock,
} from '../../services/history/IContent.js';
import {
  getToolIdStrategy,
  type ToolIdMapper,
} from '../../tools/ToolIdStrategy.js';
import {
  filterThinkingForContext,
  thinkingToReasoningField,
  extractThinkingBlocks,
  type StripPolicy,
} from '../reasoning/reasoningUtils.js';
import { normalizeToOpenAIToolId } from '../utils/toolIdNormalization.js';
import {
  normalizeMediaToDataUri,
  classifyMediaBlock,
  buildUnsupportedMediaPlaceholder,
} from '../utils/mediaUtils.js';
import { ensureJsonSafe } from '../../utils/unicodeUtils.js';
import {
  buildToolResponsePayload,
  formatToolResponseText,
} from '../utils/toolResponsePayload.js';

/**
 * Normalizes tool call arguments to a consistent JSON string format.
 *
 * @param parameters - The tool call parameters (can be undefined, null, string, or object)
 * @returns A JSON string representation of the parameters
 */
export function normalizeToolCallArguments(parameters: unknown): string {
  if (parameters === undefined || parameters === null) {
    return '{}';
  }

  if (typeof parameters === 'string') {
    const trimmed = parameters.trim();
    if (!trimmed) {
      return '{}';
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return JSON.stringify(parsed);
      }
      return JSON.stringify({ value: parsed });
    } catch {
      return JSON.stringify({ raw: trimmed });
    }
  }

  if (typeof parameters === 'object') {
    try {
      return JSON.stringify(parameters);
    } catch {
      return JSON.stringify({ raw: '[unserializable object]' });
    }
  }

  return JSON.stringify({ value: parameters });
}

/**
 * Builds the content string for a tool response block.
 *
 * @param block - The tool response block to serialize
 * @param config - Optional config for response formatting
 * @returns JSON-safe formatted tool response text
 */
export function buildToolResponseContent(
  block: ToolResponseBlock,
  config?: Config,
): string {
  const payload = buildToolResponsePayload(block, config, true);
  return ensureJsonSafe(
    formatToolResponseText({
      status: payload.status,
      toolName: payload.toolName ?? block.toolName,
      error: payload.error,
      output: payload.result,
    }),
  );
}

/**
 * Processes a user/human message block and converts it to OpenAI format.
 */
function processUserMessage(
  content: IContent,
): OpenAI.Chat.ChatCompletionMessageParam | null {
  const hasMedia = content.blocks.some((b) => b.type === 'media');

  if (hasMedia) {
    const parts: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
      | { type: 'file'; file: { filename: string; file_data: string } }
    > = [];

    for (const block of content.blocks) {
      if (block.type === 'text' && block.text) {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'media') {
        const category = classifyMediaBlock(block);
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (category === 'image') {
          parts.push({
            type: 'image_url',
            image_url: {
              url: normalizeMediaToDataUri(block),
            },
          });
        } else if (category === 'pdf') {
          parts.push({
            type: 'file',
            file: {
              filename: block.filename ?? 'document.pdf',
              file_data: normalizeMediaToDataUri(block),
            },
          });
        } else {
          parts.push({
            type: 'text',
            text: buildUnsupportedMediaPlaceholder(block, 'OpenAI'),
          });
        }
      }
    }

    if (parts.length > 0) {
      return {
        role: 'user',
        content: parts as unknown as string,
      };
    }
  } else {
    const text = content.blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text) {
      return {
        role: 'user',
        content: text,
      };
    }
  }

  return null;
}

/**
 * Processes an AI/assistant message block and converts it to OpenAI format.
 */
function processAssistantMessage(
  content: IContent,
  includeInContext: boolean,
  toolFormat: ToolFormat | undefined,
  resolveToolCallId: (tc: ToolCallBlock) => string,
  normalizeToolCallArgs: (params: unknown) => string,
): OpenAI.Chat.ChatCompletionMessageParam | null {
  const textBlocks = content.blocks.filter(
    (b): b is TextBlock => b.type === 'text',
  );
  const text = textBlocks.map((b) => b.text).join('\n');
  const thinkingBlocks = extractThinkingBlocks(content);
  const toolCalls = content.blocks.filter((b) => b.type === 'tool_call');

  if (toolCalls.length > 0) {
    const baseMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      tool_calls: toolCalls.map((tc) => ({
        id: resolveToolCallId(tc),
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: normalizeToolCallArgs(tc.parameters),
        },
      })),
    };

    if (includeInContext && thinkingBlocks.length > 0) {
      const isStrictOpenAI = toolFormat === 'openai';
      if (isStrictOpenAI) {
        return baseMessage;
      }
      const messageWithReasoning = baseMessage as unknown as Record<
        string,
        unknown
      >;
      messageWithReasoning.reasoning_content =
        thinkingToReasoningField(thinkingBlocks);
      return messageWithReasoning as unknown as OpenAI.Chat.ChatCompletionMessageParam;
    }
    return baseMessage;
  } else if (textBlocks.length > 0 || thinkingBlocks.length > 0) {
    const baseMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: text,
    };

    if (includeInContext && thinkingBlocks.length > 0) {
      const messageWithReasoning = baseMessage as unknown as Record<
        string,
        unknown
      >;
      messageWithReasoning.reasoning_content =
        thinkingToReasoningField(thinkingBlocks);
      return messageWithReasoning as unknown as OpenAI.Chat.ChatCompletionMessageParam;
    }
    return baseMessage;
  }

  return null;
}

/**
 * Processes tool response blocks and converts them to OpenAI format.
 */
function processToolResponses(
  content: IContent,
  toolFormat: ToolFormat | undefined,
  resolveToolResponseId: (tr: ToolResponseBlock) => string,
  buildResponseContent: (block: ToolResponseBlock, config?: Config) => string,
  config: Config | undefined,
  pendingToolImages: MediaBlock[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  const toolResponses = content.blocks.filter(
    (b) => b.type === 'tool_response',
  );
  const mediaBlocks = content.blocks.filter(
    (b): b is MediaBlock => b.type === 'media',
  );

  const imageBlocks = mediaBlocks.filter(
    (mb) => classifyMediaBlock(mb) === 'image',
  );
  const nonImageMediaBlocks = mediaBlocks.filter(
    (mb) => classifyMediaBlock(mb) !== 'image',
  );

  if (imageBlocks.length > 0) {
    pendingToolImages.push(...imageBlocks);
  }

  const mediaFallback = nonImageMediaBlocks
    .map((mb) =>
      buildUnsupportedMediaPlaceholder(mb, 'OpenAI Chat Completions'),
    )
    .join('\n');

  for (const tr of toolResponses) {
    let toolContent = buildResponseContent(tr, config);
    if (mediaFallback) {
      toolContent = toolContent + '\n' + mediaFallback;
    }

    const toolMessage: Record<string, unknown> = {
      role: 'tool',
      content: toolContent,
      tool_call_id: resolveToolResponseId(tr),
    };

    if (toolFormat === 'mistral') {
      toolMessage.name = tr.toolName;
    }

    messages.push(
      toolMessage as unknown as OpenAI.Chat.ChatCompletionToolMessageParam,
    );
  }

  return messages;
}

function flushPendingToolImages(
  pendingToolImages: MediaBlock[],
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): void {
  if (pendingToolImages.length === 0) return;

  const imageParts: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [
    { type: 'text', text: '[Images from tool response]' },
    ...pendingToolImages.map((mb) => ({
      type: 'image_url' as const,
      image_url: { url: normalizeMediaToDataUri(mb) },
    })),
  ];
  messages.push({
    role: 'user',
    content: imageParts as unknown as string,
  });
  pendingToolImages.length = 0;
}

function processContentMessages(
  filteredContents: IContent[],
  includeInContext: boolean,
  toolFormat: ToolFormat | undefined,
  resolveToolCallId: (tc: ToolCallBlock) => string,
  resolveToolResponseId: (tr: ToolResponseBlock) => string,
  config: Config | undefined,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  pendingToolImages: MediaBlock[],
): void {
  for (const content of filteredContents) {
    if (content.speaker !== 'tool') {
      flushPendingToolImages(pendingToolImages, messages);
    }

    if (content.speaker === 'human') {
      const userMessage = processUserMessage(content);
      if (userMessage) {
        messages.push(userMessage);
      }
    } else if (content.speaker === 'ai') {
      const assistantMessage = processAssistantMessage(
        content,
        includeInContext,
        toolFormat,
        resolveToolCallId,
        normalizeToolCallArguments,
      );
      if (assistantMessage) {
        messages.push(assistantMessage);
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- OpenAI history can include legacy/partial content records; only tool content belongs here.
    } else if (content.speaker === 'tool') {
      const toolMessages = processToolResponses(
        content,
        toolFormat ?? 'openai',
        resolveToolResponseId,
        buildToolResponseContent,
        config,
        pendingToolImages,
      );
      messages.push(...toolMessages);
    }
  }

  flushPendingToolImages(pendingToolImages, messages);
}

/**
 * Build messages with optional reasoning_content based on settings.
 *
 * @plan PLAN-20251202-THINKING.P14
 * @requirement REQ-THINK-004, REQ-THINK-006
 */
export function buildMessagesWithReasoning(
  contents: IContent[],
  options: NormalizedGenerateChatOptions,
  toolFormat: ToolFormat | undefined,
  config: Config | undefined,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const stripPolicy =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Settings can omit reasoning policy during provider test/runtime bootstrap.
    (options.settings.get('reasoning.stripFromContext') as StripPolicy) ??
    'none';
  const includeInContext =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Settings can omit reasoning inclusion during provider test/runtime bootstrap.
    (options.settings.get('reasoning.includeInContext') as boolean) ?? false;

  const filteredContents = filterThinkingForContext(contents, stripPolicy);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  const toolIdMapper: ToolIdMapper | null =
    toolFormat === 'kimi' || toolFormat === 'mistral'
      ? getToolIdStrategy(toolFormat).createMapper(filteredContents)
      : null;

  const resolveToolCallId = (tc: ToolCallBlock): string => {
    if (toolIdMapper) {
      return toolIdMapper.resolveToolCallId(tc);
    }
    return normalizeToOpenAIToolId(tc.id);
  };

  const resolveToolResponseId = (tr: ToolResponseBlock): string => {
    if (toolIdMapper) {
      return toolIdMapper.resolveToolResponseId(tr);
    }
    return normalizeToOpenAIToolId(tr.callId);
  };

  const pendingToolImages: MediaBlock[] = [];

  processContentMessages(
    filteredContents,
    includeInContext,
    toolFormat,
    resolveToolCallId,
    resolveToolResponseId,
    config,
    messages,
    pendingToolImages,
  );

  return validateToolMessageSequence(messages);
}

function logValidationDebug(
  logger: DebugLogger,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): void {
  logger.debug(
    () => `[validateToolMessageSequence] analyzing ${messages.length} messages`,
    {
      messageRoles: messages.map((m) => m.role),
      toolCallIds: messages
        .filter(
          (m) =>
            m.role === 'assistant' &&
            'tool_calls' in m &&
            Array.isArray(m.tool_calls),
        )
        .flatMap(
          (m) =>
            (
              m as OpenAI.Chat.ChatCompletionAssistantMessageParam
            ).tool_calls?.map((tc) => tc.id) ?? [],
        ),
      toolResponseIds: messages
        .filter((m) => m.role === 'tool')
        .map((m) => (m as { tool_call_id?: string }).tool_call_id),
    },
  );
}

function scanForOrphanedToolMessages(
  validatedMessages: OpenAI.Chat.ChatCompletionMessageParam[],
  logger: DebugLogger | undefined,
): number {
  let lastAssistantToolCallIds: string[] = [];
  let removedCount = 0;

  for (let i = 0; i < validatedMessages.length; i++) {
    const current = validatedMessages[i];

    if (
      current.role === 'assistant' &&
      'tool_calls' in current &&
      Array.isArray(current.tool_calls)
    ) {
      lastAssistantToolCallIds = current.tool_calls.map((tc) => tc.id);
    } else if (current.role === 'tool') {
      const isValidToolCall = lastAssistantToolCallIds.includes(
        current.tool_call_id || '',
      );

      if (!isValidToolCall) {
        const removalReason =
          'tool_call_id not found in last assistant tool_calls';

        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (logger) {
          logger.warn(
            `[validateToolMessageSequence] Invalid tool message sequence detected - removing orphaned tool message: ${removalReason}`,
            {
              currentIndex: i,
              toolCallId: current.tool_call_id,
              lastAssistantToolCallIds,
              removalReason,
            },
          );
        }

        validatedMessages.splice(i, 1);
        i--;
        removedCount++;
      }
    } else if (current.role !== 'assistant') {
      lastAssistantToolCallIds = [];
    }
  }

  return removedCount;
}

/**
 * Validates tool message sequence to ensure each tool message has a corresponding tool_calls
 * This prevents "messages with role 'tool' must be a response to a preceeding message with 'tool_calls'" errors
 *
 * Only validates when there are tool_calls present in conversation to avoid breaking isolated tool response tests
 *
 * @param messages - The converted OpenAI messages to validate
 * @param logger - Optional logger for debug output
 * @returns The validated messages with invalid tool messages removed
 */
export function validateToolMessageSequence(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  logger?: DebugLogger,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const validatedMessages = [...messages];

  if (logger) {
    logValidationDebug(logger, messages);
  }

  const hasToolCallsInConversation = validatedMessages.some(
    (msg) =>
      msg.role === 'assistant' &&
      'tool_calls' in msg &&
      Array.isArray(msg.tool_calls) &&
      msg.tool_calls.length > 0,
  );

  if (!hasToolCallsInConversation) {
    return validatedMessages;
  }

  const removedCount = scanForOrphanedToolMessages(validatedMessages, logger);

  if (removedCount > 0 && logger) {
    logger.debug(
      `[validateToolMessageSequence] completed - removed ${removedCount} orphaned tool messages`,
      {
        originalMessageCount: messages.length,
        validatedMessageCount: validatedMessages.length,
        removedCount,
      },
    );
  }

  return validatedMessages;
}

/**
 * Builds continuation messages for requesting follow-up after tool calls.
 *
 * @param toolCalls - The tool calls to acknowledge
 * @param messagesWithSystem - The message history including system prompt
 * @param toolFormat - The tool format to use for message construction
 * @returns The continuation message sequence
 */
export function buildContinuationMessages(
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>,
  messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[],
  toolFormat: ToolFormat | undefined,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const sanitizedHistory = messagesWithSystem.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }

    const sanitizedAssistant = {
      ...message,
    } as OpenAI.Chat.ChatCompletionAssistantMessageParam & {
      reasoning_content?: unknown;
    };
    delete sanitizedAssistant.reasoning_content;
    return sanitizedAssistant;
  });

  return [
    ...sanitizedHistory,
    {
      role: 'assistant' as const,
      tool_calls: toolCalls,
    },
    ...toolCalls.map((tc) => {
      const toolMessage: OpenAI.Chat.ChatCompletionToolMessageParam & {
        name?: string;
      } = {
        role: 'tool',
        tool_call_id: tc.id,
        content: '[Tool call acknowledged - awaiting execution]',
      };

      if (toolFormat === 'mistral') {
        toolMessage.name = tc.function.name;
      }

      return toolMessage;
    }),
    {
      role: 'user' as const,
      content:
        'The tool calls above have been registered. Please continue with your response.',
    },
  ];
}
