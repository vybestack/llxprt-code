/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryMediaIndex } from './history-media-index.js';
import { LocalMediaStore } from './local-media-store.js';
import { RowOwnership } from '../recording/rowOwnership.js';

describe('disk media index resources', () => {
  it('deduplicates on disk, counts decoded copies and closes enumeration on cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-index-test-'));
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024,
    });
    const index = new HistoryMediaIndex(directory);
    const ownership = new RowOwnership();
    try {
      const reference = await store.admit({
        bytes: new Uint8Array([1]),
        mimeType: 'application/octet-stream',
        semanticMetadata: { description: 'nested payload' },
      });
      index.set(reference);
      index.set({ ...reference });
      expect(
        (await readdir(directory)).filter((name) =>
          name.startsWith('history-media-index-'),
        ),
      ).toHaveLength(1);
      const consumer: object[] = [];
      for (const decoded of index.values(ownership)) {
        expect(decoded).toStrictEqual(reference);
        expect(decoded).not.toBe(reference);
        ownership.retain(decoded);
        consumer.push(decoded);
        break;
      }
      index.close();
      expect(
        (await readdir(directory)).filter((name) =>
          name.startsWith('history-media-index-'),
        ),
      ).toStrictEqual([]);
      expect(ownership.snapshot().liveRows).toBe(1);
      for (const row of consumer) ownership.release(row);
      expect(ownership.snapshot().liveRows).toBe(0);
    } finally {
      index.close();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
