import {
  collectRowsForAssertions,
  collectJournalRowsForAssertions,
} from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { createUserMessage } from './IContent.js';

describe('history journal marked-prefix mutations', () => {
  it('persists changes to retained metadata when appending and after the journal commits', async () => {
    const history = new HistoryService();
    history.add(createUserMessage('head'));
    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      const retained = rows[0];

      await history.replaceAll([
        { ...retained, metadata: { ...retained.metadata, cacheAnchor: true } },
        createUserMessage('tail'),
      ]);
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(rows[0].metadata?.cacheAnchor).toBe(true);
      });
      await history.waitForCommit();
      await collectJournalRowsForAssertions(history, (rows) => {
        expect(rows[0].metadata).toMatchObject({ cacheAnchor: true });
      });
    });
    history.dispose();
  });

  it('persists changes to retained metadata when truncating and after the journal commits', async () => {
    const history = new HistoryService();
    history.add(createUserMessage('head'));
    history.add(createUserMessage('tail'));
    await collectRowsForAssertions(history.streamRawHistory(), async (rows) => {
      const retained = rows[0];

      await history.replaceAll([
        { ...retained, metadata: { ...retained.metadata, cacheAnchor: true } },
      ]);
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(rows).toHaveLength(1);
      });
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(rows[0].metadata?.cacheAnchor).toBe(true);
      });
      await history.waitForCommit();
      await collectJournalRowsForAssertions(history, (rows) => {
        expect(rows[0].metadata).toMatchObject({ cacheAnchor: true });
      });
    });
    history.dispose();
  });
});
