import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryService } from './HistoryService.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { ResumeCursorBoot } from '../../recording/resumeCursorBoot.js';
import { JournalResolver } from '../../recording/journalResolver.js';
import type { IContent } from './IContent.js';

let directory: string;

let recording: SessionRecordingService;

let history: HistoryService;

let boot: ResumeCursorBoot;

let file: string;

const marked: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'marked' }],
  metadata: { chronology: { seq: 1, userTurn: 1, step: 2, recordedAt: 1 } },
};

async function reopened(): Promise<IContent[]> {
  const resolver = await JournalResolver.open(file);
  try {
    return (await Array.fromAsync(resolver.resolve())).map(
      (entry) => entry.content,
    );
  } finally {
    await resolver.close();
  }
}

describe('mixed legacy chronology', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'mixed-chronology-'));
    history = new HistoryService();
    recording = new SessionRecordingService({
      sessionId: 'mixed',
      projectHash: 'project',
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    await recording.commit('content', {
      content: { speaker: 'human', blocks: [{ type: 'text', text: 'legacy' }] },
    });
    const watermark = await recording.commit('content', { content: marked });
    const path = recording.getFilePath();
    if (!path) throw new Error('Missing file');
    file = path;
    boot = await ResumeCursorBoot.open(
      file,
      watermark.seq,
      watermark.byteOffset,
    );
  });
  afterEach(async () => {
    history.dispose();
    await boot.close();
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it(
    'allocates legacy markers above later marked rows and preserves them on independent reopen',
    verifyAllocatesLegacyMarkersAboveLaterMarkedRowsAndPreservesThemOnIndependent,
  );

  it(
    'retains partially committed markers when retrying a failed binding publication',
    verifyRetainsPartiallyCommittedMarkersWhenRetryingAFailedBindingPublication,
  );
});

async function verifyAllocatesLegacyMarkersAboveLaterMarkedRowsAndPreservesThemOnIndependent(): Promise<void> {
  await history.adoptResumeBoot(recording, boot);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
      2, 1,
    ]);
  });
  const rows = await reopened();
  expect(rows[1]).toStrictEqual(marked);
  expect(rows[0].metadata?.chronology?.seq).toBe(2);
  await history.applyDensityResult({
    removals: [0],
    replacements: new Map(),
    metadata: {
      readWritePairsPruned: 0,
      fileDeduplicationsPruned: 0,
      recencyPruned: 1,
    },
  });
  await history.waitForCommit();
  expect(await reopened()).toStrictEqual([marked]);
}

async function verifyRetainsPartiallyCommittedMarkersWhenRetryingAFailedBindingPublication(): Promise<void> {
  const commit = recording.commit.bind(recording);
  let bindings = 0;
  const fault = spyOn(recording, 'commit').mockImplementation(
    async (type, payload) => {
      if (type === 'chronology_bind' && ++bindings === 2)
        throw new Error('binding write failed');
      return commit(type, payload);
    },
  );
  try {
    await expect(history.adoptResumeBoot(recording, boot)).rejects.toThrow(
      'binding write failed',
    );
  } finally {
    fault.mockRestore();
  }
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows).toStrictEqual([]);
  });
  expect(
    (await reopened()).map((row) => row.metadata?.chronology?.seq),
  ).toStrictEqual([2, 1]);
  boot = await ResumeCursorBoot.open(file, 100, (await stat(file)).size);
  await history.adoptResumeBoot(recording, boot);
  expect(
    (await reopened()).map((row) => [
      row.metadata?.chronology?.seq,
      row.blocks,
    ]),
  ).toStrictEqual([
    [2, [{ type: 'text', text: 'legacy' }]],
    [1, [{ type: 'text', text: 'marked' }]],
  ]);
}
