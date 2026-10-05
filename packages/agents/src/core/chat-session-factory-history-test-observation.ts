/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-core/test-utils/collect-rows-for-assertions.js';

export async function observeStoredHistoryReuse(
  storedHistoryService: HistoryService,
  wasInitiallyNonEmpty: boolean,
): Promise<{
  wasInitiallyNonEmpty: boolean;
  isEmptyAfterReuse: boolean;
  historyLength: number;
  retainedLiveTurn: boolean;
}> {
  const historyState = {
    wasInitiallyNonEmpty,
    isEmptyAfterReuse: storedHistoryService.isEmpty(),
    historyLength: 0,
    retainedLiveTurn: false,
  };
  await collectRowsForAssertions(
    storedHistoryService.streamRawHistory(),
    (after) => {
      historyState.historyLength = after.length;
      historyState.retainedLiveTurn = after[0].blocks.some(
        (b) => b.type === 'text' && b.text === 'live turn before switch',
      );
    },
  );
  return historyState;
}
