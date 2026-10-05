import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, afterEach, beforeEach, expect, it } from 'bun:test';
import { appendFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryService } from './HistoryService.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { RecordingIntegration } from '../../recording/RecordingIntegration.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

let directory: string;
let history: HistoryService;
let destination: SessionRecordingService;
describe('partial attachment caller durability', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'partial-attachment-'));
    history = new HistoryService();
    history.add(row('accepted source'));
    history.add(row('rejected source'));
    await history.waitForCommit();
    destination = new SessionRecordingService({
      sessionId: 'partial',
      projectHash: 'project',
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      io: {
        async appendFile(file, data, encoding) {
          if (data.includes('rejected source'))
            throw new Error('destination disk failure');
          await appendFile(file, data, encoding);
        },
      },
    });
    await destination.commit('content', {
      content: row('existing destination'),
    });
  });
  afterEach(async () => {
    history.dispose();
    await destination.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  it(
    'surfaces replace-mode partial effects through subscription and flush without retrying',
    reportPartialReplacement,
  );
  it(
    'leaves exact append-mode partial rows on disk and retains the original history binding',
    reportPartialAppend,
  );
  it(
    'reports partial effects to concurrent subscription callers and disposal',
    reportConcurrentFailure,
  );
});

async function reportConcurrentFailure(): Promise<void> {
  const integration = new RecordingIntegration(destination);
  const first = integration.subscribeToJournal(history);
  const repeated = integration.subscribeToJournal(history);
  const expected = { committedRows: 1, destinationRewound: true };
  try {
    await expect(first).rejects.toMatchObject(expected);
    await expect(repeated).rejects.toMatchObject(expected);
  } finally {
    await expect(integration.dispose()).rejects.toMatchObject(expected);
  }
  const reopened = new HistoryJournalStore(destination);
  expect(reopened.materialize().map((content) => content.blocks)).toStrictEqual(
    [row('accepted source').blocks],
  );
  reopened.dispose();
}

async function reportPartialReplacement(): Promise<void> {
  const integration = new RecordingIntegration(destination);
  try {
    await expect(integration.subscribeToJournal(history)).rejects.toMatchObject(
      { committedRows: 1, destinationRewound: true },
    );
    const file = destination.getFilePath();
    if (!file) throw new Error('Missing destination');
    const bytes = await readFile(file);
    history.add(row('subsequent source'));
    await history.waitForCommit();
    await expect(integration.flushAtTurnBoundary()).rejects.toMatchObject({
      committedRows: 1,
      destinationRewound: true,
    });
    expect(Buffer.compare(bytes, await readFile(file))).toBe(0);
    const reopened = new HistoryJournalStore(destination);
    expect(
      reopened.materialize().map((content) => content.blocks),
    ).toStrictEqual([row('accepted source').blocks]);
    reopened.dispose();
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows.map((content) => content.blocks)).toStrictEqual([
        row('accepted source').blocks,
        row('rejected source').blocks,
        row('subsequent source').blocks,
      ]);
    });
  } finally {
    await integration.dispose();
  }
}

async function reportPartialAppend(): Promise<void> {
  const sourcePath = history.journalPath();
  if (!sourcePath) throw new Error('Missing source');
  const sourceInode = (await stat(sourcePath)).ino;
  await expect(history.attachJournal(destination)).rejects.toMatchObject({
    committedRows: 1,
    destinationRewound: false,
  });
  const selectedPath = history.journalPath();
  if (!selectedPath) throw new Error('Missing selected source');
  expect((await stat(selectedPath)).ino).toBe(sourceInode);
  const reopened = new HistoryJournalStore(destination);
  expect(reopened.materialize().map((content) => content.blocks)).toStrictEqual(
    [row('existing destination').blocks, row('accepted source').blocks],
  );
  reopened.dispose();
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((content) => content.blocks)).toStrictEqual([
      row('accepted source').blocks,
      row('rejected source').blocks,
    ]);
  });
}
