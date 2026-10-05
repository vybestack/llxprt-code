/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { withSuffixFixture, suffixRow } from './history-suffix-test-helpers.js';
import {
  exactTokenizer,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { collectRawHistory } from '../../test-utils/collect-raw-history.js';

async function measuredReads(action: () => Promise<void>): Promise<number> {
  const original = fs.readSync;
  let bytes = 0;
  function measure(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    options?: fs.ReadOptions,
  ): number;
  function measure(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset: number,
    length: number,
    position: fs.ReadPosition | null,
  ): number;
  function measure(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset: number | fs.ReadOptions = {},
    length?: number,
    position: fs.ReadPosition | null = null,
  ): number {
    let count: number;
    if (typeof offset === 'number') {
      if (length === undefined) throw new Error('Missing read length');
      count = original(fd, buffer, offset, length, position);
    } else count = original(fd, buffer, offset);
    bytes += count;
    return count;
  }
  const read = vi.spyOn(fs, 'readSync').mockImplementation(measure);
  try {
    await action();
    const output = process.env.PUBLICATION_IO_OUTPUT;
    if (output !== undefined)
      fs.appendFileSync(output, JSON.stringify({ readBytes: bytes }) + '\n');
    return bytes;
  } finally {
    read.mockRestore();
  }
}

describe('bounded disk publication work', () => {
  it('does not replay the growing durable density prefix for every removal batch', async () => {
    await withSuffixFixture(512, async (history) => {
      history.setTokenizerFactory(exactTokenizer());
      const readBytes = await measuredReads(async () => {
        await history.optimizeDensityRows(() => ({
          removalCount: 256,
          replacementCount: 0,
          metadata: {
            readWritePairsPruned: 0,
            fileDeduplicationsPruned: 0,
            recencyPruned: 256,
          },
          decision: (index) =>
            index % 2 === 0 ? { kind: 'removed' } : undefined,
          close: (): void => {},
        }));
        await history.waitForCommit();
      });
      expect(await collectRawHistory(history)).toStrictEqual(
        Array.from({ length: 256 }, (_, index) => suffixRow(index * 2 + 1)),
      );
      expect(readBytes).toBeGreaterThan(64 * 1024);
      expect(readBytes).toBeLessThan(2 * 1024 * 1024);
    });
  });

  it('publishes changed detached values without quadratic singleton-density replay', async () => {
    await withSuffixFixture(512, async (history) => {
      history.setTokenizerFactory(exactTokenizer());
      const readBytes = await measuredReads(async () => {
        await history.transformAll(async (source, sink) => {
          for await (const { row } of source.streamRows())
            sink.appendDetached({
              ...row,
              metadata: { ...row.metadata, responsesStored: false },
            });
        });
        await history.waitForCommit();
        expect(await collectRawHistory(history)).toStrictEqual(
          Array.from({ length: 512 }, (_, index) => {
            const row = suffixRow(index);
            return {
              ...row,
              metadata: { ...row.metadata, responsesStored: false },
            };
          }),
        );
      });
      expect(readBytes).toBeGreaterThan(64 * 1024);
      expect(readBytes).toBeLessThan(2 * 1024 * 1024);
    });
  });
});

describe('publication ordinal lifetime and addressing', () => {
  it('projects duplicate markers and replacement precedence exactly while admitting content between batches', async () => {
    await withRollbackFixture(async (_history, recorder) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        for (const index of [0, 1, 1, 2])
          journal.apply({ kind: 'content', content: suffixRow(index) });
        await journal.waitForDurable();
        await journal.withPublicationOrdinals(async () => {
          journal.apply({
            kind: 'density',
            payload: { removedSeqs: [2, 2], replacements: [] },
          });
          expect(journal.getLength()).toBe(2);
          await journal.waitForDurable();
          journal.apply({ kind: 'content', content: suffixRow(1) });
          journal.apply({
            kind: 'density',
            payload: {
              removedSeqs: [3],
              replacements: [{ replacedSeq: 3, replacement: suffixRow(1) }],
            },
          });
          expect(journal.getLength()).toBe(3);
          await journal.waitForDurable();
          journal.apply({
            kind: 'density',
            payload: { removedSeqs: [2], replacements: [] },
          });
          expect(journal.getLength()).toBe(1);
          await journal.waitForDurable();
        });
        expect(
          journal.withReadRows((cursor) => [...cursor.rows()]),
        ).toStrictEqual([suffixRow(0)]);
      } finally {
        journal.dispose();
      }
    });
  });
});

describe('publication ordinal admission and foreign writes', () => {
  it('discards the ordinal scope after an admission error and permits a correct retry', async () => {
    await withRollbackFixture(async (_history, recorder) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        journal.apply({ kind: 'content', content: suffixRow(0) });
        journal.apply({ kind: 'content', content: suffixRow(1) });
        await journal.waitForDurable();
        recorder.failAdmissionAfter(0);
        await expect(
          journal.withPublicationOrdinals(async () => {
            journal.apply({
              kind: 'density',
              payload: { removedSeqs: [1], replacements: [] },
            });
          }),
        ).rejects.toBe(recorder.failure);
        expect(journal.getLength()).toBe(2);
        await journal.withPublicationOrdinals(async () => {
          journal.apply({
            kind: 'density',
            payload: { removedSeqs: [2], replacements: [] },
          });
          await journal.waitForDurable();
        });
        expect(
          journal.withReadRows((cursor) => [...cursor.rows()]),
        ).toStrictEqual([suffixRow(0)]);
      } finally {
        journal.dispose();
      }
    });
  });

  it('rebinds cardinality when an external recorder admission interrupts the local stream', async () => {
    await withRollbackFixture(async (_history, recorder) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        for (const index of [0, 1, 2])
          journal.apply({ kind: 'content', content: suffixRow(index) });
        await journal.waitForDurable();
        await journal.withPublicationOrdinals(async () => {
          journal.apply({
            kind: 'density',
            payload: { removedSeqs: [2], replacements: [] },
          });
          await journal.waitForDurable();
          await recorder.commit('content', { content: suffixRow(9) });
          journal.apply({
            kind: 'density',
            payload: { removedSeqs: [3], replacements: [] },
          });
          await journal.waitForDurable();
        });
        expect(journal.getLength()).toBe(2);
        expect(
          journal.withReadRows((cursor) => [...cursor.rows()]),
        ).toStrictEqual([suffixRow(0), suffixRow(9)]);
      } finally {
        journal.dispose();
      }
    });
  });
});

describe('publication ordinal acquisition failure', () => {
  it('closes its pinned journal when ordinal scratch acquisition fails', async () => {
    await withRollbackFixture(async (_history, recorder) => {
      const journal = new HistoryJournalStore(recorder);
      const failure = new Error('ordinal acquisition failed');
      const opened = new Set<number>();
      const originalOpen = fs.openSync;
      const originalClose = fs.closeSync;
      journal.apply({ kind: 'content', content: suffixRow(0) });
      await journal.waitForDurable();
      const open = vi
        .spyOn(fs, 'openSync')
        .mockImplementation((path, flags, mode) => {
          if (String(path).includes('llxprt-row-directory-')) throw failure;
          const fd = originalOpen(path, flags, mode);
          opened.add(fd);
          return fd;
        });
      const close = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
        originalClose(fd);
        opened.delete(fd);
      });
      try {
        await expect(
          journal.withPublicationOrdinals(async () => {
            journal.apply({
              kind: 'density',
              payload: { removedSeqs: [1], replacements: [] },
            });
          }),
        ).rejects.toBe(failure);
        expect(opened.size).toBe(0);
      } finally {
        for (const fd of opened) originalClose(fd);
        open.mockRestore();
        close.mockRestore();
        journal.dispose();
      }
    });
  });
});
