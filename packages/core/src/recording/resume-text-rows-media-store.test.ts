/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
import { resumeSession } from './resumeSession.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import type { IContent } from '../services/history/IContent.js';
import { createRowCounters } from './journalCounters.js';

async function seedTextRows(
  config: JournalRecordingConfig,
  rows: number,
): Promise<void> {
  const recording = JournalRecordingService.create(config);
  try {
    await (
      await recording.session()
    ).append(
      Array.from(
        { length: rows },
        (_unused, index): IContent => ({
          speaker: 'human',
          blocks: [{ type: 'text', text: `turn ${index}` }],
        }),
      ),
    );
  } finally {
    await recording.dispose();
  }
}

async function readResumedTextRows(
  config: JournalRecordingConfig,
  rows: number,
): Promise<void> {
  const resumed = await resumeSession({
    ...config,
    continueRef: config.sessionId,
    currentProvider: config.provider,
    currentModel: config.model,
    counters: createRowCounters().counters,
  });
  if (!resumed.ok) throw new Error(resumed.error);
  try {
    let streamed = 0;
    for await (const _row of resumed.boot.streamRows()) streamed += 1;
    expect(streamed).toBe(rows);
  } finally {
    await resumed.boot.close();
    await resumed.recording.dispose();
  }
}

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
  const config = {
    sessionId: 'resume-text-rows',
    projectHash: 'resume-text-project',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
    mediaStore: store,
  };
  try {
    await seedTextRows(config, rows);
    const admit = spyOn(store, 'admitObjects');
    try {
      await readResumedTextRows(config, rows);
      return admit.mock.calls.length;
    } finally {
      admit.mockRestore();
    }
  } finally {
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
