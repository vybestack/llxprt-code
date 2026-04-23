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
import {
  type IContent,
  type TextBlock,
  type ToolCallBlock,
} from '../../services/history/IContent.js';
import { type DebugLogger } from '../../debug/index.js';
import { type ToolCallPipeline } from './ToolCallPipeline.js';
import { type GemmaToolCallParser } from '../../parsers/TextToolCallParser.js';
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
  const choice = completion.choices?.[0];

  if (!choice) {
    throw new Error('No choices in completion response');
  }

  // Log finish reason
  if (choice.finish_reason) {
    deps.logger.debug(
      () => `[Non-streaming] Response finish_reason: ${choice.finish_reason}`,
      {
        model,
        finishReason: choice.finish_reason,
        hasContent: !!choice.message?.content,
        hasToolCalls: !!(
          choice.message?.tool_calls && choice.message.tool_calls.length > 0
        ),
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: number where 0 means unset
        contentLength: choice.message?.content?.length || 0,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: number where 0 means unset
        toolCallCount: choice.message?.tool_calls?.length || 0,
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

  // Check for <tool_call> format in text content
  if (pipelineKimiCleanContent) {
    const cleanedSource = sanitizeProviderText(pipelineKimiCleanContent);
    if (cleanedSource) {
      try {
        const parsedResult = deps.textToolParser.parse(cleanedSource);
        if (parsedResult.toolCalls.length > 0) {
          for (const call of parsedResult.toolCalls) {
            blocks.push({
              type: 'tool_call',
              id: `text_tool_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              name: normalizeToolName(call.name),
              parameters: call.arguments,
            } as ToolCallBlock);
          }

          // Update the text content to remove the tool call parts
          if (choice.message.content !== parsedResult.cleanedContent) {
            const textBlockIndex = blocks.findIndex(
              (block) => block.type === 'text',
            );
            if (textBlockIndex >= 0) {
              (blocks[textBlockIndex] as TextBlock).text =
                parsedResult.cleanedContent;
            } else if (parsedResult.cleanedContent.trim()) {
              blocks.unshift({
                type: 'text',
                text: parsedResult.cleanedContent,
              } as TextBlock);
            }
          }
        }
      } catch (error) {
        deps.logger.debug(
          () => `TextToolCallParser failed on message content: ${error}`,
        );
      }
    }
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
      responseContent.metadata = {
        usage: {
          promptTokens: completion.usage.prompt_tokens || 0,
          completionTokens: completion.usage.completion_tokens || 0,
          totalTokens:
            completion.usage.total_tokens ||
            (completion.usage.prompt_tokens || 0) +
              (completion.usage.completion_tokens || 0),
          cachedTokens: cacheMetrics.cachedTokens,
          cacheCreationTokens: cacheMetrics.cacheCreationTokens,
          cacheMissTokens: cacheMetrics.cacheMissTokens,
        },
        ...(stopReason && { stopReason }),
      };
    } else if (stopReason) {
      responseContent.metadata = { stopReason };
    }

    // Propagate terminal metadata so downstream turn handling and telemetry
    // receive a finish signal (issue #1844).  stopReason stays normalized
    // (via mapFinishReasonToStopReason above); finishReason preserves the
    // raw provider value for diagnostics.
    if (choice.finish_reason) {
      responseContent.metadata ??= {};
      // stopReason was already set to the normalized value above; do NOT
      // overwrite it with the raw provider string.
      responseContent.metadata.finishReason = choice.finish_reason;
    }

    yield responseContent;
  } else if (completion.usage) {
    // Emit metadata-only response
    const cacheMetrics = extractCacheMetrics(completion.usage);
    const metadataOnly: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: {
        usage: {
          promptTokens: completion.usage.prompt_tokens || 0,
          completionTokens: completion.usage.completion_tokens || 0,
          totalTokens:
            completion.usage.total_tokens ||
            (completion.usage.prompt_tokens || 0) +
              (completion.usage.completion_tokens || 0),
          cachedTokens: cacheMetrics.cachedTokens,
          cacheCreationTokens: cacheMetrics.cacheCreationTokens,
          cacheMissTokens: cacheMetrics.cacheMissTokens,
        },
        ...(stopReason && { stopReason }),
      },
    };

    // Propagate terminal metadata on usage-only responses too (issue #1844).
    if (choice.finish_reason && metadataOnly.metadata) {
      metadataOnly.metadata.finishReason = choice.finish_reason;
    }

    yield metadataOnly;
  } else if (choice.finish_reason) {
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
  } else if (stopReason) {
    yield {
      speaker: 'ai',
      blocks: [],
      metadata: { stopReason },
    } as IContent;
  }
}
