/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResumeCursorBoot } from './resumeCursorBoot.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { RowOwnership } from './rowOwnership.js';
import { createRowCounters } from './journalCounters.js';

describe('bounded media ownership', () => {
  it('protects incoming media across replay passes and releases it on cancellation', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'resume-media-reservation-'),
    );
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024,
    });
    const ownership = new RowOwnership();
    const reference = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const path = join(directory, 'journal.jsonl');
    await writeFile(
      path,
      JSON.stringify({
        v: 1,
        seq: 1,
        type: 'content',
        payload: { content: { speaker: 'human', blocks: [reference] } },
      }) + '\n',
    );
    const boot = await ResumeCursorBoot.open(
      path,
      1,
      (await stat(path)).size,
      { ...createRowCounters().counters, ownership },
      store,
    );
    try {
      for await (const _row of boot.streamRows()) {
        expect(await store.hasReservations(reference.contentId)).toBe(true);
      }
      expect(await store.hasReservations(reference.contentId)).toBe(true);
      for await (const _row of boot.streamRows()) break;
      expect(await store.hasReservations(reference.contentId)).toBe(false);
      expect(ownership.snapshot().liveRows).toBe(0);
    } finally {
      await boot.close();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
