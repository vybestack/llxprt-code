/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type {
  IContent,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { ConversationManager } from './ConversationManager.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import type { PreparedUserTurn } from './mediaAdmissionSeam.js';
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
  readonly logger: DebugLogger;
  readonly conversationManager: ConversationManager;
  readonly historyService: HistoryService;
  readonly compressionHandler: CompressionHandler;
  readonly runtimeContext: AgentRuntimeContext;
  readonly accumulated: ModelOutput;
  readonly userInput: IContent | IContent[];
  readonly includeThoughts: boolean;
  readonly semanticMediaPurge: SemanticMediaPurgeAttempt | undefined;
  readonly retryHandoff: boolean;
  readonly eagerlyRecordedToolResponseCallIds: Set<string>;
  readonly preparedUserTurn: PreparedUserTurn | undefined;
  readonly mediaAdmissions: readonly MediaAdmissionRelease[];
}
async function settlePublishedStreamAdmissions(
  options: FinalizeStreamResponseOptions,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    await options.preparedUserTurn?.transferToHistory();
  } catch (error: unknown) {
    failures.push(error);
  }
  try {
    await options.runtimeContext.mediaAdmission?.releaseAdmissions(
      options.mediaAdmissions,
    );
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
      options.runtimeContext,
      preparedHistoryUserInput.historyUserInput,
      acc,
      historyOptions,
      () => settlePublishedStreamAdmissions(options),
    );
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

  await options.semanticMediaPurge?.complete({
    status: 'success',
    usage: acc.usage,
    cacheWriteEvidence: acc.semanticMediaPurgeCacheWriteEvidence,
    retryHandoff: options.retryHandoff,
  });

  await commitFinalizedStreamHistory(options, acc, preparedHistoryUserInput);
  options.semanticMediaPurge?.finalize();
}
