/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { NativeFactIndexReader } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import {
  BoundedIdNodeCache,
  ID_NODE_CACHE_BYTES,
} from '@vybestack/llxprt-code-core/journal/idTrieCache.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import {
  readWritePolicy,
  readWriteFacts,
  toolRow,
  resultRow,
} from './support/read-write-facts.js';

async function selected(
  snapshot: VersionSnapshot,
  revision: string,
  size: number,
): Promise<number> {
  const scan = spyOn(snapshot, 'entries').mockImplementation(() => {
    throw new Error('Selected path query scanned history');
  });
  const facts = await readWriteFacts(snapshot, revision);
  let calls = 0;
  const get = NativeFactIndexReader.prototype.get;
  const weak: Array<WeakRef<object>> = [];
  NativeFactIndexReader.prototype.get = async function (
    this: NativeFactIndexReader,
    key,
  ) {
    calls++;
    const value = await get.call(this, key);
    if (value !== undefined) weak.push(new WeakRef(value));
    return value;
  };
  try {
    for (const index of [0, Math.floor(size / 2), size - 1]) {
      expect(await facts.stale(index * 3, `r-${index}`)).toBe(true);
      expect(await facts.staleId(`r-${index}`)).toBe(true);
    }
    expect(calls).toBe(12);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    expect(weak.filter((value) => value.deref() !== undefined)).toHaveLength(0);
    return calls;
  } finally {
    scan.mockRestore();
    NativeFactIndexReader.prototype.get = get;
  }
}
describe('native read/write selected-path query cost', () => {
  const directory = useTempDir('native-read-write-cost-');
  it.each([40, 4000])(
    'bounds selected-path reads over %i paths and performs no unchanged-policy refill',
    async (size) => {
      const counter = { reads: 0 };
      const seams = testJournalSeams({ readCounter: counter }, 1, false);
      const path = join(directory(), `cost-${size}.llxj`);
      const session = await JournalSession.create(path, {
        journal: seams.dependencies,
      });
      let measured = 0;
      const policy = readWritePolicy(() => {
        measured++;
      });
      const put = BoundedIdNodeCache.prototype.put;
      let peak = 0;
      BoundedIdNodeCache.prototype.put = function (
        this: BoundedIdNodeCache,
        offset,
        bytes,
      ): void {
        put.call(this, offset, bytes);
        peak = Math.max(peak, this.bytes);
        expect(this.bytes).toBeLessThanOrEqual(ID_NODE_CACHE_BYTES);
      };
      try {
        await session.append(
          Array.from({ length: size * 3 }, (_, index) => {
            const readId = `r-${Math.floor(index / 3)}`;
            if (index % 3 === 1) return resultRow(readId);
            const id = index % 3 === 0 ? readId : `w-${index}`;
            const name = index % 3 === 0 ? 'read_file' : 'write_file';
            return toolRow(id, name, `path-${Math.floor(index / 3)}`);
          }),
        );
        counter.reads = 0;
        await session.store.commit([{ kind: 'densityFiles', policy }]);
        const cold = counter.reads;
        expect(measured).toBe(size * 3);
        const snapshot = await session.store.snapshot();
        counter.reads = 0;
        let factCalls = 0;
        try {
          await expect(
            selected(snapshot, policy.revision, size).then((value) => {
              factCalls = value;
            }),
          ).resolves.toBeUndefined();
        } finally {
          await snapshot.close();
        }
        const reads = counter.reads;
        expect(reads).toBeLessThanOrEqual(
          12 * Math.ceil(Math.log2(size + 1)) + 16,
        );
        const bytes = (await stat(path)).size;
        const commits = session.store.published?.commitSeq;
        const before = measured;
        for (let index = 0; index < 40; index++)
          await session.store.commit([{ kind: 'densityFiles', policy }]);
        expect(measured - before).toBe(0);
        expect((await stat(path)).size - bytes).toBe(0);
        expect(session.store.published?.commitSeq).toBe(commits);
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(64 * 1024);
        process.stdout.write(
          `NATIVE_READ_WRITE_COST ${JSON.stringify({ size, coldFillReads: cold, selectedReads: reads, factCalls, peakCacheBytes: peak })}\n`,
        );
      } finally {
        BoundedIdNodeCache.prototype.put = put;
        await session.close();
      }
    },
    180_000,
  );
});
