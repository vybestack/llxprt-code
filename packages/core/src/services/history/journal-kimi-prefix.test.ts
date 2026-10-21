/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { KIMI_FLAG } from '../../journal/kimiFactCodec.js';

async function fallbackIndices(
  pin: VersionSnapshot,
  id: string,
): Promise<number[]> {
  const indices: number[] = [];
  for await (const holder of pin.kimiHolders(id))
    if ((holder.flags & KIMI_FLAG.unmapped) !== 0)
      indices.push(await pin.kimiFallbackIndex(holder));
  return indices;
}

describe('persisted Kimi fallback prefix changes', () => {
  const directory = useTempDir('kimi-prefix-');
  it('replaces every earlier fallback holder and other IDs row ranks when an append first maps an ID', async () => {
    const session = await JournalSession.create(`${directory()}/append.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'keep' },
            call('x', ''),
            call('y', ''),
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'keep' },
            call('x', ''),
            call('z', ''),
          ],
        },
      ]);
      const old = await session.store.snapshot();
      try {
        expect(await fallbackIndices(old, 'y')).toStrictEqual([1, 3]);
        expect(await fallbackIndices(old, 'z')).toStrictEqual([5, 6]);
        expect((await old.entryAt(0)).unmappedBlocks).toBe(4);
        await session.append([
          { speaker: 'human', blocks: [call('x', 'named')] },
        ]);
        const current = await session.store.snapshot();
        try {
          expect(await current.kimiUnmappedCount()).toBe(4);
          expect(current.version?.aggregate.unmappedBlocks).toBe(4);
          expect(await fallbackIndices(current, 'x')).toStrictEqual([]);
          expect(await fallbackIndices(current, 'y')).toStrictEqual([1, 2]);
          expect(await fallbackIndices(current, 'z')).toStrictEqual([3, 4]);
          expect(
            await current.kimiUnmappedBelow((await current.entryAt(1)).label),
          ).toBe(2);
          expect(await current.kimiWrittenDigits()).toBe(5);
          expect(await fallbackIndices(old, 'z')).toStrictEqual([5, 6]);
        } finally {
          await current.close();
        }
      } finally {
        await old.close();
      }
    } finally {
      await session.close();
    }
  });

  it('keeps a response-only pending update in its earlier unit without changing counter prefixes', async () => {
    const session = await JournalSession.create(
      `${directory()}/response.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'keep' }, call('x', '')],
        },
      ]);
      await session.store.commit([{ kind: 'kimi' }]);
      await session.append([{ speaker: 'tool', blocks: [response('x')] }]);
      const pin = await session.store.snapshot();
      try {
        expect(await pin.kimiUnmappedCount()).toBe(2);
        expect(await pin.kimiUnmappedWrittenCount()).toBe(1);
        expect(await pin.kimiWrittenDigits()).toBe(1);
        expect(await fallbackIndices(pin, 'x')).toStrictEqual([0, 1]);
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
