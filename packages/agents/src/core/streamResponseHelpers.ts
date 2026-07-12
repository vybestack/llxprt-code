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
import type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { analyzeResponseOutcomeFromParts } from './googlePartHelpers.js';
import { isFunctionResponse } from '@vybestack/llxprt-code-core/utils/messageInspectors.js';
import { InvalidStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { isThoughtPart, type ThoughtPart } from './googlePartHelpers.js';
import { getResponseId, getResponsesStored } from './responseIdCarrier.js';
import {
  filterEagerlyRecordedToolResponses,
  type FilteredEagerToolResponses,
} from './agenticLoop/loopHelpers.js';
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

  logger.debug(
    () =>
      `[StreamProcessor] Tracking promptTokens from IContent: ${promptTokens}`,
  );
  compressionHandler.lastPromptTokenCount = promptTokens;
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
    const chunkOutcome = analyzeResponseOutcomeFromParts(outcomeParts);
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
    compressionHandler.lastPromptTokenCount =
      chunk.usageMetadata.promptTokenCount;
  }
  acc.allChunks.push(chunk);
}
type PreservedThoughtMetadataKey =
  | 'thoughtSignature'
  | 'llxprtSourceField'
  | 'llxprtThoughtIsHidden';

// Stream status is intentionally not preserved: it describes the current delta's
// lifecycle role, not accumulated block metadata.
const PRESERVED_THOUGHT_METADATA_KEYS = [
  'thoughtSignature',
  'llxprtSourceField',
  'llxprtThoughtIsHidden',
] as const satisfies readonly PreservedThoughtMetadataKey[];

function preserveIncomingUndefinedFields(
  previousThought: ThoughtPart,
  incomingThought: ThoughtPart,
): Partial<Pick<ThoughtPart, PreservedThoughtMetadataKey>> {
  return Object.fromEntries(
    PRESERVED_THOUGHT_METADATA_KEYS.filter(
      (key) =>
        incomingThought[key] === undefined &&
        previousThought[key] !== undefined,
    ).map((key) => [key, previousThought[key]]),
  ) as Partial<Pick<ThoughtPart, PreservedThoughtMetadataKey>>;
}

function mergeIncrementalThought(
  previousThought: ThoughtPart,
  incomingThought: ThoughtPart,
): ThoughtPart {
  return {
    ...previousThought,
    ...incomingThought,
    text: incomingThought.text ?? previousThought.text,
    thought: true,
    ...preserveIncomingUndefinedFields(previousThought, incomingThought),
  };
}

function mergeTextParts(lastPart: Part, part: Part): Part {
  return {
    ...lastPart,
    text: `${lastPart.text ?? ''}${part.text ?? ''}`,
  };
}

function consolidateTextPart(result: Part[], part: Part): void {
  if (result.length === 0) {
    result.push({ ...part });
    return;
  }

  const lastPart = result[result.length - 1];
  if (isValidNonThoughtTextPart(lastPart) && isValidNonThoughtTextPart(part)) {
    result[result.length - 1] = mergeTextParts(lastPart, part);
    return;
  }
  result.push({ ...part });
}

function consolidateThoughtPart(
  result: Part[],
  part: ThoughtPart,
  streamPartIndexes: Map<string, number>,
): void {
  const streamId = part.llxprtThoughtBlockId;
  if (streamId !== undefined) {
    const existingIndex = streamPartIndexes.get(streamId);
    if (existingIndex !== undefined) {
      const previousPart = result[existingIndex];
      if (isThoughtPart(previousPart)) {
        result[existingIndex] = mergeIncrementalThought(previousPart, part);
        return;
      }
      streamPartIndexes.delete(streamId);
    }
  }

  result.push({ ...part });
  if (streamId !== undefined) {
    streamPartIndexes.set(streamId, result.length - 1);
  }
}

/**
 * Consolidate adjacent text parts and stream-identified thinking updates.
 *
 * #1723: A provider-owned stream id represents exactly one thinking block
 * lifecycle, from its first delta through its complete event. While a lifecycle
 * is open, later events with the same stream id replace that block even when
 * text or other thinking blocks are interleaved. A provider must mint a fresh
 * stream id for each distinct thinking block; text-prefix similarity is not
 * identity and is intentionally ignored.
 */
export function consolidateTextParts(modelResponseParts: Part[]): Part[] {
  const result: Part[] = [];
  const streamPartIndexes = new Map<string, number>();

  for (const part of modelResponseParts) {
    if (isThoughtPart(part)) {
      consolidateThoughtPart(result, part, streamPartIndexes);
    } else {
      consolidateTextPart(result, part);
    }
  }

  return result;
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

interface UserInputFlags {
  readonly userInputWasArray?: boolean;
  readonly userInputWasFunctionResponse?: boolean;
}

export interface PreparedHistoryUserInput {
  readonly historyUserInput: Content | Content[];
  readonly filteredResults: readonly FilteredEagerToolResponses[];
  readonly userInputFlags: UserInputFlags | undefined;
}

export function prepareHistoryUserInput(
  userInput: Content | Content[],
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
  const allSingleUserInputPartsWereEagerlyRecorded =
    !Array.isArray(userInput) && filteredResults[0]?.content === null;

  return {
    historyUserInput: Array.isArray(userInput)
      ? filteredUserInput
      : (filteredResults[0]?.content ?? filteredUserInput),
    filteredResults,
    userInputFlags: allSingleUserInputPartsWereEagerlyRecorded
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
  userInput: Content | Content[];
  consolidatedParts: Part[];
  allChunks: GenerateContentResponse[];
  conversationManager: ConversationManager;
  historyService: HistoryService;
  compressionHandler: CompressionHandler;
  logger: DebugLogger;
  userInputFlags?: UserInputFlags;
}

/**
 * Record history with usage metadata and sync token counts.
 *
 * `actualPromptTokens` is typed `number | null` (never `undefined`), so only
 * the null check is needed — the `!== undefined` comparison was a dead check.
 */
function findLastChunkWithProviderMetadata(
  chunks: GenerateContentResponse[],
): GenerateContentResponse | undefined {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (
      getResponseId(chunk) !== undefined ||
      getResponsesStored(chunk) !== undefined
    ) {
      return chunk;
    }
  }
  return undefined;
}

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
    actualPromptTokens = streamingUsageMetadata.promptTokens;
  }

  const providerMetadataChunk = findLastChunkWithProviderMetadata(args.allChunks);
  const responseId = providerMetadataChunk
    ? (getResponseId(providerMetadataChunk) ?? null)
    : null;
  const responsesStored = providerMetadataChunk
    ? (getResponsesStored(providerMetadataChunk) ?? null)
    : null;

  args.conversationManager.recordHistory(
    args.userInput,
    modelOutput,
    undefined,
    streamingUsageMetadata,
    {
      ...args.userInputFlags,
      responseId,
      responsesStored,
    },
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
