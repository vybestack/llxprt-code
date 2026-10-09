/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, expect, it } from 'bun:test';
import type {
  HistoryTransformSink,
  HistoryTransformSource,
} from './historyRowTransform.js';
import {
  expectedRange,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import { changedTransformRow } from './row-transform-test-helpers.js';

describe('scoped row transform lifecycle', () => {
  it('rejects escaped cursor and sink use after callback completion', async () => {
    await withRollbackFixture(async (history) => {
      let escapedSink: HistoryTransformSink | undefined;
      let escapedSource: HistoryTransformSource | undefined;
      await history.transformAll(async (source, sink) => {
        escapedSink = sink;
        escapedSource = source;
        sink.appendDetached(rollbackRow(0));
      });
      if (escapedSink === undefined || escapedSource === undefined)
        throw new Error('Missing scoped handles');
      const closedSink = escapedSink;
      expect(() => closedSink.appendBorrowed(rollbackRow(1))).toThrow('closed');
      const cursor = escapedSource.streamRows()[Symbol.asyncIterator]();
      await expect(cursor.next()).rejects.toThrow('closed');
      expect(await rowsOf(history)).toHaveLength(1);
    });
  });

  it('distinguishes pending caller rows from detached source values', async () => {
    await withRollbackFixture(async (history, _recorder, releaseWriter) => {
      const original = rollbackRow(0);
      await history.addBatch([original]);
      const controller = new AbortController();
      const primary = new Error('cancel before commit');
      expect(
        await rejectedValue(
          history.transformAll(
            async (source, sink) => {
              for await (const entry of source.streamRows()) {
                expect(entry.ownership).toBe('borrowed');
                expect(entry.row).toBe(original);
                sink.appendBorrowed(entry.row);
              }
              controller.abort(primary);
            },
            undefined,
            { signal: controller.signal },
          ),
        ),
      ).toBe(primary);
      expect((await collectRawHistory(history))[0]).toBe(original);
      releaseWriter();
      await history.waitForCommit();
      await history.transformAll(async (source, sink) => {
        for await (const entry of source.streamRows()) {
          expect(entry.ownership).toBe('detached');
          expect(entry.row).not.toBe(original);
          sink.appendDetached(entry.row);
        }
      });
      expect(await rowsOf(history)).toStrictEqual([original]);
    }, true);
  });
});

describe('row transform traversal', () => {
  it('supports early return and repeated cursors in source order', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
      await history.addBatch(before);
      await history.waitForCommit();
      await history.transformAll(async (source, sink) => {
        for await (const { row } of source.streamRows()) {
          expect(row).toStrictEqual(before[0]);
          break;
        }
        let index = 0;
        for await (const { row } of source.streamRows()) {
          expect(row).toStrictEqual(before[index++]);
        }
        expect(index).toBe(3);
        for await (const { row } of source.streamRows())
          sink.appendDetached(changedTransformRow(row));
      });
      expect(await rowsOf(history)).toStrictEqual(
        before.map(changedTransformRow),
      );
      expect(history.getTotalTokens()).toBe(12);
      expect(history.getContextRange()).toStrictEqual(expectedRange(3));
    });
  });
});

describe('row transform detached sanitization', () => {
  it('sanitizes circular detached tool payloads without modifying caller rows', async () => {
    await withRollbackFixture(async (history) => {
      const parameters: Record<string, unknown> = { path: 'file' };
      parameters['self'] = parameters;
      const caller = {
        speaker: 'ai' as const,
        blocks: [
          {
            type: 'tool_call' as const,
            id: 'call',
            name: 'read_file',
            parameters,
          },
        ],
      };
      await history.transformAll(async (_source, sink) => {
        sink.appendDetached(caller);
      });
      const [stored] = await rowsOf(history);
      expect(stored.blocks).toStrictEqual([
        {
          type: 'tool_call',
          id: 'call',
          name: 'read_file',
          parameters: { path: 'file', self: { _circular: true } },
        },
      ]);
      expect(parameters['self']).toBe(parameters);
      expect('metadata' in caller).toBe(false);
    });
  });
});

describe('row transform publication cancellation', () => {
  it('restores membership, tokens and counters when cancellation follows journal publication', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
      await history.addBatch(before);
      await history.waitForCommit();
      const controller = new AbortController();
      const cancellation = new Error('cancel after admissions');
      expect(
        await rejectedValue(
          history.transformAll(
            async (_source, sink) => {
              sink.appendIdentity(rollbackRow(3));
            },
            undefined,
            {
              signal: controller.signal,
              afterPublication: () => {
                controller.abort(cancellation);
              },
            },
          ),
        ),
      ).toBe(cancellation);
      expect(await rowsOf(history)).toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(12);
      const following = rollbackRow(4);
      await history.addBatch([following]);
      expect(following.metadata?.chronology?.seq).toBe(4);
    });
  });
});
