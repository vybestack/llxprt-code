/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { HistoryJournalStore } from './historyJournalStore.js';

describe('old fold capture layout', () => {
  it('pins the journal once and takes the row origins from that pin', async () => {
    const history = new HistoryService({});
    try {
      for (let index = 0; index < 12; index++)
        history.add(suffixRow(index, 64));
      await history.waitForTokenUpdates();
      await history.waitForCommit();
      const captures = spyOn(
        HistoryJournalStore.prototype,
        'capturePendingFold',
      );
      try {
        await history.detachedValues.withCheckpoint(async () => {});
        expect(captures.mock.calls.length).toBe(1);
      } finally {
        captures.mockRestore();
      }
    } finally {
      await history.dispose();
    }
  });
});
