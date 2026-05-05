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

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy provider boundary retained while larger decomposition continues. */

import type OpenAI from 'openai';
import {
  type IContent,
  type TextBlock,
  type ToolCallBlock,
} from '../../services/history/IContent.js';
import { type DebugLogger } from '../../debug/index.js';
import { type ToolCallPipeline } from './ToolCallPipeline.js';
import {
  type GemmaToolCallParser,
  type TextToolCall,
} from '../../parsers/TextToolCallParser.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { extractCacheMetrics } from '../utils/cacheMetricsExtractor.js';
import { normalizeToolName } from '../utils/toolNameNormalization.js';
import { normalizeToHistoryToolId } from '../utils/toolIdNormalization.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import {
  coerceMessageContentToString,
  sanitizeToolArgumentsString,
  extractKimiToolCallsFromText,
} from './OpenAIResponseParser.js';
import { mapFinishReasonToStopReason } from './finishReasonMapping.js';

/**
 * Helper to convert token value preserving old || 0 behavior:
 * Returns 0 for nullish, falsy, or NaN values.
 */
function toTokenCount(value: unknown): number {
  const num = typeof value === 'number' ? value : 0;
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Helper to compute total tokens preserving old || prompt+completion behavior:
 * Returns sum of prompt and completion when total is nullish/falsy/NaN.
 */
function computeTotalTokens(
  total: unknown,
  prompt: number,
  completion: number,
): number {
  const totalNum = typeof total === 'number' ? total : 0;
  // Preserve old || behavior: use sum if total is 0 or NaN (falsy-ish)
  return !Number.isNaN(totalNum) && totalNum > 0
    ? totalNum
    : prompt + completion;
}

/**
 * Helper predicate: checks if a value is defined (not null or undefined).
 * Used for finish_reason runtime checks to avoid different-types-comparison warnings.
 */
function isDefined<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

/**
 * Helper predicate: checks if a value is a non-empty string.
 * Preserves old truthy behavior: empty string treated as missing (not spread/emitted).
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

export interface NonStreamHandlerDeps {
  toolCallPipeline: ToolCallPipeline;
  textToolParser: GemmaToolCallParser;
  logger: DebugLogger;
}

/**
 * Build usage metadata from OpenAI usage object, preserving old || 0 behavior.
 */
function buildUsageMetadata(
  usage: OpenAI.CompletionUsage,
  stopReason: string | undefined,
): IContent['metadata'] {
  const cacheMetrics = extractCacheMetrics(usage);
  const promptTokens = toTokenCount(usage.prompt_tokens);
  const completionTokens = toTokenCount(usage.completion_tokens);
  const totalTokens = computeTotalTokens(
    usage.total_tokens,
    promptTokens,
    completionTokens,
  );
  return {
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: cacheMetrics.cachedTokens,
      cacheCreationTokens: cacheMetrics.cacheCreationTokens,
      cacheMissTokens: cacheMetrics.cacheMissTokens,
    },
    ...(isNonEmptyString(stopReason) && { stopReason }),
  };
}

/**
 * Apply finishReason to response metadata (issue #1844 propagation).
 */
function applyFinishReason(
  content: IContent,
  finishReason: string | null | undefined,
): void {
  if (!isDefined(finishReason)) return;
  content.metadata ??= {};
  content.metadata.finishReason = finishReason;
}

/**
 * Build text and Kimi tool blocks from choice message content.
 */
function buildTextBlocks(
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  messageContent: unknown,
  logger: DebugLogger,
): {
  blocks: Array<TextBlock | ToolCallBlock>;
  kimiCleanContent: string | undefined;
  kimiToolBlocks: ToolCallBlock[];
} {
  const blocks: Array<TextBlock | ToolCallBlock> = [];
  let kimiCleanContent: string | undefined;
  let kimiToolBlocks: ToolCallBlock[] = [];

  const rawContent = coerceMessageContentToString(messageContent);
  if (rawContent) {
    const kimiParsed = extractKimiToolCallsFromText(rawContent, logger);
    kimiCleanContent = kimiParsed.cleanedText;
    kimiToolBlocks = kimiParsed.toolCalls;

    const cleanedText = sanitizeProviderText(kimiCleanContent);
    if (cleanedText) {
      blocks.push({
        type: 'text',
        text: cleanedText,
      } as TextBlock);
    }
  }

  return { blocks, kimiCleanContent, kimiToolBlocks };
}

/**
 * Build tool call blocks from choice.message.tool_calls.
 */
function buildToolCallBlocks(
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  toolCalls:
    | OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
    | undefined,
  pipeline: ToolCallPipeline,
  logger: DebugLogger,
): ToolCallBlock[] {
  const blocks: ToolCallBlock[] = [];
  if (toolCalls && toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      if (toolCall.type === 'function') {
        const normalizedName = pipeline.normalizeToolName(
          toolCall.function.name,
          toolCall.function.arguments,
        );

        const sanitizedArgs = sanitizeToolArgumentsString(
          toolCall.function.arguments,
          logger,
        );

        const processedParameters = processToolParameters(
          sanitizedArgs,
          normalizedName,
        );

        blocks.push({
          type: 'tool_call',
          id: normalizeToHistoryToolId(toolCall.id),
          name: normalizedName,
          parameters: processedParameters,
        } as ToolCallBlock);
      }
    }
  }
  return blocks;
}

/**
 * Log finish reason details for non-streaming responses.
 */
function logFinishReason(
  choice: OpenAI.Chat.Completions.ChatCompletion['choices'][number],
  model: string,
  detectedFormat: string,
  logger: DebugLogger,
): void {
  if (!isDefined(choice.finish_reason)) return;

  logger.debug(
    () => `[Non-streaming] Response finish_reason: ${choice.finish_reason}`,
    {
      model,
      finishReason: choice.finish_reason,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      hasContent: !!choice.message?.content,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      hasToolCalls:
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        choice.message?.tool_calls != null &&
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        choice.message.tool_calls.length > 0,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      contentLength: choice.message?.content?.length ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      toolCallCount: choice.message?.tool_calls?.length ?? 0,
      detectedFormat,
    },
  );

  if (choice.finish_reason === 'length') {
    logger.warn(
      () =>
        `Response truncated due to max_tokens limit for model ${model}. Consider increasing max_tokens.`,
    );
  }
}

/**
 * Yield the response content, handling blocks-present, usage-only,
 * finish-reason-only, and stop-reason-only paths.
 */
function yieldResponseContent(
  blocks: Array<TextBlock | ToolCallBlock>,
  completion: OpenAI.Chat.Completions.ChatCompletion,
  choice: OpenAI.Chat.Completions.ChatCompletion['choices'][number],
  stopReason: string | undefined,
): IContent | null {
  if (blocks.length > 0) {
    const responseContent: IContent = {
      speaker: 'ai',
      blocks,
    };

    if (completion.usage) {
      responseContent.metadata = buildUsageMetadata(
        completion.usage,
        stopReason,
      );
    } else if (isNonEmptyString(stopReason)) {
      responseContent.metadata = { stopReason };
    }

    applyFinishReason(responseContent, choice.finish_reason);
    return responseContent;
  }

  if (completion.usage) {
    const metadataOnly: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: buildUsageMetadata(completion.usage, stopReason),
    };

    applyFinishReason(metadataOnly, choice.finish_reason);
    return metadataOnly;
  }

  if (isDefined(choice.finish_reason)) {
    return {
      speaker: 'ai',
      blocks: [],
      metadata: {
        stopReason,
        finishReason: choice.finish_reason,
      },
    } as IContent;
  }

  if (isNonEmptyString(stopReason)) {
    return {
      speaker: 'ai',
      blocks: [],
      metadata: { stopReason },
    } as IContent;
  }

  return null;
}

/**
 * Handle non-streaming response from OpenAI API
 */
export async function* handleNonStreamingResponse(
  response: OpenAI.Chat.Completions.ChatCompletion,
  model: string,
  detectedFormat: string,
  deps: NonStreamHandlerDeps,
): AsyncGenerator<IContent, void, unknown> {
  const completion = response;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  const choice = completion.choices?.[0];

  // Widen to unknown for defensive runtime check (provider may return malformed responses)
  const choiceRuntime: unknown = choice;
  if (choiceRuntime === undefined || choiceRuntime === null) {
    throw new Error('No choices in completion response');
  }

  logFinishReason(choice, model, detectedFormat, deps.logger);

  // Build text and Kimi tool blocks
  const textResult = buildTextBlocks(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    choice.message?.content as unknown,
    deps.logger,
  );
  const blocks: Array<TextBlock | ToolCallBlock> = [...textResult.blocks];

  // Build structured tool call blocks
  const toolBlocks = buildToolCallBlocks(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    choice.message?.tool_calls,
    deps.toolCallPipeline,
    deps.logger,
  );
  blocks.push(...toolBlocks);

  // Append Kimi tool blocks
  if (textResult.kimiToolBlocks.length > 0) {
    blocks.push(...textResult.kimiToolBlocks);
    deps.logger.debug(
      () =>
        `[OpenAIProvider] Non-stream pipeline added Kimi tool calls from text`,
      { count: textResult.kimiToolBlocks.length },
    );
  }

  // Check for InTheDocument format in text content
  if (textResult.kimiCleanContent) {
    processTextToolCalls(
      textResult.kimiCleanContent,
      blocks,
      choice.message.content ?? undefined,
      deps,
    );
  }

  // Emit the complete response
  const stopReason = mapFinishReasonToStopReason(choice.finish_reason);
  const content = yieldResponseContent(blocks, completion, choice, stopReason);
  if (content) {
    yield content;
  }
}

/**
 * Process text tool calls from Kimi format.
 * Extracts tool calls and updates text blocks accordingly.
 */
function processTextToolCalls(
  pipelineKimiCleanContent: string,
  blocks: IContent['blocks'],
  originalContent: string | undefined,
  deps: {
    textToolParser: {
      parse: (source: string) => {
        cleanedContent: string;
        toolCalls: TextToolCall[];
      };
    };
    logger: { debug: (msg: () => string) => void };
  },
): void {
  const cleanedSource = sanitizeProviderText(pipelineKimiCleanContent);
  if (!cleanedSource) return;

  let parsedResult: { cleanedContent: string; toolCalls: TextToolCall[] };
  try {
    parsedResult = deps.textToolParser.parse(cleanedSource);
  } catch (error) {
    deps.logger.debug(
      () => `TextToolCallParser failed on message content: ${error}`,
    );
    return;
  }

  if (parsedResult.toolCalls.length === 0) return;

  for (const call of parsedResult.toolCalls) {
    blocks.push({
      type: 'tool_call',
      id: `text_tool_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name: normalizeToolName(call.name),
      parameters: call.arguments,
    } as ToolCallBlock);
  }

  // Update the text content to remove the tool call parts
  if (originalContent !== parsedResult.cleanedContent) {
    const textBlockIndex = blocks.findIndex((block) => block.type === 'text');
    if (textBlockIndex >= 0) {
      (blocks[textBlockIndex] as TextBlock).text = parsedResult.cleanedContent;
    } else if (parsedResult.cleanedContent.trim()) {
      blocks.unshift({
        type: 'text',
        text: parsedResult.cleanedContent,
      } as TextBlock);
    }
  }
}
