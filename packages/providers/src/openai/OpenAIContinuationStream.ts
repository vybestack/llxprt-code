/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ChatContinuation,
  ContinuationBody,
} from './OpenAIChatContinuation.js';
import type { ContinuationToolCall } from './OpenAIRequestBuilder.js';
import { aiTextContent, continuationTexts } from './OpenAIStreamChunkText.js';

/** What the continuation request needs from the request that preceded it. */
export interface ContinuationStreamRequest {
  /** Builds the request that follows tool calls with no text. */
  readonly continuation: ChatContinuation;
  readonly client: OpenAI;
  readonly abortSignal: AbortSignal | undefined;
  readonly model: string;
  readonly logger: DebugLogger;
  readonly mergedHeaders: Record<string, string> | undefined;
  readonly reasoningFieldName: string | undefined;
  readonly onRawTokenDelta: (() => void) | undefined;
}

/**
 * Request continuation after tool calls when model returned no text.
 * This is a helper used when the model returns tool calls but no text.
 *
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @issue #584, #764 (CodeRabbit review)
 */
export async function* streamContinuationAfterToolCalls(
  toolCalls: ContinuationToolCall[],
  request: ContinuationStreamRequest,
): AsyncGenerator<IContent, void, unknown> {
  const {
    continuation,
    client,
    abortSignal,
    model,
    logger,
    mergedHeaders,
    reasoningFieldName,
    onRawTokenDelta,
  } = request;
  let body: ContinuationBody | undefined;

  // Make a continuation request (wrap in try-catch since tools were already yielded)
  try {
    const { executeSpooledStreamingChatRequest } = await import(
      './OpenAIApiExecution.js'
    );
    body = await continuation.build(toolCalls);
    const continuationResponse = await executeSpooledStreamingChatRequest(
      client,
      body.spool,
      abortSignal,
      mergedHeaders,
    );

    let accumulatedText = '';

    for await (const sanitizedText of continuationTexts(
      continuationResponse,
      abortSignal,
      logger,
      reasoningFieldName,
      onRawTokenDelta,
    )) {
      accumulatedText += sanitizedText;
      yield aiTextContent(sanitizedText);
    }

    logger.debug(
      () =>
        `[OpenAIProvider] Continuation request completed, received ${accumulatedText.length} chars`,
      {
        model,
        accumulatedTextLength: accumulatedText.length,
      },
    );
  } catch (continuationError) {
    // Tool calls were already successfully yielded, so log warning and continue
    logger.warn(
      () =>
        `[OpenAIProvider] Continuation request failed, but tool calls were already emitted: ${continuationError instanceof Error ? continuationError.message : String(continuationError)}`,
      {
        model,
        error: continuationError,
      },
    );
    // Don't re-throw - tool calls were already successful
  } finally {
    await body?.release();
  }
}
