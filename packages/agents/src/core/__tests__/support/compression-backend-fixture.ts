/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  curatedHistoryForTest,
  curatedHistoryAfterCommit,
} from '@vybestack/llxprt-code-test-utils/core/curated-history-fixture.js';

export function compressionBackendFixture(backend: HistoryBackend): {
  createHistory(): HistoryService;
  sampleCurated(history: HistoryService): IContent[] | Promise<IContent[]>;
  assertCurated(
    history: HistoryService,
    assertRows: (rows: IContent[]) => void,
  ): void | Promise<void>;
} {
  const histories: HistoryService[] = [];
  afterEach(async () => {
    for (const history of histories) await history.dispose();
    histories.length = 0;
  });
  return {
    createHistory: (): HistoryService => {
      const history = new HistoryService({ backend });
      histories.push(history);
      return history;
    },
    sampleCurated: (history): IContent[] | Promise<IContent[]> =>
      backend === 'old'
        ? curatedHistoryForTest(history)
        : curatedHistoryAfterCommit(history),
    assertCurated: (history, assertRows): void | Promise<void> => {
      if (backend === 'old') return assertRows(curatedHistoryForTest(history));
      return curatedHistoryAfterCommit(history).then(assertRows);
    },
  };
}
