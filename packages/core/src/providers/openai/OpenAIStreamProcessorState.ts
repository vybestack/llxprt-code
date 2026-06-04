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
import { type IContent } from '../../services/history/IContent.js';
import { type ToolCallPipeline } from './ToolCallPipeline.js';
import { extractCacheMetrics } from '../utils/cacheMetricsExtractor.js';
import { mapFinishReasonToStopReason } from './finishReasonMapping.js';

/**
 * Mutable state accumulated during streaming response processing.
 */
export interface StreamingState {
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

/**
 * Create an initial empty streaming state.
 */
export function createStreamingState(): StreamingState {
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

/**
 * Check if text buffer ends with a sentence-ending pattern.
 */
export function endsWithSentence(text: string): boolean {
  return text.endsWith('. ') || text.endsWith('! ') || text.endsWith('? ');
}

/**
 * Check if the text buffer has reached a natural break point for flushing.
 */
export function hasNaturalBreakPoint(
  textBuffer: string,
  hasOpenKimiSection: boolean,
): boolean {
  if (hasOpenKimiSection) {
    return false;
  }
  return (
    textBuffer.includes('\n') ||
    endsWithSentence(textBuffer) ||
    textBuffer.length > 100
  );
}

/**
 * Check if an error object is an AbortError.
 */
export function isAbortError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  if (typeof error !== 'object') {
    return false;
  }
  const err = error as Record<string, unknown>;
  return err.name === 'AbortError';
}

/**
 * Check if an error or abort signal indicates cancellation.
 */
export function isCancellation(
  error: unknown,
  abortSignal: AbortSignal | undefined,
): boolean {
  if (abortSignal?.aborted === true) {
    return true;
  }
  return isAbortError(error);
}

/**
 * Check if all content fields in state are empty.
 */
export function hasEmptyContentFields(state: StreamingState): boolean {
  return (
    state.accumulatedText.length === 0 &&
    state.textBuffer.length === 0 &&
    state.accumulatedReasoningContent.length === 0 &&
    state.accumulatedThinkingContent.length === 0
  );
}

/**
 * Check if all content fields are empty (no text or thinking content received).
 */
export function hasNoContent(
  state: StreamingState,
  toolCallCount: number,
): boolean {
  return hasEmptyContentFields(state) && toolCallCount === 0;
}

/**
 * Check if the response has tool calls but no text content.
 */
export function hasToolsButNoTextContent(
  state: StreamingState,
  toolCallCount: number,
): boolean {
  return (
    state.lastFinishReason === 'stop' &&
    toolCallCount > 0 &&
    hasEmptyContentFields(state)
  );
}

/**
 * Build troubleshooting message for empty streaming responses.
 */
export function buildEmptyResponseTroubleshooting(
  isKimi: boolean,
  isSynthetic: boolean,
): string {
  if (!isKimi) {
    return ' Consider using streaming: "disabled" in your profile settings.';
  }
  if (isSynthetic) {
    return ' To fix: use streaming: "disabled" in your profile settings. Synthetic API streaming does not work reliably with tool calls.';
  }
  return ' This provider may not support streaming with tool calls.';
}

/**
 * Check a streaming chunk for error events and throw if found.
 */
export function checkStreamingError(
  chunkRecord: Record<string, unknown>,
  parsedData: Record<string, unknown> | undefined,
): void {
  const streamingError = getStreamingError(chunkRecord, parsedData);
  const streamingEvent = getStreamingEvent(chunkRecord, parsedData);

  if (!isStreamingErrorEvent(streamingEvent, streamingError)) {
    return;
  }

  const errorMessage =
    getStreamingErrorMessage(streamingError, parsedData) ??
    (typeof streamingError === 'string'
      ? streamingError
      : 'Streaming response reported an error.');
  throw new Error(errorMessage);
}

function getStreamingError(
  chunkRecord: Record<string, unknown>,
  parsedData: Record<string, unknown> | undefined,
): unknown {
  return (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    chunkRecord?.error ??
    parsedData?.error ??
    (parsedData?.data as { error?: unknown } | undefined)?.error
  );
}

function getStreamingEvent(
  chunkRecord: Record<string, unknown>,
  parsedData: Record<string, unknown> | undefined,
): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  return (chunkRecord?.event ?? parsedData?.event) as string | undefined;
}

function getStreamingErrorMessage(
  streamingError: unknown,
  parsedData: Record<string, unknown> | undefined,
): string | undefined {
  return (
    (streamingError as { message?: string } | undefined)?.message ??
    (streamingError as { error?: string } | undefined)?.error ??
    (parsedData as { message?: string } | undefined)?.message
  );
}

function isStreamingErrorEvent(
  streamingEvent: string | undefined,
  streamingError: unknown,
): boolean {
  return (
    streamingEvent === 'error' ||
    (streamingError !== null &&
      streamingError !== undefined &&
      typeof streamingError === 'object')
  );
}

/**
 * Parse raw data from a streaming chunk record.
 */
export function parseChunkData(
  chunkRecord: Record<string, unknown>,
): Record<string, unknown> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
  const rawData = chunkRecord?.data;
  if (typeof rawData === 'string') {
    try {
      return JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  if (
    rawData !== null &&
    rawData !== undefined &&
    typeof rawData === 'object'
  ) {
    return rawData as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Build usage metadata from streaming usage data.
 */
export function buildUsageMetadata(
  streamingUsage: NonNullable<StreamingState['streamingUsage']>,
  stopReason: string | undefined,
): IContent['metadata'] {
  const cacheMetrics = extractCacheMetrics(streamingUsage);
  const promptTokensVal = streamingUsage.prompt_tokens;
  const completionTokensVal = streamingUsage.completion_tokens;
  const promptTokens =
    promptTokensVal === undefined || Number.isNaN(promptTokensVal)
      ? 0
      : promptTokensVal;
  const completionTokens =
    completionTokensVal === undefined || Number.isNaN(completionTokensVal)
      ? 0
      : completionTokensVal;
  const totalTokensVal = streamingUsage.total_tokens;
  const totalTokens =
    totalTokensVal === undefined ||
    totalTokensVal === 0 ||
    Number.isNaN(totalTokensVal)
      ? promptTokens + completionTokens
      : totalTokensVal;
  return {
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: cacheMetrics.cachedTokens,
      cacheCreationTokens: cacheMetrics.cacheCreationTokens,
      cacheMissTokens: cacheMetrics.cacheMissTokens,
    },
    ...(stopReason && { stopReason }),
  };
}

/**
 * Apply terminal finish-reason metadata to a content object (issue #1844).
 */
export function applyTerminalMetadata(
  content: IContent,
  state: StreamingState,
): void {
  if (state.lastFinishReason) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional metadata initialization
    if (!content.metadata) {
      content.metadata = {};
    }
    // stopReason was already set to the normalized value; do NOT
    // overwrite it with the raw provider string.
    content.metadata.finishReason = state.lastFinishReason;
    state.hasEmittedTerminalMetadata = true;
  }
}

/**
 * Build the continuation tool-call list from the cached pipeline result.
 */
export function buildToolCallsForHistory(
  pipelineResult: NonNullable<StreamingState['cachedPipelineResult']>,
  normalizeToOpenAIToolId: (id: string) => string,
): Array<{
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}> {
  return pipelineResult.normalized.map((normalizedCall, index) => ({
    id:
      normalizedCall.id && normalizedCall.id.trim().length > 0
        ? normalizeToOpenAIToolId(normalizedCall.id)
        : `call_${index}`,
    type: 'function' as const,
    function: {
      name: normalizedCall.name,
      arguments: JSON.stringify(normalizedCall.args),
    },
  }));
}

/**
 * Log summary of empty/non-empty streaming response.
 */
export function logStreamCompletionSummary(
  state: StreamingState,
  toolCallCount: number,
  model: string,
  baseURL: string | undefined,
  getBaseURL: () => string | undefined,
  logger: {
    warn: (cb: () => string, meta?: object) => void;
    debug: (cb: () => string, meta?: object) => void;
  },
): void {
  if (hasNoContent(state, toolCallCount)) {
    const isKimi = model.toLowerCase().includes('kimi');
    const isSynthetic =
      (baseURL ?? getBaseURL())?.includes('synthetic') ?? false;
    const troubleshooting = buildEmptyResponseTroubleshooting(
      isKimi,
      isSynthetic,
    );

    logger.warn(
      () =>
        `[OpenAIProvider] Empty streaming response for model '${model}' (received ${state.allChunks.length} chunks with no content).${troubleshooting}`,
      {
        model,
        baseURL: baseURL ?? getBaseURL(),
        isKimiModel: isKimi,
        isSyntheticAPI: isSynthetic,
        totalChunksReceived: state.allChunks.length,
      },
    );
  } else {
    logger.debug(
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

/**
 * Emit finish-only metadata chunk.
 */
export function* emitFinishOnlyMetadata(
  state: StreamingState,
  model: string,
  logger: { debug: (cb: () => string, meta?: object) => void },
  getToolCallCount: () => number,
): Generator<IContent, void, unknown> {
  if (
    state.lastFinishReason &&
    !state.streamingUsage &&
    !state.hasEmittedTerminalMetadata &&
    getToolCallCount() === 0
  ) {
    state.hasEmittedTerminalMetadata = true;
    const normalizedStopReason = mapFinishReasonToStopReason(
      state.lastFinishReason,
    );
    logger.debug(
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
    logger.debug(
      () => `[stream:terminal] skipped metadata-only terminal chunk`,
      {
        model,
        finishReason: state.lastFinishReason,
        hasEmittedTerminalMetadata: state.hasEmittedTerminalMetadata,
        toolCallCount: getToolCallCount(),
      },
    );
  }
}

/**
 * Emit usage-only metadata chunk when there's no content.
 */
export function* emitUsageOnlyMetadata(
  state: StreamingState,
  model: string,
  logger: { debug: (cb: () => string, meta?: object) => void },
  getToolCallCount: () => number,
): Generator<IContent, void, unknown> {
  if (
    state.streamingUsage !== null &&
    state.accumulatedReasoningContent.length === 0 &&
    getToolCallCount() === 0
  ) {
    const stopReason = mapFinishReasonToStopReason(state.lastFinishReason);
    const metaOnlyContent: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: buildUsageMetadata(state.streamingUsage, stopReason),
    };

    // Propagate terminal metadata on usage-only chunk (issue #1844).
    if (state.lastFinishReason && metaOnlyContent.metadata) {
      metaOnlyContent.metadata.finishReason = state.lastFinishReason;
      state.hasEmittedTerminalMetadata = true;
    }

    logger.debug(
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
    logger.debug(
      () => `[stream:terminal] skipped usage-only terminal metadata chunk`,
      {
        model,
        reasoningLength: state.accumulatedReasoningContent.length,
        toolCallCount: getToolCallCount(),
        hasEmittedTerminalMetadata: state.hasEmittedTerminalMetadata,
      },
    );
  }
}
