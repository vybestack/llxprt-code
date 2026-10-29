/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { IContent } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { MediaAdmissionPort } from './runtimePorts.js';
import type { ConversationManager } from './ConversationManager.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import type { PreparedUserTurn } from './mediaAdmissionSeam.js';
import type { StreamTerminalState } from './streamTerminalState.js';
import { validateStreamCompletion } from './streamValidationHelpers.js';
import { settleStreamUsage } from './streamUsageSettlement.js';
import {
  clearMatchedEagerToolResponseCallIds,
  prepareHistoryUserInput,
} from './streamResponseHelpers.js';

interface FinalizeStreamResponseOptions {
  readonly arrival?: ResponseArrival;
  readonly origin?: object;
  readonly logger: DebugLogger;
  readonly conversationManager: ConversationManager;
  readonly historyService: HistoryService;
  readonly compressionHandler: CompressionHandler;
  readonly mediaAdmission: MediaAdmissionPort | undefined;
  readonly terminal: StreamTerminalState;
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
): Promise<void> {
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
): Promise<void> {
  const { terminal, arrival } = options;
  if (arrival === undefined) throw new Error('Missing response arrival');
  const prepared = prepareHistoryUserInput(
    options.userInput,
    options.eagerlyRecordedToolResponseCallIds,
  );
  try {
    await options.conversationManager.recordHistory(
      [],
      [],
      undefined,
      terminal.usage,
      { ...prepared.userInputFlags, responseAlreadyRecorded: true },
      undefined,
      options.origin,
    );
    await arrival.seal(terminal.metadata());
    await settleStreamUsage(
      options.historyService,
      options.logger,
      terminal.usage?.promptTokens ?? null,
      options.compressionHandler.lastPromptTokenCount,
      () => settlePublishedStreamAdmissions(options),
    );
  } finally {
    clearMatchedEagerToolResponseCallIds(
      prepared.filteredResults,
      options.eagerlyRecordedToolResponseCallIds,
    );
  }
}

export async function finalizeStreamResponse(
  options: FinalizeStreamResponseOptions,
): Promise<void> {
  const terminal = options.terminal;
  options.logger.debug(() => '[stream:terminal] finalized journal response', {
    finishReason: terminal.finishReason,
    ...terminal.outcome,
    responseTextLength: terminal.responseTextLength,
  });
  validateStreamCompletion(
    options.logger,
    options.userInput,
    terminal.outcome,
    terminal.finishReason,
    terminal.responseTextLength,
    terminal.rawStopReason,
  );
  await options.semanticMediaPurge?.complete({
    status: 'success',
    usage: terminal.usage,
    cacheWriteEvidence: terminal.semanticMediaPurgeCacheWriteEvidence,
    retryHandoff: options.retryHandoff,
  });
  await commitFinalizedStreamHistory(options);
  await options.semanticMediaPurge?.finalize();
}
