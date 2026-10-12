/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  HistoryMutationResult,
  RecordingIntegration,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import { HistoryMutationService } from '@vybestack/llxprt-code-core';
import { captureRollbackFailure } from './sessionControlRollback.js';
import { restoreRecordedHistory } from './recordedHistoryPersistence.js';

export async function restoreOwnerTurns(
  turns: number,
  client: AgentClientContract,
  recording: SessionRecordingService,
  integration: RecordingIntegration | null,
  owner: object,
  resubscribe: () => Promise<Error | undefined>,
): Promise<HistoryMutationResult> {
  const history = await Array.fromAsync(client.getHistory());
  const result = await new HistoryMutationService().restore(
    history,
    turns,
    recording,
  );
  if (!result.ok) throw new Error(result.error);
  if (result.itemsRemoved > 0) {
    await commitRecordedHistoryMutation({
      result,
      history,
      client,
      recording,
      integration,
      owner,
      resubscribe,
    });
  }
  return result;
}

async function commitRecordedHistoryMutation(input: {
  readonly result: HistoryMutationResult;
  readonly history: readonly IContent[];
  readonly recording: SessionRecordingService;
  readonly client: AgentClientContract;
  readonly integration: RecordingIntegration | null;
  readonly owner: object;
  readonly resubscribe: () => Promise<Error | undefined>;
}): Promise<void> {
  const {
    result,
    history,
    recording,
    client,
    integration,
    owner,
    resubscribe,
  } = input;
  integration?.unsubscribeFromHistory();
  try {
    await client.resetChat();
    if (result.remainingHistory.length > 0) {
      await client.restoreHistory(result.remainingHistory, owner);
    }
    const resubscribeError = await resubscribe();
    if (resubscribeError !== undefined) throw resubscribeError;
  } catch (error: unknown) {
    const failures: unknown[] = [error];
    await captureRollbackFailure(failures, () => client.setHistory(history));
    await captureRollbackFailure(failures, () =>
      restoreRecordedHistory(
        recording,
        history.slice(result.remainingHistory.length),
      ),
    );
    const resubscribeError = await resubscribe();
    if (resubscribeError !== undefined) failures.push(resubscribeError);
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'History mutation, rollback, or recording resubscription failed',
      );
    }
    throw error;
  }
}
