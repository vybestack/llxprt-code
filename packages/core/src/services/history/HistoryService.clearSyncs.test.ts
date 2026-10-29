/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HistoryService } from './HistoryService.js';
import { createUserMessage } from './IContent.js';

/**
 * A provider token count that was requested before clear() describes rows
 * the clear removes, so it must not move the base offset on either store.
 * The journal store applies a clear one queue turn after the call returns;
 * the sync queued before the call must still be ignored.
 */
describe.each(['journal'] as const)(
  'syncTotalTokens around clear() (%s store)',
  () => {
    let history: HistoryService;
    beforeEach(() => {
      history = new HistoryService();
    });
    afterEach(async () => {
      await history.dispose();
    });

    it('ignores a sync queued before clear()', async () => {
      history.add(createUserMessage('Conversation history'), 'gpt-4.1');
      await history.waitForTokenUpdates();

      history.syncTotalTokens(80000);
      await history.clear();
      await history.waitForTokenUpdates();

      expect(history.getBaseTokenOffset()).toBe(0);
      expect(history.getTotalTokens()).toBe(0);
    });

    it('ignores a sync queued before a clear that waits for compression', async () => {
      history.add(createUserMessage('Conversation history'), 'gpt-4.1');
      await history.waitForTokenUpdates();

      history.startCompression();
      history.syncTotalTokens(80000);
      const cleared = history.clear();
      history.endCompression();
      await cleared;
      await history.waitForTokenUpdates();

      expect(history.getBaseTokenOffset()).toBe(0);
      expect(history.getTotalTokens()).toBe(0);
    });
  },
);
