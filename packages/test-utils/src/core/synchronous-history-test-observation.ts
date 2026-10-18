/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * The old store's same-turn sampler. The journal store has none: its rows are
 * in a file and rows still queued are not visible to a read (WIRING G2).
 */
interface SynchronousSampler {
  materializeSynchronously(): IContent[];
}

function isSynchronousSampler(value: unknown): value is SynchronousSampler {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'materializeSynchronously') === 'function'
  );
}

function isRowStore(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'streamRows') === 'function'
  );
}

// TEST ONLY: sample the current journal in this turn, including pending identities.
export function observeHistorySynchronouslyForTest(service: {
  streamRawHistory(): AsyncIterable<IContent>;
}): IContent[] {
  const journal: unknown = Reflect.get(service, 'journal');
  if (isSynchronousSampler(journal)) return journal.materializeSynchronously();
  if (isRowStore(journal)) {
    throw new Error(
      'Synchronous test observation needs the old backend: the journal store keeps no rows in memory. Await waitForCommit() and read collectRawHistory() instead',
    );
  }
  throw new Error('Synchronous test observation requires the service journal');
}
