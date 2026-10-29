/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { detachedDigest } from './detached-rollback-test-helpers.js';
import { nativeBorrowedRows } from './__tests__/support/native-borrowed-fixture.js';
import { retainedAfterSettling } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { withNativeBorrowedFixture } from './__tests__/support/native-borrowed-fixture.js';
import type { HistoryRowView } from './historyRowView.js';
import type { IContent } from './IContent.js';
import { historyOriginId } from './historyOriginId.js';
import { borrowedRow } from './borrowed-snapshot-test-helpers.js';

const bounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

describe('native borrowed snapshot controls', () => {
  it('pins source ordinals and owners across later publication and clear without decoding row facts', async () => {
    await withNativeBorrowedFixture(512, 2048, async (history, owners) => {
      const left = {};
      const right = {};
      await history.addBatch(
        [{ speaker: 'human', blocks: [{ type: 'text', text: 'left' }] }],
        undefined,
        { origin: left },
      );
      await history.addBatch(
        [{ speaker: 'ai', blocks: [{ type: 'text', text: 'right' }] }],
        undefined,
        { origin: right },
      );
      const acquired = owners.snapshot().acquisitions;
      await history.readRows(async (view) => {
        expect(view.length).toBe(514);
        await history.addBatch(
          [{ speaker: 'human', blocks: [{ type: 'text', text: 'later' }] }],
          undefined,
          { origin: right },
        );
        await history.clear();
        expect(history.length()).toBe(0);
        expect(view.length).toBe(514);
        expect(await view.originAt(0)).toBeUndefined();
        expect(await view.originAt(512)).toBe(historyOriginId(left));
        expect(await view.originAt(513)).toBe(historyOriginId(right));
        expect(await view.chronologySeqAt(511)).toBe(512);
        expect(owners.snapshot().acquisitions).toBe(acquired);
        let count = 0;
        for await (const row of view.rows()) {
          const expected: IContent['blocks'] =
            count < 512
              ? borrowedRow(count).blocks
              : [{ type: 'text', text: count === 512 ? 'left' : 'right' }];
          expect(row.blocks).toStrictEqual(expected);
          count++;
        }
        expect(count).toBe(514);
      });
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it.each([512, 8192])(
    'keeps the scoped pinned version after public clear at %i rows',
    async (size) => {
      await withNativeBorrowedFixture(size, 2048, async (history, owners) => {
        const expected = await detachedDigest(nativeBorrowedRows(size));
        await history.readRows(async (view) => {
          const unstarted = view.rows();
          await history.detachedValues.replace([]);
          expect(history.getContextRange().totalEntries).toBe(0);
          expect(view.length).toBe(size);
          expect(await detachedDigest(unstarted)).toStrictEqual(expected);
          expect(owners.snapshot().liveRows).toBe(0);
        });
        expect((await detachedDigest(history.streamRawHistory())).count).toBe(
          0,
        );
      });
    },
    120_000,
  );

  it('drops the acquired value when a held reader outlives its callback', async () => {
    await withNativeBorrowedFixture(512, 2048, async (history) => {
      const readers: Array<AsyncGenerator<IContent, void, unknown>> = [];
      const weak: Array<WeakRef<IContent>> = [];
      await history.readRows(async (view) => {
        const reader = view.rows();
        readers.push(reader);
        const first = await reader.next();
        if (first.done === true) throw new Error('Missing borrowed row');
        weak.push(new WeakRef(first.value));
      });
      expect(await retainedAfterSettling(weak)).toBe(0);
      expect((await readers[0].next()).done).toBe(true);
    });
  }, 120_000);

  it.each([512, 8192])(
    'charges two simultaneous readers independently and closes unstarted readers at %i rows',
    async (size) => {
      await withNativeBorrowedFixture(size, 2048, async (history, owners) => {
        const readers: Array<AsyncGenerator<IContent, void, unknown>> = [];
        let escaped: HistoryRowView | undefined;
        await history.readRows(async (view) => {
          escaped = view;
          readers.push(view.rows());
          expect(owners.snapshot().liveRows).toBe(0);
          const first = view.rows();
          const second = view.rows();
          readers.push(first, second);
          expect((await first.next()).done).toBe(false);
          expect(owners.snapshot().liveRows).toBe(1);
          expect((await second.next()).done).toBe(false);
          expect(owners.snapshot().liveRows).toBe(2);
          expect(owners.within(bounds)).toBe(true);
        });
        expect(owners.snapshot().liveRows).toBe(0);
        for (const reader of readers)
          expect((await reader.next()).done).toBe(true);
        if (escaped === undefined) throw new Error('Missing row view');
        await expect(escaped.originAt(0)).rejects.toThrow('closed');
        const closed = escaped;
        expect(() => closed.rows()).toThrow('closed');
      });
    },
    120_000,
  );

  it.each([512, 8192])(
    'detects actual whole-stream retention after reader cleanup at %i rows',
    async (size) => {
      await withNativeBorrowedFixture(size, 2048, async (history, owners) => {
        const retained: IContent[] = [];
        const trap = new RowOwnership();
        try {
          await history.readRows(async (view) => {
            for await (const row of view.rows()) {
              expect(owners.snapshot().liveRows).toBe(1);
              retained.push(row);
              trap.retain(row);
            }
            expect(owners.snapshot().liveRows).toBe(0);
          });
          expect(trap.snapshot()).toMatchObject({
            liveRows: size,
            acquisitions: size,
          });
          expect(trap.within(bounds)).toBe(false);
          expect(trap.snapshot().liveSerializedBytes).toBeGreaterThan(
            size * 2048,
          );
        } finally {
          for (const row of retained) trap.release(row);
          retained.length = 0;
        }
        expect(trap.snapshot().liveRows).toBe(0);
        expect(trap.snapshot().liveSerializedBytes).toBe(0);
      });
    },
    120_000,
  );
});
