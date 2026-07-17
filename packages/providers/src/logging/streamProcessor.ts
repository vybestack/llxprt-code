/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  extractChunkMetadata,
  hasTokenBearingOutput,
  extractSimpleContent,
} from './streamChunkUtils.js';
import type { AttemptRecorder } from './attemptRecorder.js';
import type { ProviderPerformanceTracker } from './ProviderPerformanceTracker.js';
import { type ResponseTokenCounts } from './telemetryEmitter.js';
import {
  type TokenCounts,
  extractTokenCountsFromTokenUsage,
} from './tokenCounts.js';
import {
  type AccumulableTokenCounts,
  accumulateTokenUsage,
} from './tokenAccumulator.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

export interface StreamAccumulatorState {
  streamedText: string;
  responseContent: string;
  chunkCount: number;
  firstChunkTime: number | null;
  lastChunkTime: number | null;
  latestTokenUsage: UsageStats | undefined;
  lastFinishReason: string | undefined;
}

export function createStreamAccumulatorState(): StreamAccumulatorState {
  return {
    streamedText: '',
    responseContent: '',
    chunkCount: 0,
    firstChunkTime: null,
    lastChunkTime: null,
    latestTokenUsage: undefined,
    lastFinishReason: undefined,
  };
}

function recordChunkToAttempt(
  currentAttemptId: string,
  isTokenBearing: boolean,
  chunkUsage: UsageStats | undefined,
  chunkText: string,
  lastFinishReason: string | undefined,
  recorder: AttemptRecorder,
): void {
  if (isTokenBearing) {
    recorder.recordTokenBearingChunk(
      currentAttemptId,
      chunkUsage,
      chunkText,
      lastFinishReason,
    );
    return;
  }
  if (chunkUsage !== undefined || lastFinishReason !== undefined) {
    recorder.recordMetadataUsage(
      currentAttemptId,
      chunkUsage,
      lastFinishReason,
    );
  }
}

export function resolveTokenCounts(
  latestTokenUsage: UsageStats | undefined,
  streamedText: string,
  debug: DebugLogger,
): ResponseTokenCounts {
  return latestTokenUsage
    ? extractTokenCountsFromTokenUsage(latestTokenUsage, debug)
    : {
        input_token_count: 0,
        output_token_count:
          streamedText.length > 0 ? estimateTokens(streamedText) : 0,
        cached_content_token_count: 0,
        thoughts_token_count: 0,
        tool_token_count: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: null,
      };
}

export function classifyTerminalStatus(error: unknown): 'aborted' | 'error' {
  if (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      (error as NodeJS.ErrnoException).code === 'ABORT_ERR')
  ) {
    return 'aborted';
  }
  return 'error';
}

export interface StreamProcessContext {
  readonly providerName: string;
  readonly debug: DebugLogger;
  readonly performanceTracker: ProviderPerformanceTracker;
}

export function processStreamChunk(
  chunk: IContent,
  acc: StreamAccumulatorState,
  startTime: number,
  recorder: AttemptRecorder,
): IContent {
  acc.chunkCount++;
  const isTokenBearing = hasTokenBearingOutput(chunk);
  if (isTokenBearing) {
    const now = performance.now() - startTime;
    acc.firstChunkTime ??= now;
    acc.lastChunkTime = now;
  }
  let chunkUsage: UsageStats | undefined;
  let chunkText = '';
  extractChunkMetadata(
    chunk,
    (usage) => {
      chunkUsage = usage;
      acc.latestTokenUsage = usage;
    },
    (reason) => {
      acc.lastFinishReason = reason;
    },
    true,
    (text) => {
      chunkText = text;
    },
  );
  const currentAttemptId = recorder.getCurrentAttemptId();
  if (currentAttemptId) {
    recordChunkToAttempt(
      currentAttemptId,
      isTokenBearing,
      chunkUsage,
      chunkText,
      acc.lastFinishReason,
      recorder,
    );
  }
  acc.streamedText += chunkText;
  return chunk;
}

export function processLoggedStreamChunk(
  chunk: IContent,
  acc: StreamAccumulatorState,
  startTime: number,
  recorder: AttemptRecorder,
): IContent {
  acc.chunkCount++;
  const isTokenBearing = hasTokenBearingOutput(chunk);
  if (isTokenBearing) {
    const now = performance.now() - startTime;
    acc.firstChunkTime ??= now;
    acc.lastChunkTime = now;
  }
  const content = extractSimpleContent(chunk);
  if (content) {
    acc.responseContent += content;
  }
  let chunkUsage: UsageStats | undefined;
  extractChunkMetadata(
    chunk,
    (usage) => {
      chunkUsage = usage;
      acc.latestTokenUsage = usage;
    },
    (reason) => {
      acc.lastFinishReason = reason;
    },
    false,
    () => {},
  );
  const currentAttemptId = recorder.getCurrentAttemptId();
  if (currentAttemptId) {
    recordChunkToAttempt(
      currentAttemptId,
      isTokenBearing,
      chunkUsage,
      content,
      acc.lastFinishReason,
      recorder,
    );
  }
  return chunk;
}

export async function* processStreamWithRecorderGen(
  config: Config | undefined,
  stream: AsyncIterableIterator<IContent>,
  modelName: string,
  _promptId: string,
  recorder: AttemptRecorder,
  ctx: StreamProcessContext,
): AsyncIterableIterator<IContent> {
  const startTime = performance.now();
  const acc = createStreamAccumulatorState();
  let finalized = false;

  try {
    for await (const chunk of stream) {
      yield processStreamChunk(chunk, acc, startTime, recorder);
    }

    const duration = performance.now() - startTime;
    const tokenCounts = resolveTokenCounts(
      acc.latestTokenUsage,
      acc.streamedText,
      ctx.debug,
    );
    if (acc.latestTokenUsage !== undefined) {
      accumulateTokenUsage(tokenCounts, config, ctx.providerName, ctx.debug);
    }
    const totalTokens =
      tokenCounts.input_token_count + tokenCounts.output_token_count;
    ctx.performanceTracker.recordCompletion(
      duration,
      acc.firstChunkTime,
      totalTokens,
      tokenCounts.output_token_count,
      acc.chunkCount,
      acc.lastChunkTime,
    );
    recorder.finalizeAttempt('success', modelName, acc.latestTokenUsage);
    finalized = true;
  } catch (error) {
    const duration = performance.now() - startTime;
    ctx.performanceTracker.recordError(
      duration,
      String(error),
      acc.firstChunkTime,
      acc.chunkCount,
    );
    // Accumulate partial token usage on stream errors so session totals
    // remain consistent with the old logResponse path.
    if (acc.latestTokenUsage !== undefined) {
      const partialTokenCounts = resolveTokenCounts(
        acc.latestTokenUsage,
        acc.streamedText,
        ctx.debug,
      );
      accumulateTokenUsage(
        partialTokenCounts,
        config,
        ctx.providerName,
        ctx.debug,
      );
    }
    const status = classifyTerminalStatus(error);
    recorder.finalizeAttempt(
      status,
      modelName,
      acc.latestTokenUsage,
      error instanceof Error ? error.message : String(error),
    );
    finalized = true;
    throw error;
  } finally {
    // Only finalize as 'aborted' when no terminal status was set (e.g.
    // external cancellation without an error). The recorder's
    // hasEmittedTerminal guard ensures no duplicate telemetry.
    if (!finalized) {
      recorder.finalizeAttempt('aborted', modelName, acc.latestTokenUsage);
    }
  }
}

/**
 * Handle the error path for logResponseStreamWithRecorderGen: write the
 * error log, record performance and partial tokens, finalize the attempt,
 * then re-throw.
 */
async function handleLoggedStreamError(
  error: unknown,
  startTime: number,
  promptId: string,
  modelName: string,
  acc: StreamAccumulatorState,
  recorder: AttemptRecorder,
  config: Config,
  ctx: StreamProcessContext,
  writeLog: (
    content: string,
    promptId: string,
    duration: number,
    success: boolean,
    error: unknown,
  ) => Promise<void>,
): Promise<never> {
  const errorTime = performance.now();
  // Wrap writeLog so its failure does not mask the original error or skip
  // performance tracking and attempt finalization.
  try {
    await writeLog('', promptId, errorTime - startTime, false, error);
  } catch (logError) {
    ctx.debug.warn(
      () =>
        `writeLog failed during error path: ${logError instanceof Error ? logError.message : String(logError)}`,
    );
  }
  ctx.performanceTracker.recordError(
    errorTime - startTime,
    String(error),
    acc.firstChunkTime,
    acc.chunkCount,
  );
  // Accumulate partial token usage on stream errors for session totals.
  if (acc.latestTokenUsage !== undefined) {
    const partialTokenCounts = resolveTokenCounts(
      acc.latestTokenUsage,
      acc.responseContent,
      ctx.debug,
    );
    accumulateTokenUsage(
      partialTokenCounts,
      config,
      ctx.providerName,
      ctx.debug,
    );
  }
  const status = classifyTerminalStatus(error);
  recorder.finalizeAttempt(
    status,
    modelName,
    acc.latestTokenUsage,
    error instanceof Error ? error.message : String(error),
  );
  throw error;
}

export async function* logResponseStreamWithRecorderGen(
  config: Config,
  stream: AsyncIterableIterator<IContent>,
  promptId: string,
  modelName: string,
  recorder: AttemptRecorder,
  ctx: StreamProcessContext,
  writeLog: (
    content: string,
    promptId: string,
    duration: number,
    success: boolean,
    error: unknown,
  ) => Promise<void>,
): AsyncIterableIterator<IContent> {
  const startTime = performance.now();
  const acc = createStreamAccumulatorState();
  let finalized = false;

  try {
    for await (const chunk of stream) {
      yield processLoggedStreamChunk(chunk, acc, startTime, recorder);
    }

    const duration = performance.now() - startTime;
    const tokenCounts = resolveTokenCounts(
      acc.latestTokenUsage,
      acc.responseContent,
      ctx.debug,
    );
    if (acc.latestTokenUsage !== undefined) {
      accumulateTokenUsage(tokenCounts, config, ctx.providerName, ctx.debug);
    }
    const perfTotalTokens =
      tokenCounts.input_token_count + tokenCounts.output_token_count;
    ctx.performanceTracker.recordCompletion(
      duration,
      acc.firstChunkTime,
      perfTotalTokens,
      tokenCounts.output_token_count,
      acc.chunkCount,
      acc.lastChunkTime,
    );
    recorder.finalizeAttempt('success', modelName, acc.latestTokenUsage);
    finalized = true;
    await writeLog(acc.responseContent, promptId, duration, true, undefined);
  } catch (error) {
    finalized = true;
    await handleLoggedStreamError(
      error,
      startTime,
      promptId,
      modelName,
      acc,
      recorder,
      config,
      ctx,
      writeLog,
    );
  } finally {
    if (!finalized) {
      recorder.finalizeAttempt('aborted', modelName, acc.latestTokenUsage);
    }
  }
}

export type { TokenCounts, AccumulableTokenCounts };
