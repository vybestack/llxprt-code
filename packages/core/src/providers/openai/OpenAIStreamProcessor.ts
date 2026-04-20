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
  type ThinkingBlock,
} from '../../services/history/IContent.js';
import { type DebugLogger } from '../../debug/index.js';
import { type ToolCallPipeline } from './ToolCallPipeline.js';
import { type GemmaToolCallParser } from '../../parsers/TextToolCallParser.js';
import { extractThinkTagsAsBlock } from '../utils/thinkingExtraction.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { extractCacheMetrics } from '../utils/cacheMetricsExtractor.js';
import { normalizeToolName } from '../utils/toolNameNormalization.js';
import {
  normalizeToHistoryToolId,
  normalizeToOpenAIToolId,
} from '../utils/toolIdNormalization.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import {
  coerceMessageContentToString,
  sanitizeToolArgumentsString,
  extractKimiToolCallsFromText,
  cleanThinkingContent,
  parseStreamingReasoningDelta,
} from './OpenAIResponseParser.js';
import { mapFinishReasonToStopReason } from './finishReasonMapping.js';
import { type ToolFormat } from '../../tools/IToolFormatter.js';

export interface StreamProcessorDeps {
  toolCallPipeline: ToolCallPipeline;
  textToolParser: GemmaToolCallParser;
  logger: DebugLogger;
  getBaseURL: () => string | undefined;
}

interface StreamingState {
  accumulatedText: string;
  textBuffer: string;
  accumulatedThinkingContent: string;
  hasEmittedThinking: boolean;
  accumulatedReasoningContent: string;
  streamingUsage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  lastFinishReason: string | null | undefined;
  hasEmittedTerminalMetadata: boolean;
  cachedPipelineResult: Awaited<
    ReturnType<typeof ToolCallPipeline.prototype.process>
  > | null;
  allChunks: OpenAI.Chat.Completions.ChatCompletionChunk[];
}

function createStreamingState(): StreamingState {
  return {
    accumulatedText: '',
    textBuffer: '',
    accumulatedThinkingContent: '',
    hasEmittedThinking: false,
    accumulatedReasoningContent: '',
    streamingUsage: null,
    lastFinishReason: null,
    hasEmittedTerminalMetadata: false,
    cachedPipelineResult: null,
    allChunks: [],
  };
}

async function* flushTextBuffer(
  buffer: string,
  state: StreamingState,
  deps: StreamProcessorDeps,
): AsyncGenerator<IContent, void, unknown> {
  const parsedToolCalls: ToolCallBlock[] = [];
  const originalBufferLength = buffer.length;
  let workingText = buffer;

  deps.logger.debug(() => `[stream:buffer] flushing buffered text`, {
    bufferLength: originalBufferLength,
    accumulatedThinkingLength: state.accumulatedThinkingContent.length,
    hasEmittedThinking: state.hasEmittedThinking,
  });

  // Extract <think> tags
  const tagBasedThinking = extractThinkTagsAsBlock(workingText);
  if (tagBasedThinking) {
    const cleanedThought = cleanThinkingContent(
      tagBasedThinking.thought,
      deps.logger,
    );
    if (state.accumulatedThinkingContent.length > 0) {
      state.accumulatedThinkingContent += '\n';
    }
    state.accumulatedThinkingContent += cleanedThought;
    deps.logger.debug(
      () =>
        `[Streaming] Accumulated thinking: ${state.accumulatedThinkingContent.length} chars total`,
    );
  }

  const kimiParsed = extractKimiToolCallsFromText(workingText, deps.logger);
  if (kimiParsed.toolCalls.length > 0) {
    parsedToolCalls.push(...kimiParsed.toolCalls);
    deps.logger.debug(
      () =>
        `[OpenAIProvider] Streaming buffer (pipeline) parsed Kimi tool calls`,
      {
        count: kimiParsed.toolCalls.length,
        bufferLength: workingText.length,
        cleanedLength: kimiParsed.cleanedText.length,
      },
    );
  }
  workingText = kimiParsed.cleanedText;

  const parsingText = sanitizeProviderText(workingText);
  let cleanedText = parsingText;
  try {
    const parsedResult = deps.textToolParser.parse(parsingText);
    if (parsedResult.toolCalls.length > 0) {
      parsedToolCalls.push(
        ...parsedResult.toolCalls.map((call) => ({
          type: 'tool_call' as const,
          id: `text_tool_${Date.now()}_${Math.random()
            .toString(36)
            .substring(7)}`,
          name: normalizeToolName(call.name),
          parameters: call.arguments,
        })),
      );
      cleanedText = parsedResult.cleanedContent;
    }
  } catch (error) {
    deps.logger.debug(
      () => `TextToolCallParser failed on buffered text: ${error}`,
    );
  }

  const shouldEmitThinking =
    !state.hasEmittedThinking &&
    state.accumulatedThinkingContent.length > 0 &&
    (parsedToolCalls.length > 0 || cleanedText.trim().length > 0);

  // Emit accumulated thinking BEFORE tool calls or text content
  if (shouldEmitThinking) {
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: state.accumulatedThinkingContent,
          sourceField: 'think_tags',
          isHidden: false,
        } as ThinkingBlock,
      ],
    } as IContent;
    state.hasEmittedThinking = true;
    deps.logger.debug(
      () =>
        `[Streaming pipeline] Emitted accumulated thinking: ${state.accumulatedThinkingContent.length} chars`,
    );
  }

  if (parsedToolCalls.length > 0) {
    yield {
      speaker: 'ai',
      blocks: parsedToolCalls,
    } as IContent;
  }

  // Bug fix #721: Emit whitespace-only chunks
  if (cleanedText.length > 0) {
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: cleanedText,
        } as TextBlock,
      ],
    } as IContent;
  }

  if (
    !shouldEmitThinking &&
    parsedToolCalls.length === 0 &&
    cleanedText.length === 0
  ) {
    deps.logger.warn(() => `[stream:buffer] flush produced no emitted blocks`, {
      bufferLength: originalBufferLength,
      hadThinkTags: Boolean(tagBasedThinking),
      cleanedWorkingTextLength: workingText.length,
      accumulatedThinkingLength: state.accumulatedThinkingContent.length,
    });
  } else {
    deps.logger.debug(() => `[stream:buffer] flush emitted buffered content`, {
      bufferLength: originalBufferLength,
      emittedThinking: shouldEmitThinking,
      toolCallCount: parsedToolCalls.length,
      textLength: cleanedText.length,
    });
  }
}

/**
 * Process streaming response from OpenAI API
 */
export async function* processStreamingResponse(
  response: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  model: string,
  detectedFormat: string,
  abortSignal: AbortSignal | undefined,
  requestBody: OpenAI.Chat.ChatCompletionCreateParams,
  messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[],
  client: OpenAI,
  mergedHeaders: Record<string, string> | undefined,
  baseURL: string | undefined,
  deps: StreamProcessorDeps,
  requestContinuation: (
    toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>,
    messagesWithSystem: OpenAI.Chat.ChatCompletionMessageParam[],
    requestBody: OpenAI.Chat.ChatCompletionCreateParams,
    client: OpenAI,
    abortSignal: AbortSignal | undefined,
    model: string,
    logger: DebugLogger,
    mergedHeaders: Record<string, string> | undefined,
    toolFormat: ToolFormat,
  ) => AsyncGenerator<IContent, void, unknown>,
): AsyncGenerator<IContent, void, unknown> {
  const state = createStreamingState();
  const shouldBufferText = detectedFormat === 'qwen';

  // Initialize tool call pipeline
  deps.toolCallPipeline.reset();

  try {
    // Process chunks inline as they arrive from the HTTP stream.
    // CRITICAL: Do NOT collect all chunks first — that blocks the entire pipeline,
    // prevents abort signal checks, and causes indefinite hangs. See #1846.
    for await (const chunk of response) {
      if (abortSignal?.aborted) {
        break;
      }
      state.allChunks.push(chunk);

      const chunkRecord = chunk as unknown as Record<string, unknown>;
      let parsedData: Record<string, unknown> | undefined;
      const rawData = chunkRecord?.data;
      if (typeof rawData === 'string') {
        try {
          parsedData = JSON.parse(rawData) as Record<string, unknown>;
        } catch {
          parsedData = undefined;
        }
      } else if (rawData && typeof rawData === 'object') {
        parsedData = rawData as Record<string, unknown>;
      }

      const streamingError =
        chunkRecord?.error ??
        parsedData?.error ??
        (parsedData?.data as { error?: unknown } | undefined)?.error;
      const streamingEvent = (chunkRecord?.event ?? parsedData?.event) as
        | string
        | undefined;
      const streamingErrorMessage =
        (streamingError as { message?: string } | undefined)?.message ??
        (streamingError as { error?: string } | undefined)?.error ??
        (parsedData as { message?: string } | undefined)?.message;
      if (
        streamingEvent === 'error' ||
        (streamingError && typeof streamingError === 'object')
      ) {
        const errorMessage =
          streamingErrorMessage ??
          (typeof streamingError === 'string'
            ? streamingError
            : 'Streaming response reported an error.');
        throw new Error(errorMessage);
      }

      // Extract usage information
      if (chunk.usage) {
        state.streamingUsage = chunk.usage;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      // Parse reasoning_content
      const { thinking: reasoningBlock, toolCalls: reasoningToolCalls } =
        parseStreamingReasoningDelta(choice.delta, deps.logger);
      if (reasoningBlock) {
        state.accumulatedReasoningContent += reasoningBlock.thought;
      }
      if (reasoningToolCalls.length > 0) {
        const stats = deps.toolCallPipeline.getStats();
        let baseIndex = stats.collector.totalCalls;

        for (const toolCall of reasoningToolCalls) {
          deps.toolCallPipeline.addFragment(baseIndex, {
            id: `call_kimi_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: toolCall.name,
            args: JSON.stringify(toolCall.parameters),
          });
          baseIndex++;
        }
      }

      // Check for finish_reason
      if (choice.finish_reason) {
        state.lastFinishReason = choice.finish_reason;
        deps.logger.debug(
          () =>
            `[Streaming] Stream finished with reason: ${choice.finish_reason}`,
          {
            model,
            finishReason: choice.finish_reason,
            hasAccumulatedText: state.accumulatedText.length > 0,
            hasAccumulatedTools:
              deps.toolCallPipeline.getStats().collector.totalCalls > 0,
            hasBufferedText: state.textBuffer.length > 0,
          },
        );

        if (choice.finish_reason === 'length') {
          deps.logger.debug(
            () => `Response truncated due to length limit for model ${model}`,
          );
        }
      }

      // Handle text content
      const rawDeltaContent = coerceMessageContentToString(
        choice.delta?.content as unknown,
      );
      if (rawDeltaContent) {
        const deltaContent = sanitizeProviderText(rawDeltaContent);
        if (!deltaContent) {
          continue;
        }

        state.accumulatedText += deltaContent;

        if (shouldBufferText) {
          deps.logger.debug(
            () => `[Streaming] Chunk content for ${detectedFormat} format:`,
            {
              deltaContent,
              length: deltaContent.length,
              hasNewline: deltaContent.includes('\n'),
              escaped: JSON.stringify(deltaContent),
              bufferSize: state.textBuffer.length,
            },
          );

          state.textBuffer += deltaContent;

          const kimiBeginCount = (
            state.textBuffer.match(/<\|tool_calls_section_begin\|>/g) || []
          ).length;
          const kimiEndCount = (
            state.textBuffer.match(/<\|tool_calls_section_end\|>/g) || []
          ).length;
          const hasOpenKimiSection = kimiBeginCount > kimiEndCount;

          deps.logger.debug(
            () => `[stream:kimi-buffer] updated buffered text state`,
            {
              model,
              detectedFormat,
              bufferLength: state.textBuffer.length,
              kimiBeginCount,
              kimiEndCount,
              hasOpenKimiSection,
            },
          );

          // Emit buffered text at natural break points
          if (
            !hasOpenKimiSection &&
            (state.textBuffer.includes('\n') ||
              state.textBuffer.endsWith('. ') ||
              state.textBuffer.endsWith('! ') ||
              state.textBuffer.endsWith('? ') ||
              state.textBuffer.length > 100)
          ) {
            deps.logger.debug(
              () =>
                `[stream:kimi-buffer] flushing buffered text at natural boundary`,
              {
                model,
                detectedFormat,
                bufferLength: state.textBuffer.length,
                kimiBeginCount,
                kimiEndCount,
              },
            );
            yield* flushTextBuffer(state.textBuffer, state, deps);
            state.textBuffer = '';
          } else if (hasOpenKimiSection) {
            deps.logger.debug(
              () =>
                `[stream:kimi-buffer] suppressing flush because tool-call section is still open`,
              {
                model,
                detectedFormat,
                bufferLength: state.textBuffer.length,
                kimiBeginCount,
                kimiEndCount,
              },
            );
          }
        } else {
          // Emit immediately for non-buffered providers
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: deltaContent,
              } as TextBlock,
            ],
          } as IContent;
        }
      }

      // Handle tool calls using pipeline
      const deltaToolCalls = choice.delta?.tool_calls;
      if (deltaToolCalls && deltaToolCalls.length > 0) {
        for (const deltaToolCall of deltaToolCalls) {
          if (deltaToolCall.index === undefined) continue;

          deps.toolCallPipeline.addFragment(deltaToolCall.index, {
            id: deltaToolCall.id,
            name: deltaToolCall.function?.name,
            args: deltaToolCall.function?.arguments,
          });
        }
      }

      const choiceMessage = (
        choice as {
          message?: {
            tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
          };
        }
      ).message;
      const messageToolCalls = choiceMessage?.tool_calls;
      if (messageToolCalls && messageToolCalls.length > 0) {
        messageToolCalls.forEach(
          (
            toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
            index: number,
          ) => {
            if (!toolCall || toolCall.type !== 'function') {
              return;
            }

            deps.toolCallPipeline.addFragment(index, {
              id: toolCall.id,
              name: toolCall.function?.name,
              args: toolCall.function?.arguments,
            });
          },
        );
      }
    }
  } catch (error) {
    if (
      abortSignal?.aborted ||
      (error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'AbortError')
    ) {
      deps.logger.debug(
        () =>
          `Pipeline streaming response cancelled by AbortSignal (error: ${error instanceof Error ? error.name : 'unknown'})`,
      );
      throw error;
    } else {
      // Special handling for Cerebras/Qwen errors
      const errorMessage = String(error);
      if (
        errorMessage.includes('Tool is not present in the tools list') &&
        (model.toLowerCase().includes('qwen') ||
          deps.getBaseURL()?.includes('cerebras'))
      ) {
        deps.logger.error(
          'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
          {
            error,
            model,
          },
        );
        const enhancedError = new Error(
          `Cerebras/Qwen API bug: Tool not found in list during streaming. Known API issue.`,
        );
        (enhancedError as Error & { originalError?: unknown }).originalError =
          error;
        throw enhancedError;
      }
      deps.logger.error('Error processing streaming response:', error);
      throw error;
    }
  }

  // Final buffer flush
  if (state.textBuffer.length > 0) {
    deps.logger.debug(
      () => `[stream:buffer] final flush of remaining buffered text`,
      {
        bufferLength: state.textBuffer.length,
        model,
        detectedFormat,
      },
    );
    yield* flushTextBuffer(state.textBuffer, state, deps);
    state.textBuffer = '';
  }

  // Emit any remaining accumulated thinking
  if (
    !state.hasEmittedThinking &&
    state.accumulatedThinkingContent.length > 0
  ) {
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: state.accumulatedThinkingContent,
          sourceField: 'think_tags',
          isHidden: false,
        } as ThinkingBlock,
      ],
    } as IContent;
    state.hasEmittedThinking = true;
  }

  // Process pipeline and emit combined content
  const pipelineStatsBeforeProcess = deps.toolCallPipeline.getStats();
  const incompleteToolCallsBeforeProcess =
    pipelineStatsBeforeProcess.collector.totalCalls -
    pipelineStatsBeforeProcess.collector.completedCalls;
  deps.logger.debug(
    () => `[stream:tool-pipeline] processing collected tool-call fragments`,
    {
      model,
      collectorStats: pipelineStatsBeforeProcess.collector,
      incompleteToolCallsBeforeProcess,
    },
  );
  state.cachedPipelineResult = await deps.toolCallPipeline.process(abortSignal);
  deps.logger.debug(
    () => `[stream:tool-pipeline] completed tool-call processing`,
    {
      model,
      collectorStatsBeforeReset: pipelineStatsBeforeProcess.collector,
      normalizedCount: state.cachedPipelineResult.normalized.length,
      failedCount: state.cachedPipelineResult.failed.length,
      incompleteToolCallsBeforeProcess,
    },
  );

  {
    const { cleanedText: cleanedReasoning, toolCalls: reasoningToolCalls } =
      state.accumulatedReasoningContent.length > 0
        ? extractKimiToolCallsFromText(
            state.accumulatedReasoningContent,
            deps.logger,
          )
        : { cleanedText: '', toolCalls: [] as ToolCallBlock[] };

    const pipelineToolCallBlocks: ToolCallBlock[] = [];
    if (
      state.cachedPipelineResult.normalized.length > 0 ||
      state.cachedPipelineResult.failed.length > 0
    ) {
      for (const normalizedCall of state.cachedPipelineResult.normalized) {
        const sanitizedArgs = sanitizeToolArgumentsString(
          normalizedCall.originalArgs ?? normalizedCall.args,
          deps.logger,
        );

        const processedParameters = processToolParameters(
          sanitizedArgs,
          normalizedCall.name,
        );

        pipelineToolCallBlocks.push({
          type: 'tool_call',
          id: normalizeToHistoryToolId(
            normalizedCall.id || `call_${normalizedCall.index}`,
          ),
          name: normalizedCall.name,
          parameters: processedParameters,
        });
      }

      for (const failed of state.cachedPipelineResult.failed) {
        deps.logger.warn(
          `Tool call validation failed for index ${failed.index}: ${failed.validationErrors.join(', ')}`,
        );
      }
    }

    const combinedBlocks: Array<ThinkingBlock | ToolCallBlock> = [];

    if (cleanedReasoning.length > 0) {
      combinedBlocks.push({
        type: 'thinking',
        thought: cleanedReasoning,
        sourceField: 'reasoning_content',
        isHidden: false,
      } as ThinkingBlock);
    }

    combinedBlocks.push(...reasoningToolCalls, ...pipelineToolCallBlocks);

    if (combinedBlocks.length > 0) {
      const combinedContent: IContent = {
        speaker: 'ai',
        blocks: combinedBlocks,
      };

      const stopReason = mapFinishReasonToStopReason(state.lastFinishReason);
      deps.logger.debug(
        () => `[stream:terminal] building combined terminal content`,
        {
          model,
          combinedBlockCount: combinedBlocks.length,
          cleanedReasoningLength: cleanedReasoning.length,
          reasoningToolCallCount: reasoningToolCalls.length,
          pipelineToolCallCount: pipelineToolCallBlocks.length,
          rawFinishReason: state.lastFinishReason,
          stopReason,
          hasStreamingUsage: Boolean(state.streamingUsage),
        },
      );

      if (state.streamingUsage) {
        const cacheMetrics = extractCacheMetrics(state.streamingUsage);
        combinedContent.metadata = {
          usage: {
            promptTokens: state.streamingUsage.prompt_tokens || 0,
            completionTokens: state.streamingUsage.completion_tokens || 0,
            totalTokens:
              state.streamingUsage.total_tokens ||
              (state.streamingUsage.prompt_tokens || 0) +
                (state.streamingUsage.completion_tokens || 0),
            cachedTokens: cacheMetrics.cachedTokens,
            cacheCreationTokens: cacheMetrics.cacheCreationTokens,
            cacheMissTokens: cacheMetrics.cacheMissTokens,
          },
          ...(stopReason && { stopReason }),
        };
      } else if (stopReason) {
        combinedContent.metadata = { stopReason };
      }

      // Propagate terminal metadata so downstream turn handling and telemetry
      // receive a finish signal (issue #1844).  stopReason stays normalized
      // (via mapFinishReasonToStopReason above); finishReason preserves the
      // raw provider value for diagnostics.
      if (state.lastFinishReason) {
        if (!combinedContent.metadata) {
          combinedContent.metadata = {};
        }
        // stopReason was already set to the normalized value above; do NOT
        // overwrite it with the raw provider string.
        combinedContent.metadata.finishReason = state.lastFinishReason;
        state.hasEmittedTerminalMetadata = true;
      }

      deps.logger.debug(
        () => `[stream:terminal] emitting combined terminal content`,
        {
          model,
          blockCount: combinedContent.blocks.length,
          stopReason: combinedContent.metadata?.stopReason,
          finishReason: combinedContent.metadata?.finishReason,
          hasUsage: Boolean(combinedContent.metadata?.usage),
          hasEmittedTerminalMetadata: state.hasEmittedTerminalMetadata,
        },
      );
      yield combinedContent;
    } else {
      deps.logger.debug(
        () => `[stream:terminal] skipped combined terminal content emission`,
        {
          model,
          cleanedReasoningLength: cleanedReasoning.length,
          reasoningToolCallCount: reasoningToolCalls.length,
          pipelineToolCallCount: pipelineToolCallBlocks.length,
          rawFinishReason: state.lastFinishReason,
          hasStreamingUsage: Boolean(state.streamingUsage),
        },
      );
    }
  }

  // Emit metadata-only response if needed
  if (
    state.streamingUsage &&
    state.accumulatedReasoningContent.length === 0 &&
    deps.toolCallPipeline.getStats().collector.totalCalls === 0
  ) {
    const cacheMetrics = extractCacheMetrics(state.streamingUsage);
    const stopReason = mapFinishReasonToStopReason(state.lastFinishReason);
    const metaOnlyContent: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: {
        usage: {
          promptTokens: state.streamingUsage.prompt_tokens || 0,
          completionTokens: state.streamingUsage.completion_tokens || 0,
          totalTokens:
            state.streamingUsage.total_tokens ||
            (state.streamingUsage.prompt_tokens || 0) +
              (state.streamingUsage.completion_tokens || 0),
          cachedTokens: cacheMetrics.cachedTokens,
          cacheCreationTokens: cacheMetrics.cacheCreationTokens,
          cacheMissTokens: cacheMetrics.cacheMissTokens,
        },
        ...(stopReason && { stopReason }),
      },
    };

    // Propagate terminal metadata on usage-only chunk (issue #1844).
    // stopReason stays normalized; finishReason preserves raw value.
    if (state.lastFinishReason && metaOnlyContent.metadata) {
      metaOnlyContent.metadata.finishReason = state.lastFinishReason;
      state.hasEmittedTerminalMetadata = true;
    }

    deps.logger.debug(
      () => `[stream:terminal] emitting usage-only terminal metadata chunk`,
      {
        model,
        stopReason: metaOnlyContent.metadata?.stopReason,
        finishReason: metaOnlyContent.metadata?.finishReason,
        hasUsage: Boolean(metaOnlyContent.metadata?.usage),
        hasEmittedTerminalMetadata: state.hasEmittedTerminalMetadata,
      },
    );
    yield metaOnlyContent;
  } else if (state.streamingUsage) {
    deps.logger.debug(
      () => `[stream:terminal] skipped usage-only terminal metadata chunk`,
      {
        model,
        reasoningLength: state.accumulatedReasoningContent.length,
        collectorStats: deps.toolCallPipeline.getStats().collector,
        hasEmittedTerminalMetadata: state.hasEmittedTerminalMetadata,
      },
    );
  }

  // Emit a terminal metadata chunk even when there is no usage, so
  // downstream turn handling always receives a finish signal (issue #1844).
  if (
    state.lastFinishReason &&
    !state.streamingUsage &&
    !state.hasEmittedTerminalMetadata &&
    deps.toolCallPipeline.getStats().collector.totalCalls === 0
  ) {
    state.hasEmittedTerminalMetadata = true;
    const normalizedStopReason = mapFinishReasonToStopReason(
      state.lastFinishReason,
    );
    deps.logger.debug(
      () => `[stream:terminal] emitting metadata-only terminal chunk`,
      {
        model,
        stopReason: normalizedStopReason,
        finishReason: state.lastFinishReason,
      },
    );
    yield {
      speaker: 'ai',
      blocks: [],
      metadata: {
        stopReason: normalizedStopReason,
        finishReason: state.lastFinishReason,
      },
    } as IContent;
  } else if (state.lastFinishReason && !state.streamingUsage) {
    deps.logger.debug(
      () => `[stream:terminal] skipped metadata-only terminal chunk`,
      {
        model,
        finishReason: state.lastFinishReason,
        hasEmittedTerminalMetadata: state.hasEmittedTerminalMetadata,
        collectorStats: deps.toolCallPipeline.getStats().collector,
      },
    );
  }

  // Handle empty streaming responses after tool calls
  const toolCallCount =
    (state.cachedPipelineResult?.normalized.length ?? 0) +
    (state.cachedPipelineResult?.failed.length ?? 0);
  const hasToolsButNoText =
    state.lastFinishReason === 'stop' &&
    toolCallCount > 0 &&
    state.accumulatedText.length === 0 &&
    state.textBuffer.length === 0 &&
    state.accumulatedReasoningContent.length === 0 &&
    state.accumulatedThinkingContent.length === 0;

  if (hasToolsButNoText) {
    deps.logger.log(
      () =>
        `[OpenAIProvider] Model returned tool calls but no text (finish_reason=stop). Requesting continuation for model '${model}'.`,
      {
        model,
        toolCallCount,
        baseURL: baseURL ?? deps.getBaseURL(),
      },
    );

    if (!state.cachedPipelineResult) {
      throw new Error(
        'Pipeline result not cached - this should not happen in pipeline mode',
      );
    }
    const toolCallsForHistory = state.cachedPipelineResult.normalized.map(
      (normalizedCall, index) => ({
        id:
          normalizedCall.id && normalizedCall.id.trim().length > 0
            ? normalizeToOpenAIToolId(normalizedCall.id)
            : `call_${index}`,
        type: 'function' as const,
        function: {
          name: normalizedCall.name,
          arguments: JSON.stringify(normalizedCall.args),
        },
      }),
    );

    yield* requestContinuation(
      toolCallsForHistory,
      messagesWithSystem,
      requestBody,
      client,
      abortSignal,
      model,
      deps.logger,
      mergedHeaders,
      detectedFormat as ToolFormat,
    );
  }

  // Warn about empty streaming responses
  if (
    state.accumulatedText.length === 0 &&
    toolCallCount === 0 &&
    state.textBuffer.length === 0 &&
    state.accumulatedReasoningContent.length === 0 &&
    state.accumulatedThinkingContent.length === 0
  ) {
    const isKimi = model.toLowerCase().includes('kimi');
    const isSynthetic =
      (baseURL ?? deps.getBaseURL())?.includes('synthetic') ?? false;
    const troubleshooting = isKimi
      ? isSynthetic
        ? ' To fix: use streaming: "disabled" in your profile settings. Synthetic API streaming does not work reliably with tool calls.'
        : ' This provider may not support streaming with tool calls.'
      : ' Consider using streaming: "disabled" in your profile settings.';

    deps.logger.warn(
      () =>
        `[OpenAIProvider] Empty streaming response for model '${model}' (received ${state.allChunks.length} chunks with no content).${troubleshooting}`,
      {
        model,
        baseURL: baseURL ?? deps.getBaseURL(),
        isKimiModel: isKimi,
        isSyntheticAPI: isSynthetic,
        totalChunksReceived: state.allChunks.length,
      },
    );
  } else {
    deps.logger.debug(
      () => `[Streaming pipeline] Stream completed with accumulated content`,
      {
        textLength: state.accumulatedText.length,
        toolCallCount,
        textBufferLength: state.textBuffer.length,
        reasoningLength: state.accumulatedReasoningContent.length,
        thinkingLength: state.accumulatedThinkingContent.length,
        totalChunksReceived: state.allChunks.length,
      },
    );
  }
}
