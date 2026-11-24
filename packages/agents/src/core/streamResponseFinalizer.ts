/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type {
  IContent,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type {
  MediaAdmissionPort,
  ReasoningInclusionPolicy,
} from './runtimePorts.js';
import type { ConversationManager } from './ConversationManager.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import type { PreparedUserTurn } from './mediaAdmissionSeam.js';
import type { SendRequestState } from './sendRequestState.js';
import {
  analyzeBlocksOutcome,
  extractResponseTextFromBlocks,
  recordHistoryWithUsage,
  validateStreamCompletion,
} from './streamValidationHelpers.js';
import {
  clearMatchedEagerToolResponseCallIds,
  consolidateTextBlocks,
  isMissingFinishReason,
  prepareHistoryUserInput,
} from './streamResponseHelpers.js';

interface FinalizeStreamResponseOptions {
  readonly origin?: object;
  /**
   * Aborts when the attempt is abandoned (a watchdog timeout, a cancellation).
   * An abandoned attempt publishes nothing: its purge and its answer are
   * fenced out before they reach history.
   */
  readonly attemptSignal?: AbortSignal;
  /**
   * Told when the answer reaches history, so a timeout that lands during the
   * cleanup after the commit does not make the turn send the request again.
   */
  readonly sendState?: SendRequestState;
  readonly logger: DebugLogger;
  readonly conversationManager: ConversationManager;
  readonly historyService: HistoryService;
  readonly compressionHandler: CompressionHandler;
  readonly mediaAdmission: MediaAdmissionPort | undefined;
  readonly reasoningInclusion: ReasoningInclusionPolicy;
  readonly accumulated: ModelOutput;
  readonly userInput: IContent | IContent[];
  readonly includeThoughts: boolean;
  readonly semanticMediaPurge: SemanticMediaPurgeAttempt | undefined;
  readonly retryHandoff: boolean;
  readonly eagerlyRecordedToolResponseCallIds: Set<string>;
  readonly preparedUserTurn: PreparedUserTurn | undefined;
  readonly mediaAdmissions: readonly MediaAdmissionRelease[];
}
export async function failStreamProcessing(
  error: unknown,
  admissions: readonly MediaAdmissionRelease[],
  mediaAdmission: MediaAdmissionPort | undefined,
): Promise<never> {
  try {
    await mediaAdmission?.releaseAdmissions(admissions);
  } catch (cleanupError: unknown) {
    throw new AggregateError(
      [error, cleanupError],
      'Stream processing failed and media cleanup was incomplete',
    );
  }
  throw error;
}

async function settlePublishedStreamAdmissions(
  options: FinalizeStreamResponseOptions,
  publication: object,
): Promise<void> {
  // Last point at which an abandoned attempt can still be rolled back: an
  // error here undoes the publication, anything later is a completed send.
  options.attemptSignal?.throwIfAborted();
  options.sendState?.markAnswerPublished(publication);
  const failures: unknown[] = [];
  try {
    await options.preparedUserTurn?.transferToHistory();
  } catch (error: unknown) {
    failures.push(error);
  }
  try {
    await options.mediaAdmission?.releaseAdmissions(options.mediaAdmissions);
  } catch (error: unknown) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Committed stream media cleanup was incomplete',
    );
  }
}

async function commitFinalizedStreamHistory(
  options: FinalizeStreamResponseOptions,
  acc: ModelOutput,
  preparedHistoryUserInput: ReturnType<typeof prepareHistoryUserInput>,
): Promise<void> {
  // Identifies this finalization's publication to the send's answer marker.
  const publication = {};
  const historyOptions = {
    ...preparedHistoryUserInput.userInputFlags,
    responseId: acc.responseId ?? acc.content.metadata?.id ?? null,
    responsesStored: acc.content.metadata?.responsesStored ?? null,
  };
  try {
    await recordHistoryWithUsage(
      options.logger,
      options.conversationManager,
      options.historyService,
      options.compressionHandler,
      options.reasoningInclusion,
      preparedHistoryUserInput.historyUserInput,
      acc,
      historyOptions,
      () => settlePublishedStreamAdmissions(options, publication),
      options.origin,
    );
  } catch (error: unknown) {
    // The history mutation was rolled back, so the marker must follow it, for
    // an abandoned attempt too: left set, no resend would answer the turn. Only
    // this finalization's own publication is revoked, never a replacement's.
    options.sendState?.markAnswerRevoked(publication);
    throw error;
  } finally {
    clearMatchedEagerToolResponseCallIds(
      preparedHistoryUserInput.filteredResults,
      options.eagerlyRecordedToolResponseCallIds,
    );
  }
}

export async function finalizeStreamResponse(
  options: FinalizeStreamResponseOptions,
): Promise<void> {
  const acc = options.accumulated;
  acc.content = {
    ...acc.content,
    blocks: consolidateTextBlocks(acc.content.blocks),
  };
  const finishReason = acc.finishReason;
  const responseText = extractResponseTextFromBlocks(acc.content.blocks);
  const outcome = analyzeBlocksOutcome(
    acc.content.blocks,
    options.includeThoughts,
  );

  if (isMissingFinishReason(finishReason)) {
    options.logger.debug(
      () =>
        `[stream:terminal] stream ended without finishReason (hasToolCall=${String(outcome.hasToolCalls)}, hasTextResponse=${String(outcome.hasVisibleText)}, hasThinkingResponse=${String(outcome.hasThinking)}, responseTextLength=${responseText.length})`,
    );
  } else {
    options.logger.debug(
      () => `[stream:terminal] finalized stream with finishReason`,
      {
        finishReason,
        hasToolCall: outcome.hasToolCalls,
        hasTextResponse: outcome.hasVisibleText,
        hasThinkingResponse: outcome.hasThinking,
        responseTextLength: responseText.length,
      },
    );
  }

  validateStreamCompletion(
    options.logger,
    options.userInput,
    outcome,
    finishReason,
    responseText,
    acc.rawStopReason,
  );

  const preparedHistoryUserInput = prepareHistoryUserInput(
    options.userInput,
    options.eagerlyRecordedToolResponseCallIds,
  );
  if (acc.afcHistory !== undefined) {
    acc.afcHistory = acc.afcHistory.filter(
      (content) => content.blocks.length > 0,
    );
  }

  options.attemptSignal?.throwIfAborted();
  await options.semanticMediaPurge?.complete({
    status: 'success',
    usage: acc.usage,
    cacheWriteEvidence: acc.semanticMediaPurgeCacheWriteEvidence,
    retryHandoff: options.retryHandoff,
  });

  await commitFinalizedStreamHistory(options, acc, preparedHistoryUserInput);
  options.semanticMediaPurge?.finalize();
}
