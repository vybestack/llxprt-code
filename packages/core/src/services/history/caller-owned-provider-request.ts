/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DebugLogger } from '../../debug/index.js';
import { logJournalRequestDiagnostics } from './journal-request-diagnostics.js';
import type { IContent } from './IContent.js';
import type { ProviderCuratedStreamOptions } from './provider-request-options.js';
import {
  callerOwnedPlans,
  callerOwnedPlanRows,
} from './caller-owned-plan-rows.js';
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
  const { source, plans } = await callerOwnedPlans(rows, tail, options.signal);
  const hasEmptyAi = (row: IContent): boolean =>
    row.speaker === 'ai' && row.blocks.length === 0;
  const emptyAi =
    rows.some(hasEmptyAi) || tail.some(hasEmptyAi)
      ? await callerOwnedPlans(rows, tail, options.signal, true)
      : undefined;
  if (diagnostics !== undefined)
    await logJournalRequestDiagnostics(
      source,
      plans.length,
      diagnostics.logger,
      diagnostics.isCompressing,
      options.signal,
    );
  const scope = new HistoryReaderScope('Provider request snapshot is closed');
  const selected = callerOwnedPlanRows(plans, scope, options);
  const first = plans.findIndex((plan) => plan.pending);
  return {
    ...selected,
    emptyAiRows:
      emptyAi === undefined
        ? undefined
        : callerOwnedPlanRows(emptyAi.plans, scope, options),
    pending: {
      inputCount: tail.length,
      firstOutputIndex: first < 0 ? undefined : first,
    },
    isPending(index) {
      scope.requireOpen();
      assertRowIndex(index, plans.length);
      return plans[index].pending;
    },
    close: async () => {
      await scope.close();
      source.close();
      emptyAi?.source.close();
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
