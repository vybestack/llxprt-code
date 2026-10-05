/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { DeferredHistorySourceOptions } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  admitDeferredHistorySource,
  prepareDeferredHistorySource,
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
    replacement.config,
    replacement.runtime,
    replacement.existing,
    options,
  );
  replacement.existing?.dispose();
  replacement.publish(admitted.journal, admitted.release);
  await replacement.priorRelease?.();
  await releaseDeferredArray(
    replacement.admissions,
    replacement.prior,
    'Prior deferred history cleanup failed',
  );
}

import type { AgentChatContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

export function replaceClientArrayHistory(
  history: readonly IContent[],
  chat: AgentChatContract | undefined,
  admissions: RetainedHistoryAdmissions,
  prior: RetainedHistoryAdmission | undefined,
  replaceDeferred: (history: readonly IContent[]) => Promise<void>,
  publish: () => void,
  stripThoughts: boolean,
): Promise<void> {
  const rows = stripThoughts
    ? historyWithoutThoughtSignatures(history)
    : history;
  if (chat === undefined) return replaceDeferred(rows);
  return publishClientArrayHistory(
    chat.setHistory(rows),
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
  readonly config: Config;
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
  const { existing, config, runtime } = replacement;
  const journal =
    initialized && existing !== undefined
      ? existing
      : new HistoryService({
          mutationOwnership: options.ownership,
          attachmentCounters: options.counters,
        });
  const detached = journal !== existing;
  if (detached) {
    const factory = config.getTokenizerFactory();
    if (factory) journal.setTokenizerFactory(factory);
    journal.setActiveTokenizationTarget(runtime.model, runtime.provider);
  }
  let release: () => Promise<void>;
  try {
    release = await admitDeferredHistorySource(
      journal,
      source,
      config.getLocalMediaStore(),
      options,
      runtime.model,
    );
  } catch (error) {
    if (detached) {
      journal.dispose();
      if (error instanceof AggregateError) {
        throw new AggregateError(
          error.errors,
          `${error.message}: ${error.errors.map(String).join('; ')}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
  if (detached) existing?.dispose();
  replacement.publish(journal, release);
  await replacement.priorRelease?.();
  await releaseDeferredArray(
    replacement.admissions,
    replacement.prior,
    'Prior deferred history cleanup failed',
  );
}
