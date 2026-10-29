/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import {
  decodeStoredBlock,
  decodeStoredRow,
} from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import { ROW_BLOCK_TYPE } from './rowRecord.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import { ToolRankingTree } from './tool-ranking-tree.js';
import type { ToolRankingPolicy } from './tool-ranking-fill.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const revision = 'compaction-rank:1';
const policy: ToolRankingPolicy = {
  revision,
  measure: async (snapshot, entry, index) => {
    const block = decodeStoredBlock(
      await snapshot.readBlock(entry, index),
      ROW_BLOCK_TYPE.tool_response,
    );
    if (block.type !== 'tool_response' || typeof block.result !== 'number')
      throw new Error('Invalid compaction rank input');
    return { score: block.result, saving: block.result - 1 };
  },
};
async function ranked(
  snapshot: VersionSnapshot,
  pending = false,
): Promise<unknown[]> {
  const tree = pending
    ? new ToolRankingTree(snapshot.facts, true)
    : await snapshot.toolRanking(revision);
  const header = await tree.header();
  const values = [];
  for await (const rank of tree.ordered(header.root)) values.push(rank);
  return values;
}
function row(index: number): IContent {
  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_response',
        callId: `call-${index % 3}`,
        toolName: 'read_file',
        result: index + 2,
      },
    ],
    metadata: {
      chronology: {
        seq: index * 4 + 2,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
      chronologyReplaced: {
        fromSeq: index * 4,
        toSeq: index * 4 + 1,
        itemCount: 2,
      },
    },
  };
}

describe('native ranking and summary facts across compaction', () => {
  const directory = useTempDir('tool-ranking-compaction-');
  it('copies persisted and pending ranks, summary ranges, owners and checkpoint roots without changing commit identity', async () => {
    const session = await JournalSession.create(
      join(directory(), 'ranked.llxj'),
    );
    try {
      await session.append(
        Array.from({ length: 65 }, (_, index) => row(index)),
        { owner: 7 },
      );
      await session.store.commit([
        {
          kind: 'toolRanking',
          policy,
          overlay: {
            async *measure(rows) {
              yield { ordinal: rows, block: 0, score: 100, saving: 99 };
              yield { ordinal: rows + 1, block: 0, score: 200, saving: 199 };
            },
          },
        },
      ]);
      await session.store.commit([
        { kind: 'checkpoint', id: 'ranked', name: 'ranked', createdAtMs: 42 },
      ]);
      const before = await session.store.snapshot();
      const expectedRanks = await ranked(before);
      const expectedPending = await ranked(before, true);
      const expectedRows = [];
      for await (const entry of before.entries())
        expectedRows.push({
          owner: entry.owner,
          label: entry.label,
          row: decodeStoredRow(await before.readRow(entry)),
        });
      const identity = {
        commitSeq: before.version?.commitSeq,
        groupTag: before.version?.groupTag,
      };
      await before.close();
      expect(await session.store.compact()).toBe('swapped');
      expect(session.store.published?.commitSeq).toBe(identity.commitSeq);
      expect(session.store.published?.groupTag).toBe(identity.groupTag);
      const after = await session.store.snapshot();
      try {
        const version = after.version;
        if (version === undefined) throw new Error('Missing compacted version');
        expect(await ranked(after)).toStrictEqual(expectedRanks);
        expect(await ranked(after, true)).toStrictEqual(expectedPending);
        expect(session.store.contextSpans()).toStrictEqual(
          Array.from({ length: 65 }, (_, index) => ({
            start: index * 4,
            end: index * 4 + 1,
          })),
        );
        const tree = await after.toolRanking(revision);
        const first = await tree.at((await tree.header()).root, 0);
        expect({
          ordinal: first.ordinal,
          score: first.score,
          saving: first.saving,
        }).toStrictEqual({ ordinal: 64, score: 66, saving: 65 });
        const actualRows = [];
        for await (const entry of after.entries())
          actualRows.push({
            owner: entry.owner,
            label: entry.label,
            row: decodeStoredRow(await after.readRow(entry)),
          });
        expect(actualRows).toStrictEqual(expectedRows);
        const checkpoint = await session.store.checkpoint('ranked');
        if (checkpoint === undefined)
          throw new Error('Missing copied checkpoint');
        const retained = await session.store.readVersion(
          checkpoint.trailerOffset,
        );
        expect(retained.rows).toBe(65);
        expect(retained.commitSeq).toBe(checkpoint.commitSeq);
        expect(retained.roots.rowRoot).toStrictEqual(version.roots.rowRoot);
        expect(retained.roots.idRoot).toStrictEqual(version.roots.idRoot);
      } finally {
        await after.close();
      }
    } finally {
      await session.close();
    }
  });
});
