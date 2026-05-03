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

  // Log finish reason using helper predicate to avoid different-types-comparison
  if (isDefined(choice.finish_reason)) {
    deps.logger.debug(
      () => `[Non-streaming] Response finish_reason: ${choice.finish_reason}`,
      {
        model,
        finishReason: choice.finish_reason,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        hasContent: !!choice.message?.content,
        hasToolCalls: !!(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          (choice.message?.tool_calls && choice.message.tool_calls.length > 0)
        ),
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        contentLength: choice.message?.content?.length ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        toolCallCount: choice.message?.tool_calls?.length ?? 0,
        detectedFormat,
      },
    );

    if (choice.finish_reason === 'length') {
      deps.logger.warn(
        () =>
          `Response truncated due to max_tokens limit for model ${model}. Consider increasing max_tokens.`,
      );
    }
  }

  const blocks: Array<TextBlock | ToolCallBlock> = [];

  // Handle text content and Kimi tool sections
  const pipelineRawMessageContent = coerceMessageContentToString(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    choice.message?.content as unknown,
  );
  let pipelineKimiCleanContent: string | undefined;
  let pipelineKimiToolBlocks: ToolCallBlock[] = [];
  if (pipelineRawMessageContent) {
    const kimiParsed = extractKimiToolCallsFromText(
      pipelineRawMessageContent,
      deps.logger,
    );
    pipelineKimiCleanContent = kimiParsed.cleanedText;
    pipelineKimiToolBlocks = kimiParsed.toolCalls;

    const cleanedText = sanitizeProviderText(pipelineKimiCleanContent);
    if (cleanedText) {
      blocks.push({
        type: 'text',
        text: cleanedText,
      } as TextBlock);
    }
  }

  // Handle tool calls
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
    for (const toolCall of choice.message.tool_calls) {
      if (toolCall.type === 'function') {
        const normalizedName = deps.toolCallPipeline.normalizeToolName(
          toolCall.function.name,
          toolCall.function.arguments,
        );

        const sanitizedArgs = sanitizeToolArgumentsString(
          toolCall.function.arguments,
          deps.logger,
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

  if (pipelineKimiToolBlocks.length > 0) {
    blocks.push(...pipelineKimiToolBlocks);
    deps.logger.debug(
      () =>
        `[OpenAIProvider] Non-stream pipeline added Kimi tool calls from text`,
      { count: pipelineKimiToolBlocks.length },
    );
  }

  // Check for InTheDocument format in text content
  if (pipelineKimiCleanContent) {
    processTextToolCalls(
      pipelineKimiCleanContent,
      blocks,
      choice.message.content,
      deps,
    );
  }

  // Emit the complete response
  const stopReason = mapFinishReasonToStopReason(choice.finish_reason);

  if (blocks.length > 0) {
    const responseContent: IContent = {
      speaker: 'ai',
      blocks,
    };

    if (completion.usage) {
      const cacheMetrics = extractCacheMetrics(completion.usage);
      // Preserve old || 0 behavior via helper: default to 0 for nullish/falsy/NaN
      const promptTokens = toTokenCount(completion.usage.prompt_tokens);
      const completionTokens = toTokenCount(completion.usage.completion_tokens);
      const totalTokens = computeTotalTokens(
        completion.usage.total_tokens,
        promptTokens,
        completionTokens,
      );
      responseContent.metadata = {
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          cachedTokens: cacheMetrics.cachedTokens,
          cacheCreationTokens: cacheMetrics.cacheCreationTokens,
          cacheMissTokens: cacheMetrics.cacheMissTokens,
        },
        // Preserve old truthy behavior: only spread non-empty string
        ...(isNonEmptyString(stopReason) && { stopReason }),
      };
    } else if (isNonEmptyString(stopReason)) {
      responseContent.metadata = { stopReason };
    }

    // Propagate terminal metadata so downstream turn handling and telemetry
    // receive a finish signal (issue #1844).  stopReason stays normalized
    // (via mapFinishReasonToStopReason above); finishReason preserves the
    // raw provider value for diagnostics.
    // Use helper predicate to avoid different-types-comparison (finish_reason is string | null)
    if (isDefined(choice.finish_reason)) {
      responseContent.metadata ??= {};
      // stopReason was already set to the normalized value above; do NOT
      // overwrite it with the raw provider string.
      responseContent.metadata.finishReason = choice.finish_reason;
    }

    yield responseContent;
  } else if (completion.usage) {
    // Emit metadata-only response
    const cacheMetrics = extractCacheMetrics(completion.usage);
    // Preserve old || 0 behavior via helper: default to 0 for nullish/falsy/NaN
    const promptTokens = toTokenCount(completion.usage.prompt_tokens);
    const completionTokens = toTokenCount(completion.usage.completion_tokens);
    const totalTokens = computeTotalTokens(
      completion.usage.total_tokens,
      promptTokens,
      completionTokens,
    );
    const metadataOnly: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: {
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          cachedTokens: cacheMetrics.cachedTokens,
          cacheCreationTokens: cacheMetrics.cacheCreationTokens,
          cacheMissTokens: cacheMetrics.cacheMissTokens,
        },
        // Preserve old truthy behavior: only spread non-empty string
        ...(isNonEmptyString(stopReason) && { stopReason }),
      },
    };

    // Propagate terminal metadata on usage-only responses too (issue #1844).
    // Use helper predicate to check finish_reason without different-types-comparison
    if (isDefined(choice.finish_reason) && metadataOnly.metadata) {
      metadataOnly.metadata.finishReason = choice.finish_reason;
    }

    yield metadataOnly;
    // Use helper predicate for finish_reason check
  } else if (isDefined(choice.finish_reason)) {
    // Emit a metadata-only chunk even without usage so downstream receives
    // the terminal finish signal (issue #1844).  stopReason is normalized.
    yield {
      speaker: 'ai',
      blocks: [],
      metadata: {
        stopReason,
        finishReason: choice.finish_reason,
      },
    } as IContent;
  } else if (isNonEmptyString(stopReason)) {
    // Preserve old truthy behavior: only emit for non-empty string
    yield {
      speaker: 'ai',
      blocks: [],
      metadata: { stopReason },
    } as IContent;
  }
}

/**
 * Process text tool calls from Kimi format.
 * Extracts tool calls and updates text blocks accordingly.
 */
function processTextToolCalls(
  pipelineKimiCleanContent: string,
  blocks: IContent['blocks'],
  originalContent: string | null | undefined,
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
