/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';

export async function* sourceTokenBlocks(
  rows: IndexedJournalRequestSnapshot,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < rows.count; index++) {
    signal?.throwIfAborted();
    const plan = await rows.planAt(index, signal);
    for await (const block of plan.openBlocks()) {
      signal?.throwIfAborted();
      yield { ...plan.header, blocks: [block] };
    }
  }
  signal?.throwIfAborted();
}
