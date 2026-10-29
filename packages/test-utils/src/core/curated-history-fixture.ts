/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectRawHistory } from './collect-raw-history.js';
import { collectRowsForAssertions } from './collect-rows-for-assertions.js';
export async function curatedHistoryAfterCommit(history: {
  waitForCommit(): Promise<void>;
  streamRawHistory(): AsyncIterable<IContent>;
}): Promise<IContent[]> {
  await history.waitForCommit();
  return buildCuratedHistory(
    new DebugLogger('test:curated-fixture'),
    await collectRawHistory(history),
    false,
  );
}

export function withCuratedHistoryForTest(
  history: { streamRawHistory(): AsyncIterable<IContent> },
  assertRows: (rows: readonly IContent[]) => void | Promise<void>,
): Promise<void> {
  return collectRowsForAssertions(history.streamRawHistory(), async (raw) => {
    const curated = buildCuratedHistory(
      new DebugLogger('test:curated-fixture'),
      [...raw],
      false,
    );
    try {
      await assertRows(curated);
    } finally {
      curated.length = 0;
    }
  });
}
