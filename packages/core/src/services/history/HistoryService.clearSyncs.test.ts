/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HISTORY_BACKEND_ENV } from './historyBackendSelect.js';
import { HistoryService } from './HistoryService.js';
import { createUserMessage } from './IContent.js';

/**
 * A provider token count that was requested before clear() describes rows
 * the clear removes, so it must not move the base offset on either store.
 * The journal store applies a clear one queue turn after the call returns;
 * the sync queued before the call must still be ignored.
 */
describe.each(['old', 'journal'] as const)(
  'syncTotalTokens around clear() (%s store)',
  (backend) => {
    const saved = process.env[HISTORY_BACKEND_ENV];
    let history: HistoryService;
    beforeEach(() => {
      process.env[HISTORY_BACKEND_ENV] = backend;
      history = new HistoryService();
    });
    afterEach(async () => {
      if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
      else process.env[HISTORY_BACKEND_ENV] = saved;
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
