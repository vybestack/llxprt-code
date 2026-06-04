/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
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
import {
  type StreamingState,
  createStreamingState,
  hasNaturalBreakPoint,
  hasToolsButNoTextContent,
  checkStreamingError,
  parseChunkData,
  buildUsageMetadata,
  applyTerminalMetadata,
  isCancellation,
  logStreamCompletionSummary,
  buildToolCallsForHistory,
  emitFinishOnlyMetadata,
  emitUsageOnlyMetadata,
} from './OpenAIStreamProcessorState.js';

export interface StreamProcessorDeps {
  toolCallPipeline: ToolCallPipeline;
  textToolParser: GemmaToolCallParser;
  logger: DebugLogger;
  getBaseURL: () => string | undefined;
}

/**
 * Parse buffer text for tool calls and thinking, returning extracted data.
 */
function parseBufferText(
  buffer: string,
  state: StreamingState,
  deps: StreamProcessorDeps,
): { parsedToolCalls: ToolCallBlock[]; cleanedText: string } {
  const parsedToolCalls: ToolCallBlock[] = [];
  let workingText = buffer;

  // Extract tags
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
  return { parsedToolCalls, cleanedText };
}

/**
 * Emit parsed content blocks (thinking, tool calls, text) from a buffer flush.
 */
async function* emitParsedBlocks(
  parsedToolCalls: ToolCallBlock[],
  cleanedText: string,
  state: StreamingState,
  deps: StreamProcessorDeps,
): AsyncGenerator<IContent, void, unknown> {
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
}

async function* flushTextBuffer(
  buffer: string,
  state: StreamingState,
  deps: StreamProcessorDeps,
): AsyncGenerator<IContent, void, unknown> {
  const originalBufferLength = buffer.length;

  deps.logger.debug(() => `[stream:buffer] flushing buffered text`, {
    bufferLength: originalBufferLength,
    accumulatedThinkingLength: state.accumulatedThinkingContent.length,
    hasEmittedThinking: state.hasEmittedThinking,
  });

  const { parsedToolCalls, cleanedText } = parseBufferText(buffer, state, deps);
  yield* emitParsedBlocks(parsedToolCalls, cleanedText, state, deps);

  const hadThinking =
    state.accumulatedThinkingContent.length > 0 || state.hasEmittedThinking;
  if (
    !hadThinking &&
    parsedToolCalls.length === 0 &&
    cleanedText.length === 0
  ) {
    deps.logger.warn(() => `[stream:buffer] flush produced no emitted blocks`, {
      bufferLength: originalBufferLength,
      cleanedWorkingTextLength: buffer.length,
      accumulatedThinkingLength: state.accumulatedThinkingContent.length,
    });
  } else {
    deps.logger.debug(() => `[stream:buffer] flush emitted buffered content`, {
      bufferLength: originalBufferLength,
      toolCallCount: parsedToolCalls.length,
      textLength: cleanedText.length,
    });
  }
}

/**
 * Process reasoning and tool-call fragments from a choice delta.
 */
function processReasoningDelta(
  choice: OpenAI.Chat.Completions.ChatCompletionChunk.Choice,
  state: StreamingState,
  deps: StreamProcessorDeps,
): void {
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
}

/**
 * Handle text delta content: buffer or immediately emit.
 */
async function* handleTextDelta(
  deltaContent: string,
  state: StreamingState,
  shouldBufferText: boolean,
  detectedFormat: string,
  model: string,
  deps: StreamProcessorDeps,
): AsyncGenerator<IContent, void, unknown> {
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
      state.textBuffer.match(/<\|tool_calls_section_begin\|>/g) ?? []
    ).length;
    const kimiEndCount = (
      state.textBuffer.match(/<\|tool_calls_section_end\|>/g) ?? []
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

    if (hasNaturalBreakPoint(state.textBuffer, hasOpenKimiSection)) {
      deps.logger.debug(
        () => `[stream:kimi-buffer] flushing buffered text at natural boundary`,
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

/**
 * Feed tool-call fragments from a choice delta into the pipeline.
 */
function processDeltaToolCalls(
  choice: OpenAI.Chat.Completions.ChatCompletionChunk.Choice,
  deps: StreamProcessorDeps,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  const deltaToolCalls = choice.delta?.tool_calls;
  if (deltaToolCalls && deltaToolCalls.length > 0) {
    for (const deltaToolCall of deltaToolCalls) {
      const deltaToolCallIndex = deltaToolCall.index as number | undefined;
      if (deltaToolCallIndex === undefined) continue;

      deps.toolCallPipeline.addFragment(deltaToolCallIndex, {
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
        if (toolCall.type !== 'function') {
          return;
        }

        deps.toolCallPipeline.addFragment(index, {
          id: toolCall.id,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          name: toolCall.function?.name,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          args: toolCall.function?.arguments,
        });
      },
    );
  }
}

/**
 * Process a single streaming chunk and update state / yield content.
 */
async function* processStreamingChunk(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
  state: StreamingState,
  shouldBufferText: boolean,
  model: string,
  detectedFormat: string,
  abortSignal: AbortSignal | undefined,
  deps: StreamProcessorDeps,
): AsyncGenerator<IContent, void, unknown> {
  if (abortSignal?.aborted === true) {
    return;
  }
  state.allChunks.push(chunk);

  const chunkRecord = chunk as unknown as Record<string, unknown>;
  const parsedData = parseChunkData(chunkRecord);
  checkStreamingError(chunkRecord, parsedData);

  // Extract usage information
  if (chunk.usage) {
    state.streamingUsage = chunk.usage;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  const choice = chunk.choices?.[0];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  if (choice == null) return;

  processReasoningDelta(choice, state, deps);

  // Check for finish_reason
  if (choice.finish_reason) {
    state.lastFinishReason = choice.finish_reason;
    deps.logger.debug(
      () => `[Streaming] Stream finished with reason: ${choice.finish_reason}`,
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    choice.delta?.content as unknown,
  );
  if (rawDeltaContent) {
    const deltaContent = sanitizeProviderText(rawDeltaContent);
    if (!deltaContent) {
      return;
    }
    yield* handleTextDelta(
      deltaContent,
      state,
      shouldBufferText,
      detectedFormat,
      model,
      deps,
    );
  }

  processDeltaToolCalls(choice, deps);
}

/**
 * Handle errors from the streaming loop, including cancellation and Cerebras/Qwen bugs.
 */
function handleStreamError(
  error: unknown,
  abortSignal: AbortSignal | undefined,
  model: string,
  deps: StreamProcessorDeps,
): never {
  if (isCancellation(error, abortSignal)) {
    deps.logger.debug(
      () =>
        `Pipeline streaming response cancelled by AbortSignal (error: ${error instanceof Error ? error.name : 'unknown'})`,
    );
    throw error;
  }
  // Special handling for Cerebras/Qwen errors
  const errorMessage = String(error);
  const baseURL = deps.getBaseURL();
  if (
    errorMessage.includes('Tool is not present in the tools list') &&
    (model.toLowerCase().includes('qwen') ||
      baseURL?.includes('cerebras') === true)
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

/**
 * Build pipeline tool-call blocks from the cached pipeline result.
 */
function buildPipelineToolCallBlocks(
  state: StreamingState,
  deps: StreamProcessorDeps,
): ToolCallBlock[] {
  const result = state.cachedPipelineResult;
  if (!result) return [];
  const blocks: ToolCallBlock[] = [];
  if (result.normalized.length > 0 || result.failed.length > 0) {
    for (const normalizedCall of result.normalized) {
      const sanitizedArgs = sanitizeToolArgumentsString(
        normalizedCall.originalArgs ?? normalizedCall.args,
        deps.logger,
      );

      const processedParameters = processToolParameters(
        sanitizedArgs,
        normalizedCall.name,
      );

      blocks.push({
        type: 'tool_call',
        id: normalizeToHistoryToolId(
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string ID should use fallback
          normalizedCall.id || `call_${normalizedCall.index}`,
        ),
        name: normalizedCall.name,
        parameters: processedParameters,
      });
    }

    for (const failed of result.failed) {
      deps.logger.warn(
        `Tool call validation failed for index ${failed.index}: ${failed.validationErrors.join(', ')}`,
      );
    }
  }
  return blocks;
}

/**
 * Emit combined terminal content with reasoning blocks and pipeline tool calls.
 */
function* emitCombinedTerminalContent(
  state: StreamingState,
  model: string,
  deps: StreamProcessorDeps,
): Generator<IContent, void, unknown> {
  const { cleanedText: cleanedReasoning, toolCalls: reasoningToolCalls } =
    state.accumulatedReasoningContent.length > 0
      ? extractKimiToolCallsFromText(
          state.accumulatedReasoningContent,
          deps.logger,
        )
      : { cleanedText: '', toolCalls: [] as ToolCallBlock[] };

  const pipelineToolCallBlocks = buildPipelineToolCallBlocks(state, deps);

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

    if (state.streamingUsage !== null) {
      combinedContent.metadata = buildUsageMetadata(
        state.streamingUsage,
        stopReason,
      );
    } else if (stopReason) {
      combinedContent.metadata = { stopReason };
    }

    applyTerminalMetadata(combinedContent, state);

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

/**
 * Emit terminal chunks (combined, usage-only, finish-only) after stream ends.
 */
function* emitTerminalChunks(
  state: StreamingState,
  model: string,
  deps: StreamProcessorDeps,
): Generator<IContent, void, unknown> {
  yield* emitCombinedTerminalContent(state, model, deps);
  yield* emitUsageOnlyMetadata(
    state,
    model,
    deps.logger,
    () => deps.toolCallPipeline.getStats().collector.totalCalls,
  );
  yield* emitFinishOnlyMetadata(
    state,
    model,
    deps.logger,
    () => deps.toolCallPipeline.getStats().collector.totalCalls,
  );
}

/**
 * Handle the case where tool calls arrived but no text — request continuation.
 */
async function* handleToolCallsWithoutText(
  state: StreamingState,
  model: string,
  baseURL: string | undefined,
  requestBody: OpenAI.Chat.ChatCompletionCreateParams,
  messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  client: OpenAI,
  abortSignal: AbortSignal | undefined,
  mergedHeaders: Record<string, string> | undefined,
  detectedFormat: string,
  deps: StreamProcessorDeps,
  requestContinuation: (
    toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>,
    messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    requestBody: OpenAI.Chat.ChatCompletionCreateParams,
    client: OpenAI,
    abortSignal: AbortSignal | undefined,
    model: string,
    logger: DebugLogger,
    mergedHeaders: Record<string, string> | undefined,
    toolFormat: ToolFormat,
  ) => AsyncGenerator<IContent, void, unknown>,
): AsyncGenerator<IContent, void, unknown> {
  const pipelineResult = state.cachedPipelineResult;
  const hasCachedPipelineResult = pipelineResult != null;
  const toolCallCount = hasCachedPipelineResult
    ? pipelineResult.normalized.length + pipelineResult.failed.length
    : 0;

  if (!hasToolsButNoTextContent(state, toolCallCount)) {
    logStreamCompletionSummary(
      state,
      toolCallCount,
      model,
      baseURL,
      deps.getBaseURL,
      deps.logger,
    );
    return;
  }

  deps.logger.log(
    () =>
      `[OpenAIProvider] Model returned tool calls but no text (finish_reason=stop). Requesting continuation for model '${model}'.`,
    {
      model,
      toolCallCount,
      baseURL: baseURL ?? deps.getBaseURL(),
    },
  );

  if (!hasCachedPipelineResult) {
    throw new Error(
      'Pipeline result not cached - this should not happen in pipeline mode',
    );
  }
  const toolCallsForHistory = buildToolCallsForHistory(
    pipelineResult,
    normalizeToOpenAIToolId,
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

/**
 * Finalize after stream: flush buffer, emit remaining thinking, process pipeline.
 */
async function* finalizeStreamingState(
  state: StreamingState,
  shouldBufferText: boolean,
  model: string,
  detectedFormat: string,
  abortSignal: AbortSignal | undefined,
  deps: StreamProcessorDeps,
): AsyncGenerator<IContent, void, unknown> {
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

  yield* emitTerminalChunks(state, model, deps);
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
  messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
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
    messagesWithSystem: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
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

  deps.toolCallPipeline.reset();

  try {
    // Process chunks inline as they arrive from the HTTP stream.
    // CRITICAL: Do NOT collect all chunks first — that blocks the entire pipeline,
    // prevents abort signal checks, and causes indefinite hangs. See #1846.
    for await (const chunk of response) {
      yield* processStreamingChunk(
        chunk,
        state,
        shouldBufferText,
        model,
        detectedFormat,
        abortSignal,
        deps,
      );
    }
  } catch (error) {
    handleStreamError(error, abortSignal, model, deps);
  }

  yield* finalizeStreamingState(
    state,
    shouldBufferText,
    model,
    detectedFormat,
    abortSignal,
    deps,
  );

  yield* handleToolCallsWithoutText(
    state,
    model,
    baseURL,
    requestBody,
    messagesWithSystem,
    client,
    abortSignal,
    mergedHeaders,
    detectedFormat,
    deps,
    requestContinuation,
  );
}
