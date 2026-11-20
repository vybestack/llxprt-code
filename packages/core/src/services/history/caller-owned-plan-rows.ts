/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import { CallerOwnedRequestSource } from './caller-owned-request-source.js';
import type { HistoryReaderScope } from './historyReaderScope.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import { streamResponsePlans } from './journal-response-units.js';
import type { ProviderCuratedStreamOptions } from './provider-request-options.js';
import {
  assertRowIndex,
  type ProviderRequestRows,
} from './provider-request-snapshot.js';

export async function callerOwnedPlans(
  rows: readonly IContent[],
  tail: readonly IContent[],
  signal?: AbortSignal,
  preserveEmptyAi = false,
): Promise<{ source: CallerOwnedRequestSource; plans: JournalResponsePlan[] }> {
  const source = await CallerOwnedRequestSource.create(
    rows,
    tail,
    preserveEmptyAi,
  );
  const plans: JournalResponsePlan[] = [];
  for await (const plan of streamResponsePlans(source)) {
    signal?.throwIfAborted();
    plans.push(plan);
  }
  return { source, plans };
}

export function callerOwnedPlanRows(
  plans: readonly JournalResponsePlan[],
  scope: HistoryReaderScope,
  options: ProviderCuratedStreamOptions,
): ProviderRequestRows {
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
  return {
    callerOwned: true,
    count: plans.length,
    readAt,
    openReader: (signal) => scope.open(openReader(signal)),
  };
}
