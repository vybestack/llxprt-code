/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { VersionSnapshot } from '../../journal/versionSnapshot.js';
import {
  accountingFactory,
  withAccountingFixture,
} from './__tests__/support/token-accounting-stream-test-helpers.js';

describe('token accounting row handoff', () => {
  it('uses the submitted encoding once without a full-row reread', async () => {
    await withAccountingFixture(0, async (history, ownership) => {
      history.setTokenizerFactory(accountingFactory((text) => text.length));
      const read = spyOn(VersionSnapshot.prototype, 'readRow');
      try {
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'already encoded' }],
        });
        await history.waitForTokenUpdates();
        expect(history.getTotalTokens()).toBe('already encoded'.length);
        expect(read.mock.calls.length).toBe(0);
        expect(ownership.snapshot().liveRows).toBe(0);
      } finally {
        read.mockRestore();
      }
    });
  });

  it('keeps only one encoding and reads older queued tickets from their pinned versions', async () => {
    await withAccountingFixture(0, async (history, ownership) => {
      history.setTokenizerFactory(accountingFactory((text) => text.length));
      const read = spyOn(VersionSnapshot.prototype, 'readRow');
      try {
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'older' }],
        });
        history.add({
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'latest' }],
        });
        await history.waitForTokenUpdates();
        expect(history.getTotalTokens()).toBe('older'.length + 'latest'.length);
        expect(read.mock.calls.length).toBe(1);
        expect(ownership.snapshot().liveRows).toBe(0);
      } finally {
        read.mockRestore();
      }
    });
  });
});
