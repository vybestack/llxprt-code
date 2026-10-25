/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DebugLogger } from '../../debug/index.js';
import { logJournalRequestDiagnostics } from './journal-request-diagnostics.js';
import type { IContent } from './IContent.js';
import type { ProviderCuratedStreamOptions } from './provider-request-options.js';
import { CallerOwnedRequestSource } from './caller-owned-request-source.js';
import { streamResponsePlans } from './journal-response-units.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import { HistoryReaderScope } from './historyReaderScope.js';
import {
  assertRowIndex,
  inMemoryRequestSelection,
  validateProviderRequestBoundaries,
  type ProviderRequestSnapshot,
  type ProviderRequestSource,
} from './provider-request-snapshot.js';

export async function callerOwnedProviderRequest(
  rows: readonly IContent[],
  tail: readonly IContent[] = [],
  options: ProviderCuratedStreamOptions = {},
  diagnostics?: {
    readonly logger: DebugLogger;
    readonly isCompressing: boolean;
  },
): Promise<ProviderRequestSnapshot> {
  options.signal?.throwIfAborted();
  validateProviderRequestBoundaries(rows, tail);
  const source = await CallerOwnedRequestSource.create(rows, tail);
  const plans: JournalResponsePlan[] = [];
  for await (const plan of streamResponsePlans(source)) {
    options.signal?.throwIfAborted();
    plans.push(plan);
  }
  if (diagnostics !== undefined)
    await logJournalRequestDiagnostics(
      source,
      plans.length,
      diagnostics.logger,
      diagnostics.isCompressing,
      options.signal,
    );
  const scope = new HistoryReaderScope('Provider request snapshot is closed');
  const readAt = (index: number, signal?: AbortSignal): Promise<IContent> =>
    scope.read(async () => {
      options.signal?.throwIfAborted();
      signal?.throwIfAborted();
      assertRowIndex(index, plans.length);
      const plan = plans[index];
      const blocks: IContent['blocks'] = [];
      for await (const block of plan.openBlocks()) blocks.push(block);
      return { ...plan.header, blocks };
    });
  async function* openReader(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for (let index = 0; index < plans.length; index++) {
      const row = await readAt(index, signal);
      options.ownership?.retain(row);
      try {
        yield row;
      } finally {
        options.ownership?.release(row);
      }
    }
  }
  const first = plans.findIndex((plan) => plan.pending);
  return {
    callerOwned: true,
    count: plans.length,
    pending: {
      inputCount: tail.length,
      firstOutputIndex: first < 0 ? undefined : first,
    },
    isPending(index) {
      scope.requireOpen();
      assertRowIndex(index, plans.length);
      return plans[index].pending;
    },
    openReader: (signal) => scope.open(openReader(signal)),
    readAt,
    close: async () => {
      await scope.close();
      source.close();
    },
  };
}

export function callerOwnedProviderSource(
  rows: readonly IContent[],
): ProviderRequestSource {
  return {
    openProviderRequest: (signal) =>
      callerOwnedProviderRequest(rows, [], { signal }),
    async *[Symbol.asyncIterator]() {
      const snapshot = await callerOwnedProviderRequest(rows);
      try {
        yield* snapshot.openReader();
      } finally {
        await snapshot.close();
      }
    },
  };
}

export function callerOwnedRawProviderSource(
  rows: readonly IContent[],
): ProviderRequestSource {
  return {
    openProviderRequest: async () => ({
      ...inMemoryRequestSelection(rows),
      callerOwned: true,
    }),
    async *[Symbol.asyncIterator]() {
      yield* rows;
    },
  };
}
