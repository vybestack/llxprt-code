/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
      expect(() => closedSink.appendDetached(rollbackRow(1))).toThrow('closed');
      const cursor = escapedSource.streamRows()[Symbol.asyncIterator]();
      await expect(cursor.next()).rejects.toThrow('closed');
      expect(await rowsOf(history)).toHaveLength(1);
    });
  });

  it('waits for the paused writer before publishing, then transforms detached values', async () => {
    await withRollbackFixture(async (history, _recorder, releaseWriter) => {
      const original = rollbackRow(0);
      let published = false;
      const adding = history.addBatch([original]).then(() => {
        published = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(published).toBe(false);
      releaseWriter();
      await adding;
      const [added] = await rowsOf(history);
      expect(added).toMatchObject(original);
      await history.transformAll(async (source, sink) => {
        for await (const entry of source.streamRows()) {
          expect(entry.ownership).toBe('detached');
          expect(entry.row).toStrictEqual(added);
          expect(entry.row).not.toBe(added);
          sink.appendDetached(entry.row);
        }
      });
      const [stored] = await rowsOf(history);
      expect(stored).toStrictEqual(added);
      expect(stored).not.toBe(added);
    }, true);
  });
});

describe('row transform traversal', () => {
  it('supports early return and repeated cursors in source order', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
      await history.addBatch(before);
      await history.waitForCommit();
      const stored = await rowsOf(history);
      await history.transformAll(async (source, sink) => {
        for await (const { row } of source.streamRows()) {
          expect(row).toStrictEqual(stored[0]);
          break;
        }
        let index = 0;
        for await (const { row } of source.streamRows()) {
          expect(row).toStrictEqual(stored[index++]);
        }
        expect(index).toBe(3);
        for await (const { row } of source.streamRows())
          sink.appendDetached(changedTransformRow(row));
      });
      expect(await rowsOf(history)).toStrictEqual(
        stored.map(changedTransformRow),
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
      const stored = await rowsOf(history);
      const controller = new AbortController();
      const cancellation = new Error('cancel after admissions');
      expect(
        await rejectedValue(
          history.transformAll(
            async (_source, sink) => {
              sink.appendDetached(rollbackRow(3));
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
      expect(await rowsOf(history)).toStrictEqual(stored);
      expect(history.getTotalTokens()).toBe(12);
      await history.addBatch([rollbackRow(4)]);
      const rows = await rowsOf(history);
      expect(rows[rows.length - 1].metadata?.chronology?.seq).toBe(4);
    });
  });
});
