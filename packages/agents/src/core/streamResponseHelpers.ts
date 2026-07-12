/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Pure response-processing helpers extracted from StreamProcessor.
 *
 * These functions accumulate streamed chunk metadata, consolidate text blocks,
 * validate stream completion, and record history with usage metadata. They
 * take explicit params (no shared mutable state) so they can be unit-tested
 * in isolation.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 */

import type {
  IContent,
  ContentBlock,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ModelStreamChunk,
  CanonicalFinishReason,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { ConversationManager } from './ConversationManager.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { InvalidStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/** Whether a finish reason is missing (null, undefined, or empty string). */
export function isMissingFinishReason(
  finishReason: string | null | undefined | '',
): boolean {
  return finishReason == null || finishReason === '';
}

/**
 * Accumulator used while streaming chunks into a complete turn.
 *
 * Block-based (P15): carries `ContentBlock[]` and `CanonicalFinishReason`
 * from the neutral `ModelStreamChunk` — no Google-shaped `Part[]`/`FinishReason`.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
export interface StreamAccumulator {
  modelBlocks: ContentBlock[];
  outcome: ResponseOutcome;
  finishReason: CanonicalFinishReason | undefined;
  allChunks: ModelStreamChunk[];
}

/**
 * Create a fresh stream accumulator.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
export function createStreamAccumulator(): StreamAccumulator {
  return {
    modelBlocks: [],
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

  logger.debug(
    () =>
      `[StreamProcessor] Tracking promptTokens from IContent: ${promptTokens}`,
  );
  compressionHandler.lastPromptTokenCount = promptTokens;
}

/**
 * Analyze a `ContentBlock[]` for outcome characteristics (visible text,
 * thinking, tool calls, actionability).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
function analyzeBlocksOutcome(
  blocks: ContentBlock[],
  includeThoughts: boolean,
): ResponseOutcome {
  let hasVisibleText = false;
  let hasThinking = false;
  let hasToolCalls = false;
  for (const block of blocks) {
    if (block.type === 'text' && block.text !== '') {
      hasVisibleText = true;
    } else if (block.type === 'thinking' && includeThoughts) {
      hasThinking = true;
    } else if (block.type === 'tool_call') {
      hasToolCalls = true;
    }
  }
  return {
    hasVisibleText,
    hasThinking,
    hasToolCalls,
    isActionable: hasVisibleText || hasToolCalls,
  };
}

/**
 * Accumulate metadata from a single streamed neutral chunk into the
 * accumulator. Reads `ContentBlock[]` and `CanonicalFinishReason` from the
 * neutral `ModelStreamChunk` — no Google candidate/parts access.
 *
 * The legacy Google-response validity guard is replaced with a neutral
 * block-presence check on the `ModelStreamChunk`.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
export function accumulateChunkMetadata(
  chunk: ModelStreamChunk,
  acc: StreamAccumulator,
  includeThoughts: boolean,
  logger: DebugLogger,
  compressionHandler: CompressionHandler,
): void {
  if (chunk.finishReason !== undefined) {
    acc.finishReason = chunk.finishReason;
  }

  // Neutral block-presence check replaces the legacy response-validity guard.
  const effectiveBlocks =
    chunk.content.blocks.length > 0 ? chunk.content.blocks : [];

  if (effectiveBlocks.length > 0) {
    const chunkOutcome = analyzeBlocksOutcome(effectiveBlocks, includeThoughts);
    acc.outcome = {
      hasVisibleText: acc.outcome.hasVisibleText || chunkOutcome.hasVisibleText,
      hasThinking: acc.outcome.hasThinking || chunkOutcome.hasThinking,
      hasToolCalls: acc.outcome.hasToolCalls || chunkOutcome.hasToolCalls,
      isActionable: acc.outcome.isActionable || chunkOutcome.isActionable,
    };
    acc.modelBlocks.push(
      ...(includeThoughts
        ? effectiveBlocks
        : effectiveBlocks.filter((b) => b.type !== 'thinking')),
    );
  }

  const chunkText = effectiveBlocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
  logger.debug(() => `[stream:terminal] observed converted chunk`, {
    chunkFinishReason: chunk.finishReason,
    blockCount: effectiveBlocks.length,
    toolCallCount: effectiveBlocks.filter((b) => b.type === 'tool_call').length,
    textLength: chunkText.length,
    hasUsage: Boolean(chunk.usage),
  });

  if (chunk.usage?.promptTokens !== undefined) {
    compressionHandler.lastPromptTokenCount = chunk.usage.promptTokens;
  }
  acc.allChunks.push(chunk);
}

/**
 * Consolidate adjacent text blocks.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
export function consolidateTextBlocks(
  modelBlocks: ContentBlock[],
): ContentBlock[] {
  const consolidated: ContentBlock[] = [];
  for (const block of modelBlocks) {
    const lastBlock = consolidated[consolidated.length - 1];
    if (
      consolidated.length > 0 &&
      lastBlock.type === 'text' &&
      block.type === 'text'
    ) {
      (lastBlock as { text: string }).text += (block as { text: string }).text;
    } else {
      consolidated.push(block);
    }
  }
  return consolidated;
}

/**
 * Extract response text from consolidated blocks.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
export function extractResponseText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text' && block.text !== '')
    .map((block) => (block as { text: string }).text)
    .join('')
    .trim();
}

/**
 * Throw the appropriate error for a missing/empty stream response.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
export function throwMissingResponseError(
  finishReason: CanonicalFinishReason | undefined,
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
 *
 * Block-based reimplementation (P15): operates on neutral `IContent` and
 * `CanonicalFinishReason` — no Google-shaped `Content`/`FinishReason` enum.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
export function validateStreamCompletion(
  userInput: IContent | IContent[],
  outcome: ResponseOutcome,
  finishReason: CanonicalFinishReason | undefined,
  responseText: string,
  logger: DebugLogger,
): void {
  const inputArray = Array.isArray(userInput) ? userInput : [userInput];
  const isToolContinuationInput = inputArray.some((content) =>
    content.blocks.some((b) => b.type === 'tool_response'),
  );

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

  if (finishReason === 'error') {
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

interface UserInputFlags {
  readonly userInputWasArray?: boolean;
  readonly userInputWasFunctionResponse?: boolean;
}

export interface FilteredEagerToolResponses {
  readonly content: IContent | null;
  readonly matchedCallIds: readonly string[];
}

export interface PreparedHistoryUserInput {
  readonly historyUserInput: IContent | IContent[];
  readonly filteredResults: readonly FilteredEagerToolResponses[];
  readonly userInputFlags: UserInputFlags | undefined;
}

export function filterEagerlyRecordedToolResponses(
  content: IContent,
  eagerlyRecordedToolResponseCallIds: ReadonlySet<string>,
): FilteredEagerToolResponses {
  if (eagerlyRecordedToolResponseCallIds.size === 0) {
    return { content, matchedCallIds: [] };
  }

  const matchedCallIds: string[] = [];
  const blocks = content.blocks.filter((block) => {
    const callId = block.type === 'tool_response' ? block.callId : undefined;
    if (
      typeof callId === 'string' &&
      eagerlyRecordedToolResponseCallIds.has(callId)
    ) {
      matchedCallIds.push(callId);
      return false;
    }
    return true;
  });

  if (matchedCallIds.length === 0) {
    return { content, matchedCallIds };
  }
  if (blocks.length === 0) {
    return { content: null, matchedCallIds };
  }

  return {
    content: { ...content, blocks },
    matchedCallIds,
  };
}

export function prepareHistoryUserInput(
  userInput: IContent | IContent[],
  eagerlyRecordedToolResponseCallIds: ReadonlySet<string>,
): PreparedHistoryUserInput {
  const filteredResults = (
    Array.isArray(userInput) ? userInput : [userInput]
  ).map((content) =>
    filterEagerlyRecordedToolResponses(
      content,
      eagerlyRecordedToolResponseCallIds,
    ),
  );
  const filteredUserInput = filteredResults.flatMap(
    (result) => result.content ?? [],
  );
  const allSingleUserInputBlocksWereEagerlyRecorded =
    !Array.isArray(userInput) && filteredResults[0]?.content === null;

  return {
    historyUserInput: Array.isArray(userInput)
      ? filteredUserInput
      : (filteredResults[0]?.content ?? filteredUserInput),
    filteredResults,
    userInputFlags: allSingleUserInputBlocksWereEagerlyRecorded
      ? {
          // The filtered history input is now an empty array, so keep the shape
          // flags aligned with what ConversationManager will actually see.
          userInputWasArray: true,
          userInputWasFunctionResponse: true,
        }
      : undefined,
  };
}

export function clearMatchedEagerToolResponseCallIds(
  filteredResults: readonly FilteredEagerToolResponses[],
  eagerlyRecordedToolResponseCallIds: Set<string>,
): void {
  for (const result of filteredResults) {
    for (const callId of result.matchedCallIds) {
      eagerlyRecordedToolResponseCallIds.delete(callId);
    }
  }
}

interface RecordHistoryParams {
  userInput: IContent | IContent[];
  consolidatedBlocks: ContentBlock[];
  allChunks: ModelStreamChunk[];
  conversationManager: ConversationManager;
  historyService: HistoryService;
  compressionHandler: CompressionHandler;
  logger: DebugLogger;
  userInputFlags?: UserInputFlags;
}

/**
 * Record history with usage metadata and sync token counts.
 *
 * Block-based reimplementation (P15): records `IContent{speaker:'ai'}`
 * directly — no manual Google Content builder. Usage derived from the
 * neutral `UsageStats` on the `ModelStreamChunk`.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.3
 * @pseudocode lines 28-31
 */
export async function recordHistoryWithUsage(
  args: RecordHistoryParams,
): Promise<void> {
  const modelIContent: IContent = {
    speaker: 'ai',
    blocks: args.consolidatedBlocks,
  };

  let streamingUsageMetadata: UsageStats | null = null;
  let actualPromptTokens: number | null = null;
  const lastChunkWithUsage = args.allChunks
    .slice()
    .reverse()
    .find((chunk) => chunk.usage);
  if (lastChunkWithUsage?.usage) {
    streamingUsageMetadata = {
      promptTokens: lastChunkWithUsage.usage.promptTokens,
      completionTokens: lastChunkWithUsage.usage.completionTokens,
      totalTokens: lastChunkWithUsage.usage.totalTokens,
    };
    actualPromptTokens = streamingUsageMetadata.promptTokens;
  }

  args.conversationManager.recordHistory(
    args.userInput,
    [modelIContent],
    undefined,
    streamingUsageMetadata,
    args.userInputFlags,
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
