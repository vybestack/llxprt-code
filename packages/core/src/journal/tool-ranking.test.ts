/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { JournalSession } from '../services/history/journalSession.js';
import {
  decodeStoredBlock,
  encodeContentRow,
} from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import type { ToolRankingPolicy } from './tool-ranking-fill.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import { ROW_BLOCK_TYPE } from './rowRecord.js';

function row(value: number, id = ''): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: id,
        toolName: 'read_file',
        result: value,
      },
    ],
  };
}
function policy(
  revision: string,
  observe: () => void = () => {},
): ToolRankingPolicy {
  return {
    revision,
    measure: async (snapshot, entry, index) => {
      observe();
      const block = decodeStoredBlock(
        await snapshot.readBlock(entry, index),
        ROW_BLOCK_TYPE.tool_response,
      );
      if (block.type !== 'tool_response' || typeof block.result !== 'number')
        throw new Error('Invalid ranking fixture');
      return { score: block.result, saving: block.result - 1 };
    },
  };
}
async function values(
  snapshot: VersionSnapshot,
  revision: string,
): Promise<readonly number[]> {
  const tree = await snapshot.toolRanking(revision);
  const header = await tree.header();
  const result: number[] = [];
  for await (const rank of tree.ordered(header.root)) result.push(rank.ordinal);
  return result;
}
async function current(
  session: JournalSession,
  revision: string,
): Promise<readonly number[]> {
  const snapshot = await session.store.snapshot();
  try {
    return await values(snapshot, revision);
  } finally {
    await snapshot.close();
  }
}

describe('versioned native tool ranking', () => {
  const directory = useTempDir('native-tool-ranking-');
  it('preserves rank ties, float scores and old pins through append, rewrite, clone, compaction and reopen', async () => {
    const path = join(directory(), 'ranking.llxj');
    const session = await JournalSession.create(path);
    let measured = 0;
    const registration = policy('rank:1', () => {
      measured++;
    });
    try {
      await session.append([row(2.5), row(10), row(10), row(0.5)]);
      await session.store.commit([
        { kind: 'toolRanking', policy: registration },
      ]);
      expect(measured).toBe(4);
      expect(await current(session, 'rank:1')).toStrictEqual([2, 1, 0, 3]);
      const saved = await session.store.snapshot();
      try {
        const tree = await saved.toolRanking('rank:1');
        const header = await tree.header();
        expect((await tree.at(header.root, 0)).ordinal).toBe(2);
        expect(header.saving).toBe(19.5);
        await expect(saved.toolRanking('rank:wrong')).rejects.toThrow(
          'requires a fill',
        );
        const before = (await stat(path)).size;
        const sequence = session.store.published?.commitSeq;
        await session.store.commit([
          { kind: 'toolRanking', policy: registration },
        ]);
        expect((await stat(path)).size - before).toBe(0);
        expect(session.store.published?.commitSeq).toBe(sequence);
        await session.append([row(10, 'raw/1')]);
        expect(measured).toBe(5);
        expect(await current(session, 'rank:1')).toStrictEqual([4, 2, 1, 0, 3]);
        const first = await saved.entryAt(0);
        await session.store.commit([
          {
            kind: 'purge',
            rows: [
              {
                label: first.label,
                draft: encodeContentRow(row(20), { owner: 0 }),
              },
            ],
          },
        ]);
        expect(await current(session, 'rank:1')).toStrictEqual([0, 4, 2, 1, 3]);
        expect(await values(saved, 'rank:1')).toStrictEqual([2, 1, 0, 3]);
        const clone = await session.cloneUnlinked();
        try {
          expect(await current(clone, 'rank:1')).toStrictEqual([0, 4, 2, 1, 3]);
        } finally {
          await clone.close();
        }
      } finally {
        await saved.close();
      }
      await session.store.compact();
      expect(await current(session, 'rank:1')).toStrictEqual([0, 4, 2, 1, 3]);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path);
    try {
      const before = (await stat(path)).size;
      await reopened.store.commit([
        { kind: 'toolRanking', policy: registration },
      ]);
      expect((await stat(path)).size - before).toBe(0);
      expect(await current(reopened, 'rank:1')).toStrictEqual([0, 4, 2, 1, 3]);
      await reopened.store.commit([{ kind: 'clear' }]);
      expect(await current(reopened, 'rank:1')).toStrictEqual([]);
    } finally {
      await reopened.close();
    }
  }, 180_000);

  it('discards a partially filled policy and lets the same writer continue', async () => {
    const session = await JournalSession.create(
      join(directory(), 'failure.llxj'),
    );
    const failure = new Error('ranking measurement rejected');
    try {
      await session.append(
        Array.from({ length: 65 }, (_, value) => row(value)),
      );
      await session.store.commit([
        { kind: 'toolRanking', policy: policy('good:1') },
      ]);
      const original = policy('bad:1');
      const failing: ToolRankingPolicy = {
        revision: original.revision,
        measure: async (snapshot, entry, block) => {
          if ((await snapshot.rowsBelow(entry.label)) === 64) throw failure;
          return original.measure(snapshot, entry, block);
        },
      };
      await expect(
        session.store.commit([{ kind: 'toolRanking', policy: failing }]),
      ).rejects.toBe(failure);
      const snapshot = await session.store.snapshot();
      try {
        await expect(snapshot.toolRanking('bad:1')).rejects.toThrow(
          'requires a fill',
        );
        expect((await values(snapshot, 'good:1')).length).toBe(65);
      } finally {
        await snapshot.close();
      }
      await session.append([row(1000)]);
      expect((await current(session, 'good:1'))[0]).toBe(65);
    } finally {
      await session.close();
    }
  }, 180_000);
});
