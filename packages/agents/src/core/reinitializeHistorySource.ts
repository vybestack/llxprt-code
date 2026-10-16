/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { DeferredHistorySourceOptions } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { failureAfterDisposal } from './historyDisposalFailure.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ChatSession } from './chatSession.js';
import {
  prepareDeferredHistorySource,
  type DeferredHistoryDeps,
} from './deferredHistorySource.js';
import {
  releaseDeferredArray,
  type RetainedHistoryAdmission,
  type RetainedHistoryAdmissions,
} from './retainedHistoryAdmissions.js';

interface ReinitializePublication {
  readonly admissions: RetainedHistoryAdmissions;
  readonly priorAdmission: RetainedHistoryAdmission | undefined;
  readonly priorSource: (() => Promise<void>) | undefined;
  readonly publish: (candidate: {
    journal: HistoryService;
    release: () => Promise<void>;
  }) => void;
}

export async function transferReinitializedHistory(
  chat: ChatSession,
  deps: DeferredHistoryDeps,
  runtime: AgentRuntimeState,
  options: DeferredHistorySourceOptions,
  publication: ReinitializePublication,
): Promise<void> {
  options.signal?.throwIfAborted();
  await chat.waitForIdle();
  options.signal?.throwIfAborted();
  const candidate = await prepareDeferredHistorySource(
    chat.streamHistory(options.signal),
    deps,
    runtime,
    undefined,
    options,
  );
  try {
    options.signal?.throwIfAborted();
    await chat.clearHistory();
  } catch (error) {
    const failure = await failureAfterDisposal(candidate.journal, error);
    try {
      await candidate.release();
    } catch (cleanupError) {
      throw new AggregateError(
        [failure, cleanupError],
        'Active history transfer cleanup failed',
      );
    }
    throw failure;
  }
  publication.publish(candidate);
  await publication.priorSource?.();
  await releaseDeferredArray(
    publication.admissions,
    publication.priorAdmission,
    'Active history transfer ownership cleanup failed',
  );
}
