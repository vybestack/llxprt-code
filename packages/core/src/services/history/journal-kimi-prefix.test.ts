/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { OffsetAudit } from '../../journal/__tests__/support/offsetAudit.js';
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

async function checkFallbackState(
  session: JournalSession,
  expected: number,
): Promise<void> {
  const pin = await session.store.snapshot();
  try {
    let below = 0;
    for await (const entry of pin.entries()) {
      expect(await pin.kimiUnmappedBelow(entry.label)).toBe(below);
      below += entry.unmappedBlocks;
    }
    expect({
      consumed: await pin.kimiUnmappedCount(),
      rows: below,
      written: await pin.kimiUnmappedWrittenCount(),
      digits: await pin.kimiWrittenDigits(),
    }).toStrictEqual({
      consumed: expected,
      rows: expected,
      written: expected / 2,
      digits: expected / 2,
    });
  } finally {
    await pin.close();
  }
}

async function auditFallbackCopy(session: JournalSession): Promise<void> {
  const read = await session.store.openRead();
  try {
    if (read.version === undefined) throw new Error('Missing copied version');
    await new OffsetAudit(read.access).walkVersion(read.version);
  } finally {
    await read.close();
  }
}

describe('persisted Kimi fallback prefix changes', () => {
  const directory = useTempDir('kimi-prefix-');
  it('preserves nonzero prefixes through owner, reopen, fork, compaction, density, pop and compression', async () => {
    const path = `${directory()}/lifecycle.llxj`;
    const options = { journal: testJournalSeams().dependencies };
    const session = await JournalSession.create(path, options);
    const row = (id: string): ReturnType<typeof encodeContentRow> =>
      encodeContentRow(
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'keep' }, call(id, '')],
        },
        { owner: 0 },
      );
    try {
      await session.store.commit([
        { kind: 'replace', rows: [row('a'), row('b')] },
      ]);
      await session.store.commit([{ kind: 'kimi' }]);
      await session.store.commit([
        { kind: 'owner', changes: [{ label: 1048576n, owner: 7 }] },
      ]);
      await checkFallbackState(session, 4);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, options);
    try {
      const old = await reopened.store.snapshot();
      try {
        const clone = await reopened.cloneUnlinked({
          unlinkedDirectory: directory(),
        });
        try {
          expect(await clone.store.compact()).toBe('swapped');
          await checkFallbackState(clone, 4);
          await auditFallbackCopy(clone);
          await clone.store.commit([
            { kind: 'density', replacements: [], removed: [1048576n] },
          ]);
          await checkFallbackState(clone, 2);
        } finally {
          await clone.close();
        }
        await reopened.store.commit([
          { kind: 'pop', cutLabel: 2097152n, expectedRemoved: 1 },
        ]);
        await checkFallbackState(reopened, 2);
        expect(await old.kimiUnmappedCount()).toBe(4);
      } finally {
        await old.close();
      }
      expect(await reopened.store.compact()).toBe('swapped');
      await checkFallbackState(reopened, 2);
      await reopened.store.commit([
        { kind: 'replace', rows: [row('a'), row('b'), row('c')] },
      ]);
      const pin = await reopened.store.snapshot();
      const cut = (await pin.entryAt(2)).label;
      await pin.close();
      await reopened.store.commit([
        {
          kind: 'compress',
          retainFromLabel: cut,
          expectedReplaced: 2,
          summary: encodeContentRow(
            { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
            { owner: 0 },
          ),
        },
      ]);
      await checkFallbackState(reopened, 2);
    } finally {
      await reopened.close();
    }
  });
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
