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

import crypto from 'node:crypto';

import { streamText } from 'ai';
import type { LanguageModel, LanguageModelUsage, ModelMessage } from 'ai';

import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type TextBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { wrapError } from './errors.js';

import type {
  ModelCallParams,
  ReasoningSettings,
  StreamingState,
} from './vercelStreamTypes.js';
import type { CaptureBuffer } from './vercelReasoningCapture.js';
import {
  emitRemainingStreamThinking,
  flushRemainingTextBuffer,
  isAbortError,
  processStreamPart,
} from './vercelStreamProcessor.js';
import { emitStreamToolCallsAndMetadata } from './vercelMetadataMapper.js';

type VercelTools = Record<string, unknown>;

export function createStreamingState(): StreamingState {
  return {
    textBuffer: '',
    accumulatedThinkingContent: '',
    hasEmittedThinking: false,
    collectedToolCalls: [],
    totalUsage: undefined,
    finishReason: undefined,
  };
}

/**
 * Invokes AI SDK streamText with the given options, wrapping errors.
 */
export function invokeStreamText(
  model: LanguageModel,
  systemPrompt: string,
  messages: ModelMessage[],
  aiTools: VercelTools | undefined,
  params: ModelCallParams,
  abortSignal: AbortSignal | undefined,
  logger: DebugLogger,
  providerName: string,
): ReturnType<typeof streamText> {
  const streamOptions: Record<string, unknown> = {
    model,
    system: systemPrompt,
    messages,
    tools: aiTools,
    maxOutputTokens: params.maxOutputTokens,
    temperature: params.temperature,
    topP: params.topP,
    presencePenalty: params.presencePenalty,
    frequencyPenalty: params.frequencyPenalty,
    stopSequences: params.stopSequences,
    seed: params.seed,
    maxRetries: params.maxRetries,
    abortSignal,
  };
  if (params.maxOutputTokens !== undefined) {
    streamOptions['maxTokens'] = params.maxOutputTokens;
  }
  try {
    return streamText(streamOptions as Parameters<typeof streamText>[0]);
  } catch (error) {
    logger.error(
      () =>
        `[OpenAIVercelProvider] streamText failed: ${error instanceof Error ? error.message : String(error)}`,
      { error },
    );
    throw wrapError(error, providerName);
  }
}

/**
 * Rethrows abort errors as-is, wraps all other errors.
 */
export function rethrowIfAbortSignal(
  error: unknown,
  abortSignal: AbortSignal | undefined,
  logger: DebugLogger,
  providerName: string,
): void {
  if (abortSignal?.aborted === true || isAbortError(error)) {
    logger.debug(
      () =>
        `[OpenAIVercelProvider] Streaming response cancelled by AbortSignal`,
    );
    throw error;
  }
  logger.error(
    () =>
      `[OpenAIVercelProvider] Error processing streaming response: ${error instanceof Error ? error.message : String(error)}`,
    { error },
  );
  throw wrapError(error, providerName);
}

function hasFullStream(result: unknown): boolean {
  return result != null && typeof result === 'object' && 'fullStream' in result;
}

async function* processFullStream(
  result: unknown,
  state: StreamingState,
  rs: ReasoningSettings,
  captureBuffer: CaptureBuffer,
  abortSignal: AbortSignal | undefined,
  logger: DebugLogger,
  providerName: string,
): AsyncIterableIterator<IContent> {
  try {
    for await (const part of (
      result as {
        fullStream: AsyncIterable<{
          type: string;
          text?: string;
          toolCallId?: string;
          toolName?: string;
          input?: unknown;
          totalUsage?: LanguageModelUsage;
          finishReason?: string;
          error?: unknown;
        }>;
      }
    ).fullStream) {
      if (abortSignal?.aborted === true) break;
      yield* processStreamPart(part, state, rs, logger);
    }
    yield* flushRemainingTextBuffer(state, logger);
    yield* emitRemainingStreamThinking(state, rs, captureBuffer, logger);
  } catch (error) {
    rethrowIfAbortSignal(error, abortSignal, logger, providerName);
  }
}

async function* consumeLegacyTextStream(
  textStream: AsyncIterable<string> | undefined,
): AsyncIterableIterator<IContent> {
  if (textStream == null) return;
  for await (const textChunk of textStream) {
    if (typeof textChunk !== 'string' || textChunk === '') continue;
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: textChunk } as TextBlock],
    } as IContent;
  }
}

async function* processLegacyStream(
  result: unknown,
  state: StreamingState,
  abortSignal: AbortSignal | undefined,
  logger: DebugLogger,
  providerName: string,
): AsyncIterableIterator<IContent> {
  const legacyStream = result as {
    textStream?: AsyncIterable<string>;
    toolCalls?: Promise<
      Array<{
        toolCallId?: string;
        toolName?: string;
        input?: unknown;
      }>
    >;
    usage?: Promise<LanguageModelUsage | undefined>;
    finishReason?: Promise<string | undefined>;
  };

  try {
    yield* consumeLegacyTextStream(legacyStream.textStream);
  } catch (error) {
    if (abortSignal?.aborted === true || isAbortError(error)) {
      throw error;
    }
    logger.error(
      () =>
        `[OpenAIVercelProvider] Legacy streaming response failed: ${error instanceof Error ? error.message : String(error)}`,
      { error },
    );
    throw wrapError(error, providerName);
  }

  const legacyToolCalls =
    legacyStream.toolCalls != null
      ? await legacyStream.toolCalls.catch(() => [])
      : [];
  for (const call of legacyToolCalls) {
    state.collectedToolCalls.push({
      toolCallId: String(call.toolCallId ?? crypto.randomUUID()),
      toolName: String(call.toolName ?? 'unknown_tool'),
      input: call.input,
    });
  }
  state.totalUsage =
    legacyStream.usage != null
      ? await legacyStream.usage.catch(() => undefined)
      : undefined;
  state.finishReason =
    legacyStream.finishReason != null
      ? await legacyStream.finishReason.catch(() => undefined)
      : undefined;
}

/**
 * Orchestrates a streaming response from the AI SDK, processing the full
 * stream or falling back to a legacy text stream.
 */
export async function* handleStreamingResponse(
  result: ReturnType<typeof streamText>,
  state: StreamingState,
  rs: ReasoningSettings,
  captureBuffer: CaptureBuffer,
  abortSignal: AbortSignal | undefined,
  logger: DebugLogger,
  providerName: string,
): AsyncIterableIterator<IContent> {
  const streamResult = result as unknown;
  if (
    hasFullStream(streamResult) &&
    (streamResult as { fullStream?: unknown }).fullStream != null
  ) {
    yield* processFullStream(
      streamResult,
      state,
      rs,
      captureBuffer,
      abortSignal,
      logger,
      providerName,
    );
  } else {
    yield* processLegacyStream(
      streamResult,
      state,
      abortSignal,
      logger,
      providerName,
    );
  }
  yield* emitStreamToolCallsAndMetadata(state, captureBuffer);
}
