/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withPendingFixture } from './pending-window-disk-helpers.js';
import { digestRows } from './tool-truncation-stream-helpers.js';

describe('actual pending-window disk structural no-op', () => {
  it.each([0, 2])(
    'preserves empty or already-under-target membership at %i raw rows',
    async (size) => {
      await withPendingFixture(size, async ({ history, setup, owners }) => {
        // The provider baseline can overflow while history is already at its zero target.
        history.syncTotalTokens(0);
        const digest = await digestRows(history.streamRawHistory());
        const tokens = history.getTotalTokens();
        const anchor = history.getCacheAnchorSeq();
        const baseline = setup.handler.getLastPromptTokenCount();
        await expect(
          setup.handler.enforceContextWindow(600, 'pending-noop'),
        ).rejects.toThrow(/context limit/i);
        expect(
          Buffer.compare(
            Buffer.from(await digestRows(history.streamRawHistory())),
            Buffer.from(digest),
          ),
        ).toBe(0);
        expect(history.getTotalTokens() - tokens).toBe(0);
        expect(history.getCacheAnchorSeq() - anchor).toBe(0);
        expect(setup.handler.getLastPromptTokenCount() - baseline).toBe(0);
        expect(setup.handler.wasRecentlyCompressed()).toBe(false);
        expect(owners.snapshot().liveRows).toBe(0);
      });
    },
  );
});
