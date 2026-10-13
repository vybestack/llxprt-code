/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { failureAfterDisposal } from './historyDisposalFailure.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { DeferredHistorySourceOptions } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  admitDeferredHistorySource,
  bindDeferredHistoryTokenizer,
  prepareDeferredHistorySource,
  type DeferredHistoryDeps,
} from './deferredHistorySource.js';
import {
  releaseDeferredArray,
  type RetainedHistoryAdmissions,
  type RetainedHistoryAdmission,
} from './retainedHistoryAdmissions.js';

export async function replaceDeferredClientSource(
  source: AsyncIterable<IContent>,
  options: DeferredHistorySourceOptions,
  replacement: Replacement,
): Promise<void> {
  const admitted = await prepareDeferredHistorySource(
    source,
    replacement.deps,
    replacement.runtime,
    replacement.existing,
    options,
  );
  replacement.publish(admitted.journal, admitted.release);
  await replacement.existing?.dispose();
  await replacement.priorRelease?.();
  await releaseDeferredArray(
    replacement.admissions,
    replacement.prior,
    'Prior deferred history cleanup failed',
  );
}

/** The live chat's array replacement, which carries the publishing origin. */
interface ChatHistoryReplacement {
  setHistory(
    history: readonly IContent[],
    historyOrigin?: object,
  ): Promise<void>;
}

export function replaceClientArrayHistory(
  history: readonly IContent[],
  chat: ChatHistoryReplacement | undefined,
  admissions: RetainedHistoryAdmissions,
  prior: RetainedHistoryAdmission | undefined,
  replaceDeferred: (history: readonly IContent[]) => Promise<void>,
  publish: () => void,
  stripThoughts: boolean,
  historyOrigin?: object,
): Promise<void> {
  const rows = stripThoughts
    ? historyWithoutThoughtSignatures(history)
    : history;
  if (chat === undefined) return replaceDeferred(rows);
  return publishClientArrayHistory(
    chat.setHistory(rows, historyOrigin),
    admissions,
    prior,
    publish,
  );
}

async function publishClientArrayHistory(
  operation: Promise<void>,
  admissions: RetainedHistoryAdmissions,
  prior: RetainedHistoryAdmission | undefined,
  publish: () => void,
): Promise<void> {
  await operation;
  publish();
  await releaseDeferredArray(
    admissions,
    prior,
    'Deferred history cleanup after initialized update was incomplete',
  );
}

export function historyWithoutThoughtSignatures(
  history: readonly IContent[],
): readonly IContent[] {
  return history.map((content) => ({
    ...content,
    blocks: content.blocks.map((block) => {
      if (block.type !== 'thinking' || !('signature' in block)) return block;
      const { signature: _signature, ...unsigned } = block;
      return unsigned;
    }),
  }));
}

interface Replacement {
  readonly deps: DeferredHistoryDeps;
  readonly runtime: AgentRuntimeState;
  readonly existing?: HistoryService;
  readonly admissions: RetainedHistoryAdmissions;
  readonly prior?: RetainedHistoryAdmission;
  readonly priorRelease?: () => Promise<void>;
  publish(journal: HistoryService, release: () => Promise<void>): void;
}

export async function replaceClientHistorySource(
  source: AsyncIterable<IContent>,
  options: DeferredHistorySourceOptions,
  initialized: boolean,
  replacement: Replacement,
): Promise<void> {
  const { existing, deps, runtime } = replacement;
  const journal =
    initialized && existing !== undefined
      ? existing
      : new HistoryService({
          mutationOwnership: options.ownership,
          attachmentCounters: options.counters,
        });
  const detached = journal !== existing;
  if (detached) {
    bindDeferredHistoryTokenizer(journal, deps);
    journal.setActiveTokenizationTarget(runtime.model, runtime.provider);
  }
  let release: () => Promise<void>;
  try {
    release = await admitDeferredHistorySource(
      journal,
      source,
      deps.mediaStore,
      options,
      runtime.model,
    );
  } catch (error) {
    if (!detached) throw error;
    const failure = await failureAfterDisposal(journal, error);
    if (failure instanceof AggregateError) {
      throw new AggregateError(
        failure.errors,
        `${failure.message}: ${failure.errors.map(String).join('; ')}`,
        { cause: failure },
      );
    }
    throw failure;
  }
  replacement.publish(journal, release);
  if (detached) await existing?.dispose();
  await replacement.priorRelease?.();
  await releaseDeferredArray(
    replacement.admissions,
    replacement.prior,
    'Prior deferred history cleanup failed',
  );
}
