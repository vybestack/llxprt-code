/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { stampAiTurnModel } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  iContentFromBlocks,
  type ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';
import {
  admitModelOutputForHistory,
  releaseAdmissionsAfterError,
  type PreparedUserTurn,
} from './mediaAdmissionSeam.js';
import { syncAndRecordTurnUsage } from './tokenUsageActualLogger.js';

interface CommitTurnHistoryOptions {
  readonly runtimeContext: AgentRuntimeContext;
  readonly historyService: HistoryService;
  readonly compressionHandler: CompressionHandler;
  readonly response: ModelOutput;
  readonly preparedUserTurn: PreparedUserTurn;
  readonly promptId: string;
  readonly currentModel: string | undefined;
  readonly baseUrl: string | undefined;
  readonly lastPromptTokenCount: number | null;
  readonly attemptIndex: number;
  readonly eagerlyRecordedToolResponseCallIds: Set<string>;
}

function afcHistoryEntries(
  historyService: HistoryService,
  afcHistory: IContent[],
  currentModel: string | undefined,
  baseUrl: string | undefined,
): IContent[] {
  const index = historyService.getCurated().length;
  return afcHistory
    .slice(index)
    .map((content) => stampAiTurnModel(content, currentModel, baseUrl));
}

function outputHistoryEntries(
  options: CommitTurnHistoryOptions,
  response: ModelOutput,
): IContent[] {
  const outputContent = response.content;
  if (outputContent.blocks.length > 0) {
    const includeThoughts =
      options.runtimeContext.ephemerals.reasoning.includeInContext();
    const allowedTools = response.hookRestrictions?.allowedToolNames;
    const filteredBlocks = allowedTools
      ? filterHookRestrictedBlocks(outputContent.blocks, allowedTools)
      : outputContent.blocks;
    const contentForHistory = includeThoughts
      ? filteredBlocks
      : filteredBlocks.filter(
          (block: ContentBlock) => block.type !== 'thinking',
        );
    if (contentForHistory.length > 0) {
      return [
        stampAiTurnModel(
          iContentFromBlocks(contentForHistory, 'ai'),
          options.currentModel,
          options.baseUrl,
        ),
      ];
    }
  }
  return [];
}

async function settlePublishedMediaAdmissions(
  options: CommitTurnHistoryOptions,
  admissions: readonly MediaAdmissionRelease[],
): Promise<void> {
  const failures: unknown[] = [];
  try {
    await options.preparedUserTurn.transferToHistory();
  } catch (error: unknown) {
    failures.push(error);
  }
  try {
    await options.runtimeContext.mediaAdmission?.releaseAdmissions(admissions);
  } catch (error: unknown) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Committed turn media cleanup was incomplete',
    );
  }
}

export async function rollbackTurnHistory(
  historyService: HistoryService,
  historyBeforeTurn: IContent[],
  currentModel: string | undefined,
  primaryError: unknown,
): Promise<unknown> {
  try {
    await historyService.replaceAll(historyBeforeTurn, currentModel);
    return primaryError;
  } catch (rollbackError: unknown) {
    return new AggregateError(
      [primaryError, rollbackError],
      'Turn history commit failed and history rollback was incomplete',
    );
  }
}

export async function commitTurnHistory(
  options: CommitTurnHistoryOptions,
): Promise<void> {
  let admitted:
    | Awaited<ReturnType<typeof admitModelOutputForHistory>>
    | undefined;
  try {
    admitted = await admitModelOutputForHistory(
      options.runtimeContext,
      options.response,
      options.preparedUserTurn.turnId,
    );
    const inputEntries =
      admitted.afcHistory === undefined
        ? options.preparedUserTurn.userContents
        : afcHistoryEntries(
            options.historyService,
            admitted.afcHistory,
            options.currentModel,
            options.baseUrl,
          );
    const entries = [
      ...inputEntries,
      ...outputHistoryEntries(options, admitted.response),
    ];
    const mediaAdmissions = admitted.admissions;
    await options.historyService.addBatch(entries, options.currentModel, {
      afterPublication: async () => {
        await syncAndRecordTurnUsage({
          history: options.historyService,
          usageLogger: options.compressionHandler.tokenUsageLogger,
          usage: options.response.usage,
          lastPromptTokenCount: options.lastPromptTokenCount,
          attemptIndex: options.attemptIndex,
          promptId: options.promptId,
        });
        await settlePublishedMediaAdmissions(options, mediaAdmissions);
      },
    });
  } catch (error: unknown) {
    if (admitted === undefined) throw error;
    await releaseAdmissionsAfterError(
      options.runtimeContext,
      admitted.admissions,
      error,
      'Turn history commit failed and output media cleanup was incomplete',
    );
  } finally {
    options.eagerlyRecordedToolResponseCallIds.clear();
  }
}
