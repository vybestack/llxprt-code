/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { curatedHistoryAfterCommit } from '@vybestack/llxprt-code-test-utils/core/curated-history-fixture.js';
import { afterEach } from 'bun:test';
type HistoryBackend = 'old' | 'journal';

export function compressionBackendFixture(_backend: HistoryBackend): {
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
      const history = new HistoryService({});
      histories.push(history);
      return history;
    },
    sampleCurated: (history): IContent[] | Promise<IContent[]> =>
      curatedHistoryAfterCommit(history),
    assertCurated: (history, assertRows): void | Promise<void> =>
      curatedHistoryAfterCommit(history).then(assertRows),
  };
}
