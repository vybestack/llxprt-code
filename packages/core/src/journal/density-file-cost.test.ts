/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { JournalSession } from '../services/history/journalSession.js';
import { NativeFactIndexReader } from './nativeFactIndex.js';
import { BoundedIdNodeCache, ID_NODE_CACHE_BYTES } from './idTrieCache.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import type { DensityFilePolicy } from './density-file-facts.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import type { IContent } from '../services/history/IContent.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}
function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `file-${index}` }],
  };
}
async function query(
  snapshot: VersionSnapshot,
  revision: string,
  size: number,
): Promise<void> {
  const facts = await snapshot.densityFiles(revision);
  for (const index of [0, Math.floor(size / 2), size - 1])
    expect(await facts.latest(`file-${index}`)).toStrictEqual([index, 0, 0, 1]);
}
async function measuredQuery(
  snapshot: VersionSnapshot,
  revision: string,
  size: number,
): Promise<number> {
  let factCalls = 0;
  const node = NativeFactIndexReader.prototype.get;
  const decoded: Array<WeakRef<object>> = [];
  NativeFactIndexReader.prototype.get = async function (
    this: NativeFactIndexReader,
    key,
  ) {
    factCalls++;
    const value = await node.call(this, key);
    decoded.push(new WeakRef(value ?? {}));
    return value;
  };
  const noScan = spyOn(snapshot, 'entries').mockImplementation(() => {
    throw new Error('Ranking query scanned history');
  });
  try {
    await expect(query(snapshot, revision, size)).resolves.toBeUndefined();
    expect(factCalls).toBe(6);
    await tick();
    expect(decoded.filter((weak) => weak.deref() !== undefined)).toHaveLength(
      0,
    );
    return factCalls;
  } finally {
    noScan.mockRestore();
    NativeFactIndexReader.prototype.get = node;
  }
}

describe('native density file query cost', () => {
  const directory = useTempDir('density-file-cost-');
  it.each([40, 4000])(
    'queries three fixed path keys over %i rows without a source scan or warm refill',
    async (size) => {
      const counter = { reads: 0 };
      const seams = testJournalSeams({ readCounter: counter }, 1, false);
      const file = join(directory(), `rank-${size}.llxj`);
      const session = await JournalSession.create(file, {
        journal: seams.dependencies,
      });
      let measured = 0;
      const policy: DensityFilePolicy = {
        revision: 'file-cost:1',
        async *occurrences(snapshot, entry) {
          measured++;
          const row = decodeStoredRow(await snapshot.readRow(entry));
          const value = row.blocks[0];
          if (value.type !== 'text') throw new Error('Invalid fixture');
          yield { key: value.text, block: 0, start: 0 };
        },
      };
      const put = BoundedIdNodeCache.prototype.put;
      let peakCacheBytes = 0;
      BoundedIdNodeCache.prototype.put = function (
        this: BoundedIdNodeCache,
        offset,
        bytes,
      ): void {
        put.call(this, offset, bytes);
        peakCacheBytes = Math.max(peakCacheBytes, this.bytes);
        expect(this.bytes).toBeLessThanOrEqual(ID_NODE_CACHE_BYTES);
      };
      try {
        await session.append(
          Array.from({ length: size }, (_, index) => row(index)),
        );
        counter.reads = 0;
        await session.store.commit([{ kind: 'densityFiles', policy }]);
        const coldFillReads = counter.reads;
        expect(measured).toBe(size);
        const bytes = (await stat(file)).size;
        const snapshot = await session.store.snapshot();
        counter.reads = 0;
        let factCalls: number;
        try {
          factCalls = await measuredQuery(snapshot, policy.revision, size);
        } finally {
          await snapshot.close();
        }
        const warmQueryReads = counter.reads;
        expect(warmQueryReads).toBeLessThanOrEqual(
          6 * Math.ceil(Math.log2(size + 1)) + 8,
        );
        for (let index = 0; index < 40; index++)
          await session.store.commit([{ kind: 'densityFiles', policy }]);
        expect(measured).toBe(size);
        expect((await stat(file)).size - bytes).toBe(0);
        expect(session.store.published?.commitSeq).toBe(2);
        expect(peakCacheBytes).toBeGreaterThan(0);
        expect(peakCacheBytes).toBeLessThanOrEqual(64 * 1024);
        process.stdout.write(
          `NATIVE_FILE_COST ${JSON.stringify({ size, coldFillReads, warmQueryReads, factCalls, peakCacheBytes })}\n`,
        );
      } finally {
        BoundedIdNodeCache.prototype.put = put;
        await session.close();
      }
    },
    180_000,
  );
});
