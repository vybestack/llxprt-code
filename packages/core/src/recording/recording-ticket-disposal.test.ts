/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSynchronousFixture } from '../services/history/synchronous-ticket-test-helpers.js';
import { batchRow } from '../services/history/addbatch-stream-test-helpers.js';
import { durableRowsOf } from '../services/history/chronology-rollback-test-helpers.js';

describe('recording ticket disposal admission boundary', () => {
  it('drains accepted bytes and rejects a gated commit when disposal has started', async () => {
    await withSynchronousFixture(async (fixture) => {
      fixture.pauseWriter();
      const row = batchRow(0, 9 * 1024 * 1024 + 17);
      const accepted = fixture.recorder.commit('content', { content: row });
      await fixture.waitForPausedWrite;
      const gated = fixture.recorder
        .commit('content', { content: batchRow(1) })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      const closing = fixture.recorder.dispose();
      const sequence = 2;
      expect(fixture.recorder.isActive()).toBe(false);
      expect(
        fixture.recorder.enqueue('content', { content: batchRow(2) }),
      ).toBeNull();
      expect(fixture.recorder.getLastEnqueuedSequence()).toBe(sequence);
      fixture.releaseWriter();
      await accepted;
      await closing;
      const failure = await gated;
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error))
        throw new Error('Missing disposal rejection');
      expect(failure.message).toContain('disposed');
      expect(await durableRowsOf(fixture.recorder)).toStrictEqual([row]);
      expect(fixture.recorder.getPendingRecordCount()).toBe(0);
      await expect(
        fixture.recorder.commit('content', { content: batchRow(3) }),
      ).rejects.toThrow('disposed');
    });
  }, 180_000);
});
