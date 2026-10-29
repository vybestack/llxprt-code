/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import {
  decodeStoredBlock,
  encodeContentRow,
} from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import { ROW_BLOCK_TYPE } from './rowRecord.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import type { ToolRankingPolicy } from './tool-ranking-fill.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function row(value: number): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'same',
        toolName: 'read_file',
        result: value,
      },
    ],
  };
}
function policy(revision: string, direction = 1): ToolRankingPolicy {
  return {
    revision,
    measure: async (snapshot, entry, index) => {
      const block = decodeStoredBlock(
        await snapshot.readBlock(entry, index),
        ROW_BLOCK_TYPE.tool_response,
      );
      if (block.type !== 'tool_response' || typeof block.result !== 'number')
        throw new Error('Invalid invalidation fixture');
      return { score: direction * block.result, saving: 1 };
    },
  };
}
async function ordered(
  snapshot: VersionSnapshot,
  revision: string,
): Promise<number[]> {
  const tree = await snapshot.toolRanking(revision);
  const header = await tree.header();
  const values: number[] = [];
  for await (const rank of tree.ordered(header.root)) values.push(rank.ordinal);
  return values;
}
async function current(
  session: JournalSession,
  revision: string,
): Promise<number[]> {
  const snapshot = await session.store.snapshot();
  try {
    return await ordered(snapshot, revision);
  } finally {
    await snapshot.close();
  }
}

describe('native tool ranking invalidation', () => {
  const directory = useTempDir('tool-ranking-invalidation-');
  it('rebuilds a policy requested in the same group as rewritten rows and a pop while old pins stay unchanged', async () => {
    const session = await JournalSession.create(
      join(directory(), 'mixed.llxj'),
    );
    const registration = policy('mixed:1');
    try {
      await session.append([row(10), row(20), row(30)]);
      await session.store.commit([
        { kind: 'toolRanking', policy: registration },
      ]);
      const saved = await session.store.snapshot();
      try {
        const first = await saved.entryAt(0);
        const last = await saved.entryAt(2);
        await session.store.commit([
          {
            kind: 'purge',
            rows: [
              {
                label: first.label,
                draft: encodeContentRow(row(100), { owner: 0 }),
              },
            ],
          },
          { kind: 'toolRanking', policy: registration },
        ]);
        expect(await current(session, registration.revision)).toStrictEqual([
          0, 2, 1,
        ]);
        expect(await ordered(saved, registration.revision)).toStrictEqual([
          2, 1, 0,
        ]);
        await session.store.commit([
          { kind: 'pop', cutLabel: last.label, expectedRemoved: 1 },
          { kind: 'toolRanking', policy: registration },
        ]);
        expect(await current(session, registration.revision)).toStrictEqual([
          0, 1,
        ]);
        expect(await ordered(saved, registration.revision)).toStrictEqual([
          2, 1, 0,
        ]);
      } finally {
        await saved.close();
      }
      await session.store.commit([
        { kind: 'toolRanking', policy: policy('mixed:2', -1) },
      ]);
      expect(await current(session, 'mixed:2')).toStrictEqual([1, 0]);
      const replacement = await session.store.snapshot();
      try {
        await expect(replacement.toolRanking('mixed:1')).rejects.toThrow(
          'requires a fill',
        );
      } finally {
        await replacement.close();
      }
      const clone = await session.cloneUnlinked();
      try {
        expect(await current(clone, 'mixed:2')).toStrictEqual([1, 0]);
      } finally {
        await clone.close();
      }
      await session.store.compact();
      expect(await current(session, 'mixed:2')).toStrictEqual([1, 0]);
    } finally {
      await session.close();
    }
  }, 180_000);
});
