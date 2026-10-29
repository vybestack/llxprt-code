/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { JournalStore } from './journalStore.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import {
  cloneVersion,
  compactionCopy,
  cloneCheckpoint,
} from './versionTransfer.js';
import { sha256KeyHash } from './idKeys.js';
import {
  storeDeps,
  draftRow,
  labelsOf,
} from './__tests__/support/storeFixtures.js';
import { copyDeps } from './__tests__/support/copyFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function contents(
  path: string,
): Promise<{ rows: string[]; counts: number[]; ids: bigint[] }> {
  const source = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(source, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 50 });
    const rows: string[] = [];
    for (const entry of entries) {
      if (entry.rowRef !== 0)
        rows.push(
          new TextDecoder().decode((await reader.readRow(entry)).blocks[0]),
        );
    }
    const members = await reader.membership(
      entries.map((entry) => entry.transcriptId),
    );
    return {
      rows,
      counts: members.map((member) => member.count),
      ids: entries.map((entry) => entry.transcriptId),
    };
  } finally {
    await source.close();
  }
}

describe('transcript relocation', () => {
  const dir = useTempDir('transcript-copy-');
  it('copies the transcript/context union once, including replaced and cleared rows, without a checkpoint', async () => {
    const path = join(dir(), 'source.llxj');
    const store = await JournalStore.create(path, storeDeps());
    await store.commit([
      {
        kind: 'append',
        rows: ['first', 'second', 'third'].map((text) => draftRow({ text })),
      },
    ]);
    const labels = await labelsOf(store);
    await store.commit([
      {
        kind: 'density',
        replacements: [
          { label: labels[0], draft: draftRow({ text: 'dense' }) },
        ],
        removed: [],
      },
    ]);
    await store.commit([
      {
        kind: 'compress',
        retainFromLabel: labels[2],
        expectedReplaced: 2,
        summary: draftRow({ text: 'summary' }),
      },
    ]);
    await store.commit([{ kind: 'clear' }]);
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'after' })] },
    ]);
    const expected = await contents(path);
    const pin = await store.openRead();
    if (pin.version === undefined) throw new Error('missing version');
    const clone = await cloneVersion(
      pin.access,
      pin.version,
      join(dir(), 'clone.llxj'),
      copyDeps(),
    );
    const compact = await compactionCopy(
      pin.access,
      pin.version,
      join(dir(), 'compact.llxj'),
      copyDeps(),
    );
    await pin.close();
    await store.close();
    await rm(path);
    expect(expected.rows).toStrictEqual([
      'first',
      'second',
      'third',
      'dense',
      'summary',
      'after',
    ]);
    expect(clone.stats.copied.ROW).toBe(6);
    expect(compact.stats.copied.ROW).toBe(6);
    expect(await contents(clone.path)).toStrictEqual(expected);
    expect(await contents(compact.path)).toStrictEqual(expected);
    const reopened = await JournalStore.open(compact.path, storeDeps());
    const [label] = await labelsOf(reopened);
    await reopened.commit([
      {
        kind: 'density',
        replacements: [{ label, draft: draftRow({ text: 'last' }) }],
        removed: [],
      },
    ]);
    await reopened.close();
    expect((await contents(compact.path)).rows).toStrictEqual([
      ...expected.rows,
      'last',
    ]);
  });

  it('forks the saved transcript head and shares bodies between retained versions during compaction', async () => {
    const path = join(dir(), 'checkpoint.llxj');
    const store = await JournalStore.create(path, storeDeps());
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'saved' })] },
    ]);
    await store.commit([
      { kind: 'checkpoint', id: 'saved', name: 'saved', createdAtMs: 1 },
    ]);
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'later' })] },
    ]);
    const pin = await store.openRead();
    if (pin.version === undefined) throw new Error('missing version');
    const fork = await cloneCheckpoint(
      pin.access,
      pin.version,
      'saved',
      join(dir(), 'fork.llxj'),
      copyDeps(),
    );
    const compact = await compactionCopy(
      pin.access,
      pin.version,
      join(dir(), 'compact.llxj'),
      copyDeps(),
    );
    await pin.close();
    await store.close();
    await rm(path);
    expect((await contents(fork.path)).rows).toStrictEqual(['saved']);
    expect((await contents(compact.path)).rows).toStrictEqual([
      'saved',
      'later',
    ]);
    expect(compact.stats.copied.ROW).toBe(2);
  });
});
