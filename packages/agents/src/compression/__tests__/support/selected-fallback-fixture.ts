/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createRecorderForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  digestRows,
  toolRankingRow,
} from '../tool-truncation-stream-helpers.js';

export async function withSelectedFallbackFixture(
  size: number,
  action: (fixture: {
    history: HistoryService;
    before: string;
    reads: ReturnType<typeof createRowCounters>;
    owners: RowOwnership;
  }) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'selected-provider-retry-'));
  const recorder = createRecorderForTest({ chatsDir: root });
  const reads = createRowCounters();
  const owners = new RowOwnership();
  const history = new HistoryService({
    recording: recorder,
    attachmentCounters: { ...reads.counters, ownership: owners },
    mutationOwnership: owners,
  });
  history.setTokenizerFactory(exactTokenizer());
  try {
    await history.detachedValues.replace(
      (function* (): Generator<IContent> {
        for (let index = 0; index < size; index++)
          yield toolRankingRow(index, 2048);
      })(),
      'test',
      { publishTokens: true },
    );
    await history.waitForCommit();
    history.setCacheAnchorSeq(1);
    history.setBaseTokenOffset(37);
    const before = await digestRows(history.streamRawHistory());
    await action({ history, before, reads, owners });
  } finally {
    await history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
