/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as codec from './journalRowCodec.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { TokenRowSource } from './history-token-tickets.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
  }
}

describe.each([8, 24])('paused writer with %i submissions', (count) => {
  it('bounds encoded drafts and pending token sources while the writer is paused', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const drafts: Array<WeakRef<RowDraft>> = [];
      const sources: Array<WeakRef<TokenRowSource>> = [];
      const buffers: Array<WeakRef<Uint8Array>> = [];
      const originalEncode = codec.encodeContentRow;
      const encode = spyOn(codec, 'encodeContentRow').mockImplementation(
        (...args) => {
          const draft = originalEncode(...args);
          drafts.push(new WeakRef(draft));
          buffers.push(new WeakRef(draft.meta));
          for (const block of draft.blocks)
            buffers.push(new WeakRef(block.bytes));
          return draft;
        },
      );
      const originalCapture = JournalHistoryStore.prototype.captureTokenRow;
      const capture = spyOn(
        JournalHistoryStore.prototype,
        'captureTokenRow',
      ).mockImplementation(function (this: JournalHistoryStore) {
        const source = originalCapture.call(this);
        sources.push(new WeakRef(source));
        return source;
      });
      let pausedDrafts = 0;
      let pausedSources = 0;
      try {
        fixture.pauseWriter();
        for (let index = 0; index < count; index++) {
          fixture.history.add({
            speaker: 'human',
            blocks: [
              { type: 'text', text: `row ${index} ${'x'.repeat(4096)}` },
            ],
          });
          encode.mockClear();
          capture.mockClear();
        }
        await fixture.writerPaused;
        await settle();
        pausedDrafts = drafts.filter((ref) => ref.deref() !== undefined).length;
        pausedSources = sources.filter(
          (ref) => ref.deref() !== undefined,
        ).length;
        const pausedBuffers = buffers.filter(
          (ref) => ref.deref() !== undefined,
        ).length;
        const pausedBufferBytes = buffers.reduce(
          (sum, ref) => sum + (ref.deref()?.byteLength ?? 0),
          0,
        );
        fixture.releaseWriter();
        await fixture.history.waitForCommit();
        await fixture.history.waitForTokenUpdates();
        await settle();
        const acknowledgedDrafts = drafts.filter(
          (ref) => ref.deref() !== undefined,
        ).length;
        const acknowledgedSources = sources.filter(
          (ref) => ref.deref() !== undefined,
        ).length;
        const acknowledgedBuffers = buffers.filter(
          (ref) => ref.deref() !== undefined,
        ).length;
        expect(acknowledgedDrafts).toBe(0);
        expect(acknowledgedSources).toBe(0);
        expect(acknowledgedBuffers).toBe(0);
        expect(pausedDrafts).toBeLessThanOrEqual(2);
        expect(pausedSources).toBeLessThanOrEqual(2);
        expect(pausedBuffers).toBeLessThanOrEqual(4);
        expect(pausedBufferBytes).toBeLessThanOrEqual(16384);
      } finally {
        fixture.releaseWriter();
        encode.mockRestore();
        capture.mockRestore();
      }
    });
  });
});
