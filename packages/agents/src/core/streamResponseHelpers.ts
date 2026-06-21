/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Pure response-processing helpers extracted from StreamProcessor.
 *
 * These functions accumulate streamed chunk metadata, consolidate text parts,
 * validate stream completion, and record history with usage metadata. They
 * take explicit params (no shared mutable state) so they can be unit-tested
 * in isolation.
 */

import type { Content, GenerateContentResponse, Part } from '@google/genai';
import { FinishReason } from '@google/genai';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { ConversationManager } from './ConversationManager.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  isValidResponse,
  isValidNonThoughtTextPart,
} from './MessageConverter.js';
import {
  filterHookRestrictedParts,
  getHookRestrictedFunctionCallsFromParts,
  filterHookRestrictedFunctionCalls,
  mergeHookRestrictedFunctionCalls,
  getHookRestrictedAllowedTools,
} from './hookToolRestrictions.js';
import { analyzeResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { isFunctionResponse } from '@vybestack/llxprt-code-core/utils/messageInspectors.js';
import {
  InvalidStreamError,
  isThoughtPart,
  type UsageMetadataWithCache,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/** Whether a finish reason is missing (null, undefined, or empty string). */
export function isMissingFinishReason(
  finishReason: FinishReason | null | undefined | '',
): boolean {
  return finishReason == null || finishReason === '';
}

/** Accumulator used while streaming chunks into a complete turn. */
export interface StreamAccumulator {
  modelResponseParts: Part[];
  outcome: ResponseOutcome;
  finishReason: FinishReason | undefined;
  allChunks: GenerateContentResponse[];
}

/** Create a fresh stream accumulator. */
export function createStreamAccumulator(): StreamAccumulator {
  return {
    modelResponseParts: [],
    outcome: {
      hasVisibleText: false,
      hasThinking: false,
      hasToolCalls: false,
      isActionable: false,
    },
    finishReason: undefined,
    allChunks: [],
  };
}

/**
 * Track prompt tokens from an IContent chunk's usage metadata.
 */
export function trackPromptTokens(
  iContent: IContent,
  compressionHandler: CompressionHandler,
  logger: DebugLogger,
): void {
  const promptTokens = iContent.metadata?.usage?.promptTokens;
  if (promptTokens === undefined) return;

  const cacheReads = iContent.metadata?.usage?.cache_read_input_tokens ?? 0;
  const cacheWrites =
    iContent.metadata?.usage?.cache_creation_input_tokens ?? 0;
  const combinedPromptTokens = promptTokens + cacheReads + cacheWrites;
  logger.debug(
    () =>
      `[StreamProcessor] Tracking promptTokens from IContent: ${combinedPromptTokens}`,
  );
  compressionHandler.lastPromptTokenCount = combinedPromptTokens;
}

/**
 * Accumulate metadata from a single streamed chunk into the accumulator.
 */
export function accumulateChunkMetadata(
  chunk: GenerateContentResponse,
  acc: StreamAccumulator,
  includeThoughts: boolean,
  logger: DebugLogger,
  compressionHandler: CompressionHandler,
): void {
  const candidateWithReason = chunk.candidates?.find(
    (c) => c.finishReason !== undefined,
  );
  if (candidateWithReason !== undefined)
    acc.finishReason = candidateWithReason.finishReason as FinishReason;

  const allowedTools = getHookRestrictedAllowedTools(chunk);
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  const effectiveParts = isValidResponse(chunk)
    ? filterHookRestrictedParts(parts, allowedTools)
    : [];
  const allowedPartCalls = getHookRestrictedFunctionCallsFromParts(
    effectiveParts,
    allowedTools,
  );
  const allowedMergedCalls = mergeHookRestrictedFunctionCalls(
    allowedPartCalls,
    filterHookRestrictedFunctionCalls(chunk.functionCalls ?? [], allowedTools),
  );
  const allowedTopLevelCallParts = allowedMergedCalls
    .slice(allowedPartCalls.length)
    .map((functionCall) => ({ functionCall }));
  const outcomeParts = [...effectiveParts, ...allowedTopLevelCallParts];

  if (outcomeParts.length > 0) {
    const chunkOutcome = analyzeResponseOutcome(outcomeParts);
    acc.outcome = {
      hasVisibleText: acc.outcome.hasVisibleText || chunkOutcome.hasVisibleText,
      hasThinking: acc.outcome.hasThinking || chunkOutcome.hasThinking,
      hasToolCalls: acc.outcome.hasToolCalls || chunkOutcome.hasToolCalls,
      isActionable: acc.outcome.isActionable || chunkOutcome.isActionable,
    };
    acc.modelResponseParts.push(
      ...(includeThoughts
        ? outcomeParts
        : outcomeParts.filter((p) => !isThoughtPart(p))),
    );
  }

  const chunkText = typeof chunk.text === 'string' ? chunk.text : '';
  logger.debug(() => `[stream:terminal] observed converted chunk`, {
    chunkFinishReason: candidateWithReason?.finishReason,
    partCount: effectiveParts.length,
    toolCallCount: allowedMergedCalls.length,
    textLength: chunkText.length,
    hasUsageMetadata: Boolean(chunk.usageMetadata),
  });

  if (chunk.usageMetadata?.promptTokenCount !== undefined) {
    const chunkUsage = chunk.usageMetadata as UsageMetadataWithCache;
    compressionHandler.lastPromptTokenCount =
      chunk.usageMetadata.promptTokenCount +
      (chunkUsage.cache_read_input_tokens ?? 0) +
      (chunkUsage.cache_creation_input_tokens ?? 0);
  }
  acc.allChunks.push(chunk);
}

/**
 * Consolidate adjacent text parts.
 *
 * The array index access can return `undefined` at runtime when the array
 * is empty (length-1 == -1), so `lastPart` is annotated `Part | undefined`.
 */
export function consolidateTextParts(modelResponseParts: Part[]): Part[] {
  const consolidatedParts: Part[] = [];
  for (const part of modelResponseParts) {
    const lastPart = consolidatedParts[consolidatedParts.length - 1] as
      | Part
      | undefined;
    if (
      lastPart?.text !== undefined &&
      isValidNonThoughtTextPart(lastPart) &&
      isValidNonThoughtTextPart(part)
    ) {
      lastPart.text += part.text;
    } else {
      consolidatedParts.push(part);
    }
  }
  return consolidatedParts;
}

/**
 * Extract response text from consolidated parts.
 */
export function extractResponseText(consolidatedParts: Part[]): string {
  return consolidatedParts
    .filter((part) => isValidNonThoughtTextPart(part))
    .map((part) => part.text)
    .join('')
    .trim();
}

/**
 * Throw the appropriate error for a missing/empty stream response.
 */
export function throwMissingResponseError(
  finishReason: FinishReason | undefined,
  hasTextResponse: boolean,
  validationContext: Record<string, unknown>,
  logger: DebugLogger,
): void {
  if (isMissingFinishReason(finishReason) && !hasTextResponse) {
    logger.warn(
      () =>
        `[stream:terminal] validation failed: missing finishReason and text`,
      validationContext,
    );
    throw new InvalidStreamError(
      'Model stream ended without a finish reason and no text response.',
      'NO_FINISH_REASON_NO_TEXT',
    );
  }
  logger.warn(
    () => `[stream:terminal] validation failed: empty response text`,
    validationContext,
  );
  throw new InvalidStreamError(
    'Model stream ended with empty response text.',
    'NO_RESPONSE_TEXT',
  );
}

/**
 * Validate stream completion and throw appropriate errors.
 */
export function validateStreamCompletion(
  userInput: Content | Content[],
  outcome: ResponseOutcome,
  finishReason: FinishReason | undefined,
  responseText: string,
  logger: DebugLogger,
): void {
  const isToolContinuationInput = Array.isArray(userInput)
    ? userInput.some(isFunctionResponse)
    : isFunctionResponse(userInput);

  const validationContext = {
    hasToolCall: outcome.hasToolCalls,
    hasTextResponse: outcome.hasVisibleText,
    hasThinkingResponse: outcome.hasThinking,
    finishReason,
    responseTextLength: responseText.length,
    isToolContinuationInput,
  };

  logger.debug(
    () => `[stream:terminal] validating converted stream completion`,
    validationContext,
  );

  const hasMissingFinishAndNoText =
    isMissingFinishReason(finishReason) && !outcome.hasVisibleText;
  const isEmptyResponse = responseText === '';
  const noRelevantContent =
    !outcome.hasToolCalls && !isToolContinuationInput && !outcome.hasThinking;
  const isInvalidResponse =
    noRelevantContent && (hasMissingFinishAndNoText || isEmptyResponse);

  if (isInvalidResponse) {
    throwMissingResponseError(
      finishReason,
      outcome.hasVisibleText,
      validationContext,
      logger,
    );
  }

  if (finishReason === FinishReason.MALFORMED_FUNCTION_CALL) {
    logger.warn(
      () =>
        `[stream:terminal] validation failed: malformed function call finishReason`,
      validationContext,
    );
    throw new InvalidStreamError(
      'Model stream ended with malformed function call.',
      'MALFORMED_FUNCTION_CALL',
    );
  }
}

interface RecordHistoryParams {
  userInput: Content | Content[];
  consolidatedParts: Part[];
  allChunks: GenerateContentResponse[];
  conversationManager: ConversationManager;
  historyService: HistoryService;
  compressionHandler: CompressionHandler;
  logger: DebugLogger;
}

/**
 * Record history with usage metadata and sync token counts.
 *
 * `actualPromptTokens` is typed `number | null` (never `undefined`), so only
 * the null check is needed — the `!== undefined` comparison was a dead check.
 */
export async function recordHistoryWithUsage(
  args: RecordHistoryParams,
): Promise<void> {
  const modelOutput: Content[] = [
    { role: 'model', parts: args.consolidatedParts },
  ];

  let streamingUsageMetadata: UsageStats | null = null;
  let actualPromptTokens: number | null = null;
  const lastChunkWithMetadata = args.allChunks
    .slice()
    .reverse()
    .find((chunk) => chunk.usageMetadata);
  if (lastChunkWithMetadata?.usageMetadata) {
    streamingUsageMetadata = {
      promptTokens: lastChunkWithMetadata.usageMetadata.promptTokenCount ?? 0,
      completionTokens:
        lastChunkWithMetadata.usageMetadata.candidatesTokenCount ?? 0,
      totalTokens: lastChunkWithMetadata.usageMetadata.totalTokenCount ?? 0,
    };
    const usageMetadata =
      lastChunkWithMetadata.usageMetadata as UsageMetadataWithCache;
    const cacheReads = usageMetadata.cache_read_input_tokens ?? 0;
    const cacheWrites = usageMetadata.cache_creation_input_tokens ?? 0;
    actualPromptTokens =
      streamingUsageMetadata.promptTokens + cacheReads + cacheWrites;
  }

  args.conversationManager.recordHistory(
    args.userInput,
    modelOutput,
    undefined,
    streamingUsageMetadata,
  );

  await args.historyService.waitForTokenUpdates();

  if (actualPromptTokens !== null) {
    if (actualPromptTokens > 0) {
      args.logger.debug(
        () =>
          `[StreamProcessor] Syncing prompt token count to HistoryService: ${actualPromptTokens}`,
      );
      args.historyService.syncTotalTokens(actualPromptTokens);
      await args.historyService.waitForTokenUpdates();
    }
    return;
  }

  const fallbackTokens = args.compressionHandler.lastPromptTokenCount;
  if (fallbackTokens !== null) {
    if (fallbackTokens > 0) {
      args.logger.debug(
        () =>
          `[StreamProcessor] Syncing prompt token count to HistoryService: ${fallbackTokens}`,
      );
      args.historyService.syncTotalTokens(fallbackTokens);
      await args.historyService.waitForTokenUpdates();
    }
    return;
  }

  args.logger.debug(
    () =>
      `[StreamProcessor] No token count to sync (lastPromptTokenCount: ${fallbackTokens})`,
  );
}
