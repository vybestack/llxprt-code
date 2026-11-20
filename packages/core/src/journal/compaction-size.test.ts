/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  COMPACTED_BYTES_KEY,
  COMPACTION_FLOOR_BYTES,
  compactionDue,
  decodeCompactedBytes,
} from './compaction.js';
import { JournalStore } from './journalStore.js';
import {
  decodeTranscriptHead,
  TRANSCRIPT_HEAD_KEY,
} from './transcript-head.js';
import type { Version } from './version.js';
import { openStore } from './__tests__/support/copyFixtures.js';
import { testNamedWriters } from './__tests__/support/namedWriterOwner.js';
import {
  appendEach,
  draftRow,
  labelsOf,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const ROW_TEXT_BYTES = 24 * 1024;
const ROWS = 24;
const SMALL_ROWS = 600;

function rowsOf(prefix: string, count: number) {
  return Array.from({ length: count }, (_, at) =>
    draftRow({ text: `${prefix} ${at} `.padEnd(ROW_TEXT_BYTES, prefix[0]) }),
  );
}

function publishedOf(store: JournalStore): Version {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

async function compactedBytesOf(store: JournalStore): Promise<number> {
  return decodeCompactedBytes(await store.getState(COMPACTED_BYTES_KEY));
}

/**
 * A session whose transcript and context hold disjoint rows: the first rows
 * leave the context on clear but stay in the transcript, and the context then
 * holds only new rows. The estimate takes the larger of the two and so counts
 * about half of what a compaction keeps.
 */
async function disjointSession(
  file: string,
  oldRows = rowsOf('old', ROWS),
): Promise<JournalStore> {
  const store = await JournalStore.create(file, storeDeps(), testNamedWriters);
  await appendEach(store, oldRows);
  await store.commit([{ kind: 'clear' }]);
  await appendEach(store, rowsOf('new', ROWS));
  return store;
}

describe('compacted size (design 16.3)', () => {
  const directory = useTempDir('journal-compacted-size-');

  it('is absent before the first compaction and is the copied file size after it', async () => {
    const file = path.join(directory(), 'size.llxj');
    const store = await disjointSession(file);
    expect(await store.getState(COMPACTED_BYTES_KEY)).toBeUndefined();

    expect(await store.compact()).toBe('swapped');

    const recorded = await compactedBytesOf(store);
    const fileBytes = (await fsp.stat(file)).size;
    expect(publishedOf(store).durableEnd).toBe(fileBytes);
    expect(recorded).toBeLessThanOrEqual(fileBytes);
    // Only the entry's own state path and the trailer follow the recorded size.
    expect(fileBytes - recorded).toBeLessThan(16 * 1024);
    // Both row sets survive the copy, so it holds about twice one of them.
    expect(recorded).toBeGreaterThan(2 * ROWS * ROW_TEXT_BYTES);
    await store.close();
  });

  it('does not re-trigger after compacting a context cleared away from its transcript until the file doubles', async () => {
    const store = await disjointSession(
      path.join(directory(), 'disjoint.llxj'),
      Array.from({ length: SMALL_ROWS }, (_, at) =>
        draftRow({ text: `old ${at}` }),
      ),
    );
    expect(await store.compact()).toBe('swapped');
    const version = publishedOf(store);
    const compactedBytes = await compactedBytesOf(store);
    const head = decodeTranscriptHead(
      await store.getState(TRANSCRIPT_HEAD_KEY),
    );
    const estimate =
      Math.max(head.reachableBytes, version.aggregate.liveBytes) +
      version.ckptBytes +
      version.aggregate.rows * 1550;
    const sizes = {
      transcriptReachableBytes: head.reachableBytes,
      compactedBytes,
    };
    const line =
      2 * Math.max(compactedBytes, estimate) + COMPACTION_FLOOR_BYTES;
    const grownTo = (durableEnd: number): Version => ({
      ...version,
      durableEnd,
    });
    // The next copy waits until the file has more than doubled since this one.
    expect(compactionDue(grownTo(2 * compactedBytes), 0, sizes)).toBe(false);
    expect(compactionDue(grownTo(line), 0, sizes)).toBe(false);
    expect(compactionDue(grownTo(line + 1), 0, sizes)).toBe(true);
    expect(compactionDue(version, 0, sizes)).toBe(false);
    await store.close();
  });

  it('survives appends, pop, restore and reopen', async () => {
    const file = path.join(directory(), 'kept.llxj');
    const store = await disjointSession(file);
    const saved = publishedOf(store);
    expect(await store.compact()).toBe('swapped');
    const recorded = await compactedBytesOf(store);
    expect(recorded).toBeGreaterThan(0);

    await appendEach(store, rowsOf('more', 3));
    expect(await compactedBytesOf(store)).toBe(recorded);
    const labels = await labelsOf(store);
    const cut = labels[labels.length - 2];
    await store.commit([{ kind: 'pop', cutLabel: cut, expectedRemoved: 2 }]);
    expect(await compactedBytesOf(store)).toBe(recorded);
    const restored = await store.readVersion(publishedOf(store).selfOffset);
    await appendEach(store, rowsOf('again', 1));
    await store.commit([{ kind: 'restore', saved: restored }]);
    expect(await compactedBytesOf(store)).toBe(recorded);
    expect(saved.commitSeq).toBeLessThan(publishedOf(store).commitSeq);
    await store.close();

    const reopened = await openStore(file);
    expect(await compactedBytesOf(reopened)).toBe(recorded);
    await reopened.close();
  });

  it('is replaced by the next compaction', async () => {
    const file = path.join(directory(), 'twice.llxj');
    const store = await disjointSession(file);
    expect(await store.compact()).toBe('swapped');
    const first = await compactedBytesOf(store);
    await appendEach(store, rowsOf('later', ROWS));
    expect(await store.compact()).toBe('swapped');
    const second = await compactedBytesOf(store);
    expect(second).toBeGreaterThan(first);
    expect((await fsp.stat(file)).size - second).toBeLessThan(16 * 1024);
    await store.close();
  });
});
