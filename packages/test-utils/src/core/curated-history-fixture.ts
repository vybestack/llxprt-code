/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectRawHistory } from './collect-raw-history.js';
import { collectRowsForAssertions } from './collect-rows-for-assertions.js';
import { observeHistorySynchronouslyForTest } from './synchronous-history-test-observation.js';

/** Independent same-turn oracle for pending identities and synchronous rebuild fixtures. */
export function curatedHistoryForTest(history: {
  streamRawHistory(): AsyncIterable<IContent>;
}): IContent[] {
  return buildCuratedHistory(
    new DebugLogger('test:curated-fixture'),
    observeHistorySynchronouslyForTest(history),
    false,
  );
}

/**
 * The curated history once every queued mutation is durable. The same oracle
 * as {@link curatedHistoryForTest} for tests that run on either backend: the
 * journal backend keeps no rows in memory, so a sample waits for the commit
 * and reads the raw rows through the service.
 */
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
