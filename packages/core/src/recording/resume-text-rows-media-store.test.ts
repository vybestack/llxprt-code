/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResumeCursorBoot } from './resumeCursorBoot.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { createRowCounters } from './journalCounters.js';

async function mediaStoreOperationsForTextRows(rows: number): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'resume-text-rows-'));
  const store = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024,
    recordingArchive: new LocalMediaStore({
      rootDirectory: join(directory, 'archive'),
      quotaBytes: 1024,
    }),
  });
  const admit = spyOn(store, 'admitObjects');
  const path = join(directory, 'journal.jsonl');
  await writeFile(
    path,
    Array.from({ length: rows }, (_unused, index) =>
      JSON.stringify({
        v: 1,
        seq: index + 1,
        type: 'content',
        payload: {
          content: {
            speaker: 'human',
            blocks: [{ type: 'text', text: `turn ${index}` }],
          },
        },
      }),
    ).join('\n') + '\n',
  );
  const boot = await ResumeCursorBoot.open(
    path,
    rows,
    (await stat(path)).size,
    createRowCounters().counters,
    store,
  );
  try {
    let streamed = 0;
    for await (const _row of boot.streamRows()) streamed += 1;
    expect(streamed).toBe(rows);
    return admit.mock.calls.length;
  } finally {
    await boot.close();
    await store.recordingArchive?.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('resume of rows without media', () => {
  it('never takes the media store lock, however many rows it replays', async () => {
    const small = await mediaStoreOperationsForTextRows(25);
    const large = await mediaStoreOperationsForTextRows(100);

    expect(small).toBe(0);
    expect(large).toBe(0);
  });
});
