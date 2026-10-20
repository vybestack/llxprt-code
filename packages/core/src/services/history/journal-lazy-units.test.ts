/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { streamJournalResponsePlans } from './journal-response-units.js';
import { JournalTailSource } from './journal-tail-source.js';
import {
  responsePlan,
  type JournalBlockReference,
  type JournalResponsePlan,
} from './journal-response-plan.js';
import { MEDIA_REFERENCE } from './__tests__/support/journalRowShapes.js';
import type { IContent } from './IContent.js';

async function verifyFirstBlock(
  plan: JournalResponsePlan,
  lengths: readonly number[],
): Promise<void> {
  const blocks = plan.openBlocks();
  try {
    const block = await blocks.next();
    if (block.done === true || block.value.type !== 'tool_response')
      throw new Error('Missing response block');
    expect({
      id: block.value.callId,
      length:
        typeof block.value.result === 'string' ? block.value.result.length : 0,
    }).toStrictEqual({ id: 'a', length: 131072 });
    expect(Math.max(...lengths)).toBe(
      Buffer.byteLength(
        JSON.stringify({ ...response('a'), result: 'a'.repeat(131072) }),
      ),
    );
  } finally {
    await blocks.return(undefined);
  }
}

describe('lazy native normalization block references', () => {
  const directory = useTempDir('journal-lazy-units-');
  it('holds only references for relocated responses until one block is consumed', async () => {
    const lengths: number[] = [];
    const base = testJournalSeams({}, 1, false).dependencies;
    const session = await JournalSession.create(`${directory()}/lazy.llxj`, {
      journal: {
        ...base,
        open: async (path, flags) => {
          const handle = await base.open(path, flags);
          return {
            ...handle,
            read: async (buffer, offset, length, position) => {
              lengths.push(length);
              return handle.read(buffer, offset, length, position);
            },
          };
        },
      },
    });
    const ids = ['a', 'b', 'c'];
    try {
      await session.append([
        { speaker: 'ai', blocks: ids.map((id) => call(id)) },
        ...ids.map(
          (id): IContent => ({
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'unrelated'.repeat(131072) },
              { ...response(id), result: id.repeat(131072) },
              MEDIA_REFERENCE,
            ],
          }),
        ),
      ]);
      const snapshot = await session.store.snapshot();
      const reader = streamJournalResponsePlans(snapshot);
      lengths.length = 0;
      try {
        const first = await reader.next();
        const next = await reader.next();
        if (first.done === true || next.done === true)
          throw new Error('Missing lazy units');
        expect({
          speaker: next.value.header.speaker,
          blocks: next.value.blocks.length,
          materialized: next.value.header.blocks.length,
        }).toStrictEqual({ speaker: 'tool', blocks: 6, materialized: 0 });
        expect(Math.max(...lengths)).toBeLessThan(65536);
        await verifyFirstBlock(next.value, lengths);
      } finally {
        await reader.return(undefined);
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
  it('fails on invalid block coordinates and mismatched response identities', async () => {
    const session = await JournalSession.create(`${directory()}/invalid.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([{ speaker: 'tool', blocks: [response('a')] }]);
      const snapshot = await session.store.snapshot();
      try {
        const source = await JournalTailSource.create(snapshot, []);
        const entry = await snapshot.entryAt(0);
        const at = { label: entry.label, part: 0, block: 0 };
        const refs: readonly JournalBlockReference[] = [
          { at, kind: 'response', id: 'wrong' },
          { at, kind: 'orphan', id: 'a' },
          { at, kind: 'reconstructed', id: 'wrong' },
          { at: { ...at, block: 99 }, kind: 'source' },
          { at: { ...at, part: 1 }, kind: 'source' },
          { at: { ...at, label: 99n }, kind: 'source' },
        ];
        for (const ref of refs) {
          const plan = responsePlan(
            source,
            { speaker: 'tool', blocks: [] },
            [ref],
            false,
          );
          await expect(plan.openBlocks().next()).rejects.toThrow(
            /source|fact/i,
          );
        }
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});
