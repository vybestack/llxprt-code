/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotateCompressionSpanStream } from './compression-span-stream.js';
import { annotateCompressionSpan } from './historyChronology.js';
import {
  withSuffixFixture,
  suffixRow,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  accountingRow,
  deferred,
} from './token-accounting-stream-test-helpers.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';

function summary(): IContent {
  return { speaker: 'ai', blocks: [], metadata: { isSummary: true } };
}

async function withScratch(
  action: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'raw-compression-test-'));
  try {
    await action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('raw compression cursor lifetime', () => {
  it('pins old membership across a clear, closes scratch and leaves one reader row during suspension', async () => {
    await withScratch(async (root) => {
      await withSuffixFixture(512, async (history, ownership) => {
        const gate = deferred();
        const entered = deferred();
        async function* suspend(): AsyncIterable<IContent> {
          for await (const row of history.streamRawHistory()) {
            yield row;
            if (row.metadata?.chronology?.seq === 1) {
              entered.resolve();
              await gate.promise;
            }
          }
        }
        const ledger = [readdirSync(root).length];
        const candidate = [summary(), suffixRow(511)];
        const operation = annotateCompressionSpanStream(suspend(), candidate, {
          root,
        });
        await entered.promise;
        ledger.push(readdirSync(root).length);
        expect(ownership.snapshot().liveRows).toBe(1);
        history.clear();
        gate.resolve();
        const result = await operation;
        ledger.push(readdirSync(root).length);
        expect(JSON.stringify(result)).toBe(
          JSON.stringify(
            annotateCompressionSpan(
              Array.from({ length: 512 }, (_, index) => suffixRow(index)),
              candidate,
            ),
          ),
        );
        expect(ledger).toStrictEqual([0, 1, 0]);
        expect(ownership.snapshot().liveRows).toBe(0);
      });
    });
  });
});

describe('raw compression cursor failure cleanup', () => {
  it('closes source and scratch on cancellation and producer failure', async () => {
    await withScratch(async (root) => {
      for (const aborted of [false, true]) {
        let closed = false;
        const controller = new AbortController();
        async function* source(): AsyncIterable<IContent> {
          try {
            yield suffixRow(0);
            if (aborted) controller.abort(new Error('annotation aborted'));
            else throw new Error('annotation source failed');
          } finally {
            closed = true;
          }
        }
        await expect(
          annotateCompressionSpanStream(source(), [summary()], {
            root,
            signal: controller.signal,
          }),
        ).rejects.toThrow(
          aborted ? 'annotation aborted' : 'annotation source failed',
        );
        expect({
          closed,
          scratchEntries: readdirSync(root).length,
        }).toStrictEqual({ closed: true, scratchEntries: 0 });
      }
    });
  });

  it('rejects a pre-aborted read before acquiring source or scratch', async () => {
    await withScratch(async (root) => {
      await withSuffixFixture(512, async (history, ownership) => {
        const controller = new AbortController();
        controller.abort(new Error('annotation pre-abort'));
        await expect(
          annotateCompressionSpanStream(
            history.streamRawHistory(controller.signal),
            [summary()],
            { root, signal: controller.signal },
          ),
        ).rejects.toThrow('annotation pre-abort');
        expect({
          acquisitions: ownership.snapshot().acquisitions,
          scratchEntries: readdirSync(root).length,
        }).toStrictEqual({ acquisitions: 0, scratchEntries: 0 });
      });
    });
  });
});

describe('copied and borrowed whole-history trap controls', () => {
  it.each([512, 8192])(
    'rejects deliberate ownership of %i copied and borrowed rows',
    async (size) => {
      await withSuffixFixture(
        size,
        async (history, journalOwnership) => {
          const borrowed = new RowOwnership();
          const copied = new RowOwnership();
          const combined = new RowOwnership();
          const borrowedRows: IContent[] = [];
          const copiedRows: IContent[] = [];
          for await (const row of history.streamRawHistory()) {
            const copy = { ...row, blocks: [...row.blocks] };
            borrowed.retain(row);
            copied.retain(copy);
            combined.retain(row);
            combined.retain(copy);
            borrowedRows.push(row);
            copiedRows.push(copy);
          }
          expect(borrowed.snapshot().peakRows).toBe(size);
          expect(copied.snapshot().peakRows).toBe(size);
          expect(combined.snapshot().peakRows).toBe(size * 2);
          const bound = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
          expect(borrowed.within(bound)).toBe(false);
          expect(copied.within(bound)).toBe(false);
          const requiredByteFloor = size === 8192 ? bound.serializedBytes : 0;
          expect(borrowed.snapshot().peakSerializedBytes).toBeGreaterThan(
            requiredByteFloor,
          );
          expect(copied.snapshot().peakSerializedBytes).toBeGreaterThan(
            requiredByteFloor,
          );
          for (const row of borrowedRows) {
            borrowed.release(row);
            combined.release(row);
          }
          for (const row of copiedRows) {
            copied.release(row);
            combined.release(row);
          }
          borrowedRows.length = 0;
          copiedRows.length = 0;
          expect(
            [borrowed, copied, combined, journalOwnership].map(
              (owner) => owner.snapshot().liveSerializedBytes,
            ),
          ).toStrictEqual([0, 0, 0, 0]);
        },
        2048,
        accountingRow,
      );
    },
    120_000,
  );
});
