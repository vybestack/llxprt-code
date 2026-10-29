/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { BoundedIdNodeCache } from '../../journal/idTrieCache.js';
import { sha256KeyHash } from '../../journal/idKeys.js';
import { PinLease, PinnedRead } from '../../journal/pinLease.js';
import { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { RECORD_KIND } from '../../journal/recordKinds.js';
import { decodeRowHeader } from '../../journal/rowRecord.js';
import type { RecordAccess } from '../../journal/recordAccess.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import {
  digest,
  frozenUnits,
} from './__tests__/support/normalization-oracle.js';
import type { IContent } from './IContent.js';
import { assertPersistedOccurrences } from './__tests__/support/persisted-occurrence-oracle.js';

async function measured(session: JournalSession): Promise<{
  readonly snapshot: VersionSnapshot;
  readonly stats: {
    heads: number;
    blocks: number;
    bodies: number;
    rows: Set<number>;
  };
}> {
  const read = await session.store.openRead();
  const stats = { heads: 0, blocks: 0, bodies: 0, rows: new Set<number>() };
  const raw = read.access;
  const access: RecordAccess = {
    recordError: raw.recordError,
    readRecordHead(offset, what, prefetch) {
      stats.heads++;
      if (what === 'ROW') stats.rows.add(offset);
      return raw.readRecordHead(offset, what, prefetch);
    },
    readRecordStart(offset, what, prefetch) {
      stats.heads++;
      if (what === 'ROW') stats.rows.add(offset);
      return raw.readRecordStart(offset, what, prefetch);
    },
    readRecordRange(head, offset, length) {
      if (head.kind === RECORD_KIND.ROW) {
        const header = decodeRowHeader(head.kindHeader);
        if (length > 0 && offset >= header.idsLen + header.metaLen)
          stats.blocks++;
      }
      return raw.readRecordRange(head, offset, length);
    },
    readRecordBody(head, chunkBytes, what) {
      if (head.kind === RECORD_KIND.ROW) stats.bodies++;
      return raw.readRecordBody(head, chunkBytes, what);
    },
  };
  const snapshot = new VersionSnapshot(
    new PinnedRead(read.version, access, new PinLease(() => read.close())),
    {
      hasher: sha256KeyHash,
      occurrenceSpace: 'source',
      normalizers: { openai: (id) => id, anthropic: (id) => id },
    },
    new BoundedIdNodeCache(),
    session.store.sortedLabels,
  );
  return { snapshot, stats };
}

async function verifyCurrent(
  session: JournalSession,
  tail: readonly IContent[] = [],
): Promise<void> {
  await assertPersistedOccurrences(session);
  const rows: IContent[] = [];
  for await (const row of session.rows()) rows.push(row.content);
  const expected = frozenUnits({ id: 'mutation', rows, tail });
  const native = await session.store.snapshot();
  const indexed = await IndexedJournalRequestSnapshot.create(native, tail);
  try {
    const actual: IContent[] = [];
    for await (const row of indexed.openReader()) actual.push(row);
    expect({
      count: indexed.count,
      hash: digest(actual),
      first: indexed.pending.firstOutputIndex,
    }).toStrictEqual({
      count: expected.count,
      hash: expected.outputHash,
      first: expected.firstOutputIndex,
    });
    for (let index = 0; index < actual.length; index++) {
      expect(await indexed.readAt(index)).toStrictEqual(actual[index]);
      expect(indexed.isPending(index)).toBe(expected.pending[index]);
    }
  } finally {
    await indexed.close();
    await native.close();
  }
}

function draft(content: IContent): RowDraft {
  return encodeContentRow(content, { owner: 7 });
}

describe('indexed metadata native mutation and read bounds', () => {
  const directory = useTempDir('indexed-metadata-');

  for (const size of [40, 4000]) {
    it(`updates only affected unit paths when one response follows ${size} distinct calls`, async () => {
      const reads = { reads: 0 };
      const session = await JournalSession.create(
        `${directory()}/append-${size}.llxj`,
        {
          journal: testJournalSeams({ readCounter: reads }, size, false)
            .dependencies,
        },
      );
      try {
        function* rows(): Generator<RowDraft> {
          for (let index = 0; index < size; index++)
            yield draft({ speaker: 'ai', blocks: [call(`id-${index}`)] });
        }
        await session.store.commit([{ kind: 'replace', rows: rows() }]);
        const before = session.store.published;
        reads.reads = 0;
        await session.append([{ speaker: 'tool', blocks: [response('id-0')] }]);
        expect(session.store.published?.aggregate.units).toBe(size * 2);
        expect(reads.reads).toBeLessThan(150);
        expect(before?.aggregate.units).toBe(size * 2);
        const native = await session.store.snapshot();
        const indexed = await IndexedJournalRequestSnapshot.create(native);
        try {
          expect((await indexed.readAt(1)).blocks).toStrictEqual([
            response('id-0'),
          ]);
          expect(indexed.count).toBe(size * 2);
        } finally {
          await indexed.close();
          await native.close();
        }
      } finally {
        await session.close();
      }
    }, 120000);
  }

  it('reads a selected self unit without opening its successor source row', async () => {
    const session = await JournalSession.create(
      `${directory()}/self-unit.llxj`,
      {
        journal: testJournalSeams().dependencies,
      },
    );
    const rows: readonly IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'selected' }],
        metadata: {},
      },
      { speaker: 'ai', blocks: [call('successor')], metadata: {} },
      { speaker: 'tool', blocks: [response('successor')], metadata: {} },
    ];
    try {
      await session.append(rows);
      const { snapshot, stats } = await measured(session);
      const indexed = await IndexedJournalRequestSnapshot.create(snapshot);
      try {
        const selected = await snapshot.entryAt(0);
        stats.rows.clear();
        expect(await indexed.readAt(0)).toStrictEqual(rows[0]);
        expect([...stats.rows]).toStrictEqual([selected.recordOffset]);
        stats.rows.clear();
        const next = await snapshot.entryAt(1);
        expect(await indexed.readAt(1)).toStrictEqual(rows[1]);
        expect([...stats.rows]).toStrictEqual([next.recordOffset]);
        expect((await indexed.readAt(2)).blocks).toStrictEqual(rows[2].blocks);
      } finally {
        await indexed.close();
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('represents an empty uncommitted journal without a row read', async () => {
    const session = await JournalSession.create(`${directory()}/empty.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      const native = await session.store.snapshot();
      const indexed = await IndexedJournalRequestSnapshot.create(native);
      try {
        expect(indexed.count).toBe(0);
        expect(indexed.pending.firstOutputIndex).toBeUndefined();
        expect(await native.unitsBelow(1n)).toBe(0);
        await expect(native.unitAt(0)).rejects.toThrow(RangeError);
        await expect(indexed.readAt(0)).rejects.toThrow(RangeError);
      } finally {
        await indexed.close();
        await native.close();
      }
    } finally {
      await session.close();
    }
  });

  it('preserves counts across append, pop, owner, fill, purge, density, compression, clone and compaction', async () => {
    const session = await JournalSession.create(
      `${directory()}/mutation.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([{ speaker: 'human', blocks: [call('a')] }], {
        owner: 7,
      });
      const pinned = await session.store.snapshot();
      expect(pinned.units).toBe(1);
      await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
      await verifyCurrent(session);
      expect(pinned.units).toBe(1);
      expect((await pinned.unitAt(0)).unit).toBe(0);
      await pinned.close();
      await session.append([{ speaker: 'tool', blocks: [response('a')] }]);
      await verifyCurrent(session);
      const native = await session.store.snapshot();
      const first = await native.entryAt(0);
      const last = await native.entryAt(2);
      await native.close();
      await session.store.commit([
        { kind: 'pop', cutLabel: last.label, expectedRemoved: 1 },
      ]);
      await verifyCurrent(session);
      await session.store.commit([
        { kind: 'owner', changes: [{ label: first.label, owner: 9 }] },
      ]);
      await session.store.commit([
        {
          kind: 'fill',
          fills: [
            {
              label: first.label,
              tokens: [
                [3, 0, 0, 0],
                [0, 0, 0, 0],
                [0, 0, 0, 0],
              ],
            },
          ],
        },
      ]);
      await verifyCurrent(session, [
        { speaker: 'tool', blocks: [response('a')] },
      ]);
      await session.store.commit([
        {
          kind: 'purge',
          rows: [
            {
              label: first.label,
              draft: draft({
                speaker: 'human',
                blocks: [call('a'), { type: 'text', text: 'purged' }],
              }),
            },
          ],
        },
      ]);
      await verifyCurrent(session);
      await session.store.commit([
        {
          kind: 'density',
          replacements: [
            {
              label: first.label,
              draft: draft({
                speaker: 'tool',
                blocks: [response('b'), response('b')],
              }),
            },
          ],
          removed: [],
        },
      ]);
      await verifyCurrent(session);
      await session.store.commit([
        {
          kind: 'compress',
          retainFromLabel: 2097152n,
          expectedReplaced: 1,
          summary: draft({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'summary' }],
          }),
        },
      ]);
      await verifyCurrent(session);
      const clone = await session.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        await verifyCurrent(clone);
      } finally {
        await clone.close();
      }
      expect(await session.store.compact()).toBe('swapped');
      await verifyCurrent(session);
    } finally {
      await session.close();
    }
  });

  for (const size of [40, 4000, 100000]) {
    it(`queries ${size} rows with bounded metadata reads and no block/body reads`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${size}.llxj`,
        { journal: testJournalSeams({}, size, false).dependencies },
      );
      try {
        function* rows(): Generator<RowDraft> {
          yield draft({ speaker: 'human', blocks: [call('pending')] });
          for (let index = 1; index < size; index++)
            yield draft({
              speaker: 'human',
              blocks: [{ type: 'text', text: `not-read-${index}` }],
            });
        }
        await session.store.commit([{ kind: 'replace', rows: rows() }]);
        const { snapshot, stats } = await measured(session);
        const indexed = await IndexedJournalRequestSnapshot.create(snapshot, [
          { speaker: 'ai', blocks: [call('pending')] },
        ]);
        try {
          expect(indexed.count).toBe(size + 2);
          expect(indexed.pending.firstOutputIndex).toBe(1);
          expect(indexed.isPending(0)).toBe(false);
          expect(indexed.isPending(1)).toBe(true);
          expect(indexed.isPending(size + 1)).toBe(true);
          expect(stats.heads).toBeLessThan(120);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 0,
            bodies: 0,
          });
          stats.heads = 0;
          expect((await snapshot.unitAt(size - 1)).unit).toBe(0);
          expect(await snapshot.unitsBelow(2n ** 63n)).toBe(size);
          expect(stats.heads).toBeLessThan(20);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 0,
            bodies: 0,
          });
          stats.heads = 0;
          expect((await indexed.readAt(size - 1)).blocks).toStrictEqual([
            { type: 'text', text: `not-read-${size - 2}` },
          ]);
          expect(stats.heads).toBeLessThan(60);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 1,
            bodies: 0,
          });
        } finally {
          await indexed.close();
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    }, 120000);
  }

  it('owns the tail and holds the native pin until close without persisting pending input', async () => {
    const session = await JournalSession.create(`${directory()}/pin.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
      const native = await session.store.snapshot();
      const payload = { result: 'owned' };
      const indexed = await IndexedJournalRequestSnapshot.create(native, [
        { speaker: 'tool', blocks: [{ ...response('a'), result: payload }] },
      ]);
      await native.close();
      payload.result = 'mutated';
      expect((await indexed.readAt(1)).blocks).toStrictEqual([
        { ...response('a'), result: { result: 'owned' } },
      ]);
      expect(session.store.published?.rows).toBe(1);
      await indexed.close();
      expect(() => indexed.isPending(0)).toThrow('closed');
      await expect(indexed.readAt(0)).rejects.toThrow('closed');
      await expect(native.facts.fact('a')).rejects.toThrow('pin was released');
    } finally {
      await session.close();
    }
  });
});
