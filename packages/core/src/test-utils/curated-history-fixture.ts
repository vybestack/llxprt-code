/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '../debug/index.js';
import { buildCuratedHistory } from '../services/history/historyCuration.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { collectRowsForAssertions } from './collect-rows-for-assertions.js';
import { observeHistorySynchronouslyForTest } from './synchronous-history-test-observation.js';

/** Independent same-turn oracle for pending identities and synchronous rebuild fixtures. */
export function curatedHistoryForTest(history: HistoryService): IContent[] {
  return buildCuratedHistory(
    new DebugLogger('test:curated-fixture'),
    observeHistorySynchronouslyForTest(history),
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
