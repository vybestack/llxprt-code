/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { IdTrieReader } from './idTrieReader.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { ROW_SPEAKER } from './rowRecord.js';
import type { StoredRow } from './rowReads.js';
import type { RowDraft } from './rowDraft.js';
import { JournalSession } from '../services/history/journalSession.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import {
  draftRow,
  labelsOf,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function factBytes(store: JournalStore): Promise<string[]> {
  const read = await store.openRead();
  try {
    const reader = new IdTrieReader(read.access, new BoundedIdNodeCache());
    const entries: string[] = [];
    for await (const entry of reader.entries(read.version?.roots.idRoot ?? 0))
      entries.push(
        `${Buffer.from(entry.hash).toString('hex')}:${Buffer.from(entry.value).toString('hex')}`,
      );
    return entries;
  } finally {
    await read.close();
  }
}

async function rowBytes(store: JournalStore): Promise<StoredRow[]> {
  const snapshot = await store.snapshot();
  try {
    const rows: StoredRow[] = [];
    for await (const entry of snapshot.entries())
      rows.push(await snapshot.readRow(entry));
    return rows;
  } finally {
    await snapshot.close();
  }
}

describe('restored prefix read cost', () => {
  const directory = useTempDir('restored-prefix-cost-');

  it.each([512, 8192])(
    'reuses stored facts for %i prefix rows when a pop retains two rows of an append group',
    async (size) => {
      const counter = { reads: 0 };
      const store = await JournalStore.create(
        join(directory(), `actual-${size}.llxj`),
        storeDeps({
          seams: testJournalSeams({ readCounter: counter }, 1, false),
        }),
      );
      const expected = await JournalStore.create(
        join(directory(), `expected-${size}.llxj`),
        storeDeps(),
      );
      const prefix = Array.from({ length: size }, (_, index) =>
        draftRow({
          speaker: ROW_SPEAKER.ai,
          calls: [`call-${index}`],
          chronologySeq: BigInt(index),
        }),
      );
      const tail = [
        draftRow({
          speaker: ROW_SPEAKER.tool,
          responses: [`call-${size - 1}`],
        }),
        draftRow({ speaker: ROW_SPEAKER.ai, calls: ['tail'] }),
        draftRow({ speaker: ROW_SPEAKER.tool, responses: ['tail'] }),
      ];
      try {
        await store.commit([{ kind: 'append', rows: prefix }]);
        await expected.commit([{ kind: 'append', rows: prefix }]);
        await store.commit([{ kind: 'append', rows: tail }]);
        await expected.commit([{ kind: 'append', rows: tail.slice(0, 2) }]);
        const before = await store.snapshot();
        try {
          const cut = await before.entryAt(size + 2);
          const readsBefore = counter.reads;
          await store.commit([
            { kind: 'pop', cutLabel: cut.label, expectedRemoved: 1 },
          ]);
          const reads = counter.reads - readsBefore;
          process.stdout.write(
            `RESTORED_PREFIX_COST ${JSON.stringify({ size, reads })}\n`,
          );
          expect(reads).toBeLessThanOrEqual(512);
          expect(store.published?.aggregate).toStrictEqual(
            expected.published?.aggregate,
          );
          expect(await factBytes(store)).toStrictEqual(
            await factBytes(expected),
          );
          expect(await rowBytes(store)).toStrictEqual(await rowBytes(expected));
        } finally {
          await before.close();
        }
      } finally {
        await store.close();
        await expected.close();
      }
    },
    180000,
  );

  it('keeps allocated labels when a pop and append share a group', async () => {
    const store = await JournalStore.create(
      join(directory(), 'pop-and-append.llxj'),
      storeDeps(),
    );
    try {
      await store.commit([{ kind: 'append', rows: [draftRow()] }]);
      await store.commit([
        { kind: 'append', rows: [draftRow(), draftRow(), draftRow()] },
      ]);
      const before = await store.snapshot();
      try {
        const first = await before.entryAt(0);
        const second = await before.entryAt(1);
        const cut = await before.entryAt(2);
        const next = before.version?.nextLabel;
        if (next === undefined) throw new Error('Missing label allocation');
        await store.commit([
          { kind: 'pop', cutLabel: cut.label, expectedRemoved: 2 },
          { kind: 'append', rows: [draftRow({ text: 'after pop' })] },
        ]);
        const after = await store.snapshot();
        try {
          expect(await labelsOf(store)).toStrictEqual([
            first.label,
            second.label,
            next,
          ]);
          expect((await after.entryAt(1)).recordOffset).toBe(
            second.recordOffset,
          );
        } finally {
          await after.close();
        }
      } finally {
        await before.close();
      }
    } finally {
      await store.close();
    }
  });

  it('preserves normalized occurrence lists when retained responses change prefix contributions', async () => {
    const actual = await JournalSession.create(
      join(directory(), 'normalized-actual.llxj'),
      { journal: testJournalSeams().dependencies },
    );
    const reference = await JournalSession.create(
      join(directory(), 'normalized-reference.llxj'),
      { journal: testJournalSeams().dependencies },
    );
    const prefix: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'call:first', name: 'read', parameters: {} },
        ],
      },
    ];
    const tail: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call:first',
            toolName: 'read',
            result: 'first',
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'call:tail', name: 'read', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call:tail',
            toolName: 'read',
            result: 'removed',
          },
        ],
      },
    ];
    const drafts = (rows: readonly IContent[]): RowDraft[] =>
      rows.map((row) => encodeContentRow(row, { owner: 0 }));
    try {
      await actual.store.commit([{ kind: 'append', rows: drafts(prefix) }]);
      await reference.store.commit([{ kind: 'append', rows: drafts(prefix) }]);
      await actual.store.commit([{ kind: 'append', rows: drafts(tail) }]);
      await reference.store.commit([
        { kind: 'append', rows: drafts(tail.slice(0, 2)) },
      ]);
      const labels = await labelsOf(actual.store);
      await actual.store.commit([
        { kind: 'pop', cutLabel: labels[4], expectedRemoved: 1 },
      ]);
      expect(await factBytes(actual.store)).toStrictEqual(
        await factBytes(reference.store),
      );
      expect(actual.store.published?.aggregate).toStrictEqual(
        reference.store.published?.aggregate,
      );
      expect(await rowBytes(actual.store)).toStrictEqual(
        await rowBytes(reference.store),
      );
    } finally {
      await actual.close();
      await reference.close();
    }
  });
});
