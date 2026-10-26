/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import {
  draftRow,
  labelsOf,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function page(
  path: string,
  direction: 'forward' | 'backward' = 'forward',
  fromId?: bigint,
) {
  const journal = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(journal, sha256KeyHash);
    const entries = await reader.page({ direction, fromId, limit: 50 });
    const rows: string[] = [];
    for (const entry of entries) {
      if (entry.rowRef !== 0) {
        const row = await reader.readRow(entry);
        rows.push(new TextDecoder().decode(row.blocks[0]));
      }
    }
    const membership = await reader.membership(
      entries.map((entry) => entry.transcriptId),
    );
    return { entries, rows, counts: membership.map((member) => member.count) };
  } finally {
    await journal.close();
  }
}

describe('complete transcript', () => {
  const dir = useTempDir('journal-transcript-');

  it('keeps originals and replacements addressable while membership follows compression, pop, density, purge and clear', async () => {
    const path = join(dir(), 'history.llxj');
    const store = await JournalStore.create(path, storeDeps());
    try {
      await store.commit([
        {
          kind: 'append',
          rows: ['ORIGINAL-1', 'ORIGINAL-2'].map((text) => draftRow({ text })),
        },
      ]);
      await store.commit([
        { kind: 'append', rows: [draftRow({ text: 'retained' })] },
      ]);
      const labels = await labelsOf(store);
      await store.commit([
        {
          kind: 'compress',
          retainFromLabel: labels[2],
          expectedReplaced: 2,
          summary: draftRow({ text: 'SUMMARY' }),
        },
      ]);
      expect((await page(path)).rows).toStrictEqual([
        'ORIGINAL-1',
        'ORIGINAL-2',
        'retained',
        'SUMMARY',
      ]);
      expect((await page(path)).counts).toStrictEqual([0, 0, 1, 1]);
      await store.commit([
        { kind: 'pop', cutLabel: labels[2], expectedRemoved: 1 },
      ]);
      expect((await page(path)).rows).toStrictEqual([
        'ORIGINAL-1',
        'ORIGINAL-2',
        'retained',
        'SUMMARY',
      ]);
      const [summary] = await labelsOf(store);
      await store.commit([
        {
          kind: 'density',
          replacements: [
            { label: summary, draft: draftRow({ text: 'dense' }) },
          ],
          removed: [],
        },
      ]);
      const dense = await page(path);
      expect(dense.rows).toStrictEqual([
        'ORIGINAL-1',
        'ORIGINAL-2',
        'retained',
        'SUMMARY',
        'dense',
      ]);
      expect(
        dense.entries
          .filter((entry) => entry.rowRef !== 0)
          .map((entry, index) => [
            entry.transcriptId,
            dense.counts[dense.entries.indexOf(entry)],
            index,
          ]),
      ).toStrictEqual([
        [1n, 0, 0],
        [2n, 0, 1],
        [3n, 0, 2],
        [4n, 0, 3],
        [6n, 1, 4],
      ]);
      expect(dense.entries[dense.entries.length - 1]?.supersedesId).toBe(4n);
      await store.commit([
        {
          kind: 'purge',
          rows: [{ label: summary, draft: draftRow({ text: 'purged' }) }],
        },
      ]);
      const purged = (await page(path)).rows;
      expect(purged[purged.length - 1]).toBe('purged');
      await store.commit([{ kind: 'clear' }]);
      expect((await page(path)).counts.every((count) => count === 0)).toBe(
        true,
      );
    } finally {
      await store.close();
    }
    const reopened = await JournalStore.open(path, storeDeps());
    await reopened.close();
    expect((await page(path, 'backward')).rows).toStrictEqual([
      'purged',
      'dense',
      'SUMMARY',
      'retained',
      'ORIGINAL-2',
      'ORIGINAL-1',
    ]);
    expect((await page(path, 'forward', 2n)).rows.slice(0, 2)).toStrictEqual([
      'ORIGINAL-2',
      'retained',
    ]);
  });

  it('records coalesced admissions in caller order even when context inserts before them', async () => {
    const path = join(dir(), 'admission-order.llxj');
    const store = await JournalStore.create(path, storeDeps());
    try {
      await store.commit([
        { kind: 'append', rows: [draftRow({ text: 'seed' })] },
      ]);
      const [label] = await labelsOf(store);
      await store.commit([
        { kind: 'append', rows: [draftRow({ text: 'tail-first' })] },
        {
          kind: 'insert',
          afterLabel: label,
          draft: draftRow({ text: 'middle-second' }),
        },
      ]);
      expect((await page(path)).rows).toStrictEqual([
        'seed',
        'tail-first',
        'middle-second',
      ]);
      expect((await page(path)).counts).toStrictEqual([1, 1, 1]);
    } finally {
      await store.close();
    }
  });

  it('records replacement arrays in caller order rather than context label order', async () => {
    const path = join(dir(), 'replacement-order.llxj');
    const store = await JournalStore.create(path, storeDeps());
    try {
      await store.commit([
        {
          kind: 'append',
          rows: ['first', 'second'].map((text) => draftRow({ text })),
        },
      ]);
      const labels = await labelsOf(store);
      await store.commit([
        {
          kind: 'density',
          removed: [],
          replacements: [
            {
              label: labels[1],
              draft: draftRow({ text: 'second-replacement' }),
            },
            {
              label: labels[0],
              draft: draftRow({ text: 'first-replacement' }),
            },
          ],
        },
      ]);
      expect((await page(path)).rows).toStrictEqual([
        'first',
        'second',
        'second-replacement',
        'first-replacement',
      ]);
      expect((await page(path)).counts).toStrictEqual([0, 0, 1, 1]);
    } finally {
      await store.close();
    }
  });

  it('records a pending admission removed before its group publishes context', async () => {
    const path = join(dir(), 'dropped-admission.llxj');
    const store = await JournalStore.create(path, storeDeps());
    try {
      await store.commit([
        { kind: 'append', rows: [draftRow({ text: 'seed' })] },
      ]);
      const cutLabel = store.published?.nextLabel;
      if (cutLabel === undefined) throw new Error('Missing admission label');
      await store.commit([
        { kind: 'append', rows: [draftRow({ text: 'dropped' })] },
        { kind: 'pop', cutLabel, expectedRemoved: 1 },
        { kind: 'append', rows: [draftRow({ text: 'kept' })] },
      ]);
      const transcript = await page(path);
      expect(transcript.rows).toStrictEqual(['seed', 'dropped', 'kept']);
      expect(transcript.counts.slice(0, 3)).toStrictEqual([1, 0, 1]);
    } finally {
      await store.close();
    }
  });

  it('resumes at the newest page with bounded positional reads', async () => {
    const path = join(dir(), 'resume.llxj');
    const store = await JournalStore.create(path, storeDeps());
    async function* rows() {
      for (let index = 0; index < 4096; index++)
        yield draftRow({ text: `row-${index}` });
    }
    await store.commit([{ kind: 'replace', rows: rows() }]);
    await store.close();
    let reads = 0;
    const journal = await openJournalReadOnly(path, {
      open: async (file, flags) => {
        const handle = await open(file, flags);
        return {
          fd: handle.fd,
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          write: (...args) => handle.write(...args),
          writev: (...args) => handle.writev(...args),
          read: (...args) => {
            reads++;
            return handle.read(...args);
          },
        };
      },
    });
    try {
      const reader = new TranscriptReader(journal, sha256KeyHash);
      const newest = await reader.page({ direction: 'backward', limit: 10 });
      expect(newest.map((entry) => entry.transcriptId)).toStrictEqual(
        Array.from({ length: 10 }, (_, index) => BigInt(4096 - index)),
      );
      expect(reads).toBeLessThan(40);
    } finally {
      await journal.close();
    }
  });
});
