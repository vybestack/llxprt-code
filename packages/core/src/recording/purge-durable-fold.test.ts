/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { appendFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { foldDurableRows, pinReadableFile } from './durableRowFold.js';
import { MetadataJsonProjection } from './metadataJsonProjection.js';
import {
  PURGE_BUFFER_BOUND,
  purgeRow,
  withPurgeFile,
  writePurgeFixture,
  record,
  assertOriginalSurvives,
  purgeFileDigest,
  expectedPurgeFileDigest,
} from './purge-durable-fold-test-helpers.js';

describe('bounded v2 purge durable fold', () => {
  it('indexes an oversized event without parsing its body, preserves suffix order and reopens unchanged bytes', async () => {
    await withPurgeFile(async (root, file) => {
      const bytes = writePurgeFixture(file);
      expect(bytes).toBeGreaterThan(PURGE_BUFFER_BOUND);
      const tail =
        record('rewind', { itemsRemoved: 2 }) +
        record('content', { content: purgeRow(9000) });
      appendFileSync(file, tail);
      const watermark = bytes + Buffer.byteLength(tail);
      const digest = expectedPurgeFileDigest(tail);
      const parse = JSON.parse;
      let parses = 0;
      const trap = spyOn(JSON, 'parse').mockImplementation((text: string) => {
        if (text.startsWith('{') || text.startsWith('[')) {
          parses++;
          throw new Error('eager JSON parse trap');
        }
        return parse(text);
      });
      let fold;
      try {
        fold = await foldDurableRows({
          filePath: file,
          maxBytes: watermark,
          scratchRoot: root,
        });
        expect(fold.length).toBe(8191);
        expect(parses).toBe(0);
      } finally {
        trap.mockRestore();
      }
      try {
        expect(await fold.readRow(0)).toStrictEqual(purgeRow(0));
        expect(await fold.readRow(8190)).toStrictEqual(purgeRow(9000));
      } finally {
        await fold.close();
      }
      const reopened = await foldDurableRows({
        filePath: file,
        maxBytes: watermark,
        scratchRoot: root,
        chunkBytes: 511,
      });
      try {
        expect(reopened.length).toBe(8191);
        expect(await reopened.readRow(8189)).toStrictEqual(purgeRow(8189));
      } finally {
        await reopened.close();
      }
      expect(statSync(file).size).toBe(watermark);
      expect(await purgeFileDigest(file)).toBe(digest);
      expect(readdirSync(root)).toStrictEqual(['journal.jsonl']);
    });
  });
});

describe('oversized purge recovery and backward reads', () => {
  it.each([
    ['torn row', '', ',{"speaker":"human","blocks":['],
    ['torn envelope', ']}', ''],
    ['invalid row schema', ']}}\n', ',{"speaker":"other","blocks":[]}'],
    [
      'invalid block schema',
      ']}}\n',
      ',{"speaker":"human","blocks":{"count":1}}',
    ],
  ])(
    'leaves previous membership intact for an oversized %s',
    async (_name, suffix, last) => {
      await withPurgeFile(async (root, file) => {
        const bytes = writePurgeFixture(file, suffix, last);
        expect(await assertOriginalSurvives(root, file, bytes)).toStrictEqual(
          purgeRow(99_999),
        );
        expect(readdirSync(root)).toStrictEqual(['journal.jsonl']);
      });
    },
  );

  it('accepts a complete final event without a newline and reads old v1 events', async () => {
    await withPurgeFile(async (root, file) => {
      writeFileSync(file, record('content', { content: purgeRow(10) }, 1));
      appendFileSync(
        file,
        record(
          'semantic_media_purge',
          { history: [purgeRow(11)] },
          1,
        ).trimEnd(),
      );
      expect(
        await assertOriginalSurvives(root, file, statSync(file).size),
      ).toStrictEqual(purgeRow(11));
      const bytes = writePurgeFixture(file, ']}}');
      const fold = await foldDurableRows({
        filePath: file,
        maxBytes: bytes,
        scratchRoot: root,
      });
      try {
        expect(fold.length).toBe(8192);
        expect(await fold.readRow(8191)).toStrictEqual(purgeRow(8191));
      } finally {
        await fold.close();
      }
    });
  });
});

describe('oversized purge filesystem failure', () => {
  it('preserves a filesystem read failure and closes pinned handles and scratch', async () => {
    await withPurgeFile(async (root, file) => {
      const bytes = writePurgeFixture(file);
      const pinned = pinReadableFile(file);
      const failure = new Error('read I/O failed');
      let reads = 0;
      let closed = false;
      const source = {
        ...pinned,
        handle: {
          ...pinned.handle,
          read: async (
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ): Promise<number> => {
            if (++reads === 7) throw failure;
            return pinned.handle.read(buffer, offset, length, position);
          },
          close: async (): Promise<void> => {
            closed = true;
            pinned.release();
          },
        },
      };
      await expect(
        foldDurableRows({
          maxBytes: bytes,
          scratchRoot: root,
          pinnedJournal: source,
        }),
      ).rejects.toBe(failure);
      expect(closed).toBe(true);
      expect(readdirSync(root)).toStrictEqual(['journal.jsonl']);
    });
  });
});

describe('oversized purge scan cancellation', () => {
  it('cancels during oversized scanning with the original reason and releases every scratch file', async () => {
    await withPurgeFile(async (root, file) => {
      const bytes = writePurgeFixture(file);
      const pinned = pinReadableFile(file);
      const controller = new AbortController();
      const reason = new Error('cancel scan');
      let reads = 0;
      const source = {
        ...pinned,
        handle: {
          ...pinned.handle,
          read: async (
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ): Promise<number> => {
            const result = await pinned.handle.read(
              buffer,
              offset,
              length,
              position,
            );
            if (++reads === 7) controller.abort(reason);
            return result;
          },
        },
      };
      await expect(
        foldDurableRows({
          maxBytes: bytes,
          scratchRoot: root,
          pinnedJournal: source,
          signal: controller.signal,
        }),
      ).rejects.toBe(reason);
      expect(reads).toBe(7);
      expect(readdirSync(root)).toStrictEqual(['journal.jsonl']);
      await expect(
        pinned.handle.read(Buffer.alloc(1), 0, 1, 0),
      ).rejects.toThrow('released');
    });
  });
});

describe('bounded retained projection tokens', () => {
  it('fails before a retained token grows past its supplied allocation bound while ignoring oversized body strings', () => {
    const bounded = new MetadataJsonProjection({
      retain: () => true,
      maxTokenBytes: 32,
    });
    expect(() => bounded.push('{"speaker":"' + 'x'.repeat(100))).toThrow(
      RangeError,
    );
    const discarded = new MetadataJsonProjection({
      retain: (path) => path.length === 0,
      maxTokenBytes: 32,
    });
    discarded.push('{"body":"' + 'x'.repeat(1000) + '"}');
    expect(discarded.finish()).toStrictEqual({});
  });
});

describe('durable resolver retained token enforcement', () => {
  it('keeps the unchanged 8 MiB parser allocation bound active and cleans up a corrupt oversized type token', async () => {
    await withPurgeFile(async (root, file) => {
      writeFileSync(
        file,
        '{"v":2,"type":"' + 'x'.repeat(PURGE_BUFFER_BOUND / 4 + 1) + '"}',
      );
      await expect(
        foldDurableRows({
          filePath: file,
          maxBytes: statSync(file).size,
          scratchRoot: root,
        }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(readdirSync(root)).toStrictEqual(['journal.jsonl']);
    });
  });
});
