/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { JournalSession } from '../services/history/journalSession.js';
import { ToolRankingTree } from './tool-ranking-tree.js';
import { BoundedIdNodeCache, ID_NODE_CACHE_BYTES } from './idTrieCache.js';
import { decodeStoredBlock } from '../services/history/journalRowCodec.js';
import { ROW_BLOCK_TYPE } from './rowRecord.js';
import type { ToolRankingPolicy } from './tool-ranking-fill.js';
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
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: `cost-${index}`,
        toolName: 'read_file',
        result: index + 1,
      },
    ],
  };
}
async function query(
  snapshot: VersionSnapshot,
  revision: string,
  size: number,
): Promise<void> {
  const tree = await snapshot.toolRanking(revision);
  const header = await tree.header();
  const label = (await snapshot.entryAt(size - 1)).label;
  expect((await tree.position(label, 0))?.ordinal).toBe(size - 1);
  expect((await tree.at(header.root, 0)).ordinal).toBe(size - 1);
  const ordinals: number[] = [];
  for await (const rank of tree.ordered(header.root)) {
    ordinals.push(rank.ordinal);
    if (ordinals.length === 3) break;
  }
  expect(ordinals).toStrictEqual([size - 1, size - 2, size - 3]);
}
async function measuredQuery(
  snapshot: VersionSnapshot,
  revision: string,
  size: number,
): Promise<number> {
  let nodeCalls = 0;
  const node = ToolRankingTree.prototype.node;
  const decoded: Array<WeakRef<object>> = [];
  ToolRankingTree.prototype.node = async function (this: ToolRankingTree, id) {
    nodeCalls++;
    const value = await node.call(this, id);
    decoded.push(new WeakRef(value));
    return value;
  };
  const noScan = spyOn(snapshot, 'entries').mockImplementation(() => {
    throw new Error('Ranking query scanned history');
  });
  try {
    await query(snapshot, revision, size);
    expect(nodeCalls).toBeLessThanOrEqual(
      6 * Math.ceil(Math.log2(size + 1)) + 8,
    );
    await tick();
    expect(decoded.filter((weak) => weak.deref() !== undefined)).toHaveLength(
      0,
    );
    return nodeCalls;
  } finally {
    noScan.mockRestore();
    ToolRankingTree.prototype.node = node;
  }
}

describe('native tool ranking query cost', () => {
  const directory = useTempDir('tool-rank-cost-');
  it.each([40, 4000])(
    'queries point, top and fixed range over %i rows without a source scan or warm refill',
    async (size) => {
      const counter = { reads: 0 };
      const seams = testJournalSeams({ readCounter: counter }, 1, false);
      const file = join(directory(), `rank-${size}.llxj`);
      const session = await JournalSession.create(file, {
        journal: seams.dependencies,
      });
      let measured = 0;
      const policy: ToolRankingPolicy = {
        revision: 'rank-cost:1',
        measure: async (snapshot, entry, index) => {
          measured++;
          const block = decodeStoredBlock(
            await snapshot.readBlock(entry, index),
            ROW_BLOCK_TYPE.tool_response,
          );
          if (
            block.type !== 'tool_response' ||
            typeof block.result !== 'number'
          )
            throw new Error('Invalid cost fixture');
          return { score: block.result, saving: block.result - 1 };
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
        await session.store.commit([{ kind: 'toolRanking', policy }]);
        const coldFillReads = counter.reads;
        expect(measured).toBe(size);
        const bytes = (await stat(file)).size;
        const snapshot = await session.store.snapshot();
        counter.reads = 0;
        let nodeCalls: number;
        try {
          nodeCalls = await measuredQuery(snapshot, policy.revision, size);
        } finally {
          await snapshot.close();
        }
        const warmQueryReads = counter.reads;
        for (let index = 0; index < 40; index++)
          await session.store.commit([{ kind: 'toolRanking', policy }]);
        expect(measured).toBe(size);
        expect((await stat(file)).size - bytes).toBe(0);
        expect(session.store.published?.commitSeq).toBe(2);
        expect(peakCacheBytes).toBeGreaterThan(0);
        expect(peakCacheBytes).toBeLessThanOrEqual(64 * 1024);
        process.stdout.write(
          `NATIVE_TOOL_COST ${JSON.stringify({ size, coldFillReads, warmQueryReads, nodeCalls, peakCacheBytes })}\n`,
        );
      } finally {
        BoundedIdNodeCache.prototype.put = put;
        await session.close();
      }
    },
    180_000,
  );
});
