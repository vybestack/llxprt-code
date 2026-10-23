import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryService } from './HistoryService.js';
import { JournalSession } from './journalSession.js';
import { requireJournalRecorder } from './recorderBackend.js';
import type { IContent } from './IContent.js';
import { RecordingIntegration } from '../../recording/RecordingIntegration.js';
import { createSessionRecorder } from '../../recording/sessionRecorderFactory.js';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import { createRowCounters } from '../../recording/journalCounters.js';

function sourcePath(recording: SessionRecordingPort): string {
  const path = recording.getFilePath();
  if (path === null) throw new Error('Missing recording');
  return path;
}
function summaryRow(): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] };
}

let directory: string;

let recording: SessionRecordingPort;

let history: HistoryService;
let reads = createRowCounters();

describe('bounded journal detachment', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'history-detachment-'));
    recording = createSessionRecorder({
      sessionId: 'source',
      projectHash: 'project',
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    reads = createRowCounters();
    history = new HistoryService({
      recording,
      attachmentCounters: reads.counters,
    });
    await history.waitForCommit();
  });
  afterEach(async () => {
    await history.dispose();
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it(
    'detaches pending writes into an unlinked journal without losing rows',
    verifyDetachesPendingWritesByCopyingRawJournalBytesWithoutMaterializingRows,
  );

  it(
    'integration disposal settles detachment before the caller closes its recorder',
    verifyIntegrationDisposalSettlesDetachmentBeforeTheCallerClosesItsRecorder,
  );

  it(
    'settles detachment before history disposal closes its clone',
    verifyCancelsDetachmentWhenHistoryIsDisposedBeforeTheCopyCompletes,
  );

  it(
    'keeps the borrowed binding after source I/O failure and permits retry',
    verifyKeepsTheBorrowedBindingAfterSourceIOFailureAndPermitsRetry,
  );

  it(
    'keeps the borrowed binding after destination I/O failure and permits retry',
    verifyKeepsTheBorrowedBindingAfterDestinationIOFailureAndPermitsRetry,
  );

  it(
    'orders a queued add and commit barrier after detachment without writing the source',
    verifyOrdersAQueuedAddAndCommitBarrierAfterDetachmentWithoutWritingThe,
  );
  it(
    'cancels an attachment queued behind an asynchronous history mutation',
    verifyCancelsAnAttachmentQueuedBehindAnAsynchronousHistoryMutation,
  );
  it(
    'binds retirement to the selected journal when attachment is deferred',
    verifyBindsRetirementToTheSelectedJournalWhenAttachmentIsDeferred,
  );
});

async function verifyDetachesPendingWritesByCopyingRawJournalBytesWithoutMaterializingRows(): Promise<void> {
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'pending' }],
  });
  await history.detachJournal(recording);
  await history.waitForCommit();
  const source = recording.getFilePath();
  if (!source) throw new Error('Missing recording');
  expect(history.journalPath()).toBeNull();
  expect(reads.snapshot().rowsDecoded).toBe(0);
  const durable = await JournalSession.open(source);
  try {
    const rows = await Array.fromAsync(durable.rows());
    expect(rows.map((row) => row.content.blocks)).toStrictEqual([
      [{ type: 'text', text: 'pending' }],
    ]);
  } finally {
    await durable.close();
  }
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'detached' }],
  });
  await history.waitForCommit();
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks)).toStrictEqual([
      [{ type: 'text', text: 'pending' }],
      [{ type: 'text', text: 'detached' }],
    ]);
  });
  expect((await readFile(source, 'utf8')).includes('detached')).toBe(false);
}

async function verifyIntegrationDisposalSettlesDetachmentBeforeTheCallerClosesItsRecorder(): Promise<void> {
  const integration = new RecordingIntegration(recording);
  void integration.subscribeToJournal(history);
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'retained' }],
  });
  await integration.dispose();
  await recording.dispose();
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'continued' }],
  });
  await history.waitForCommit();
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks)).toStrictEqual([
      [{ type: 'text', text: 'retained' }],
      [{ type: 'text', text: 'continued' }],
    ]);
  });
}

async function verifyCancelsDetachmentWhenHistoryIsDisposedBeforeTheCopyCompletes(): Promise<void> {
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'retained' }],
  });
  await history.waitForCommit();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const session = await requireJournalRecorder(recording).session();
  const clone = session.cloneUnlinked.bind(session);
  const gate = spyOn(session, 'cloneUnlinked').mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return clone();
  });
  const detachment = history.detachJournal(recording);
  await entered.promise;
  const disposal = history.dispose();
  release.resolve();
  try {
    await detachment;
    await disposal;
    expect((await stat(sourcePath(recording))).size).toBeGreaterThan(0);
  } finally {
    gate.mockRestore();
  }
}

async function verifyKeepsTheBorrowedBindingAfterSourceIOFailureAndPermitsRetry(): Promise<void> {
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'source' }],
  });
  await history.waitForCommit();
  const source = recording.getFilePath();
  if (!source) throw new Error('Missing source');
  const bytes = await readFile(source);
  await truncate(source, 0);
  try {
    await expect(history.detachJournal(recording)).rejects.toThrow(
      /Unexpected end of file|corrupt/i,
    );
    expect(history.journalPath()).toBe(source);
  } finally {
    await writeFile(source, bytes);
  }
  await history.detachJournal(recording);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks)).toStrictEqual([
      [{ type: 'text', text: 'source' }],
    ]);
  });
}

async function verifyKeepsTheBorrowedBindingAfterDestinationIOFailureAndPermitsRetry(): Promise<void> {
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'destination' }],
  });
  await history.waitForCommit();
  const open = filesystem.open;
  const fault = spyOn(filesystem, 'open').mockImplementation(
    async (...args) => {
      if (String(args[0]).includes('llxprt-journal-'))
        throw new Error('destination open failed');
      return open(...args);
    },
  );
  try {
    await expect(history.detachJournal(recording)).rejects.toThrow(
      'destination open failed',
    );
    expect(history.journalPath()).toBe(recording.getFilePath());
  } finally {
    fault.mockRestore();
  }
  await history.detachJournal(recording);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks)).toStrictEqual([
      [{ type: 'text', text: 'destination' }],
    ]);
  });
}

async function verifyOrdersAQueuedAddAndCommitBarrierAfterDetachmentWithoutWritingThe(): Promise<void> {
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'before' }],
  });
  await history.waitForCommit();
  const source = recording.getFilePath();
  if (!source) throw new Error('Missing source');
  const bytes = await readFile(source);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const session = await requireJournalRecorder(recording).session();
  const clone = session.cloneUnlinked.bind(session);
  const gate = spyOn(session, 'cloneUnlinked').mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return clone();
  });
  const detachment = history.detachJournal(recording);
  await entered.promise;
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'after' }],
  });
  let committed = false;
  const barrier = history.waitForCommit().then(() => {
    committed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const premature = committed;
  release.resolve();
  try {
    await detachment;
    await barrier;
    expect(premature).toBe(false);
    expect(Buffer.compare(await readFile(source), bytes)).toBe(0);
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows.map((row) => row.blocks)).toStrictEqual([
        [{ type: 'text', text: 'before' }],
        [{ type: 'text', text: 'after' }],
      ]);
    });
  } finally {
    gate.mockRestore();
  }
}

async function verifyCancelsAnAttachmentQueuedBehindAnAsynchronousHistoryMutation(): Promise<void> {
  const next = createSessionRecorder({
    sessionId: 'next',
    projectHash: 'project',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  const integration = new RecordingIntegration(next);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'before' }],
  });
  const summary = history.detachedValues.replace(
    (async function* () {
      entered.resolve();
      await release.promise;
      yield {
        ...summaryRow(),
      };
    })(),
  );
  await entered.promise;
  void integration.subscribeToJournal(history);
  const disposal = integration.dispose();
  release.resolve();
  try {
    await summary;
    await disposal;
    await next.dispose();
    expect(history.journalPath()).not.toBe(next.getFilePath());
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'continued' }],
    });
    await history.waitForCommit();
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows.map((row) => row.blocks)).toStrictEqual([
        [{ type: 'text', text: 'summary' }],
        [{ type: 'text', text: 'continued' }],
      ]);
    });
  } finally {
    await next.dispose();
  }
}

async function verifyBindsRetirementToTheSelectedJournalWhenAttachmentIsDeferred(): Promise<void> {
  const next = createSessionRecorder({
    sessionId: 'next',
    projectHash: 'project',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  const integration = new RecordingIntegration(next);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'before' }],
  });
  const summary = history.detachedValues.replace(
    (async function* () {
      entered.resolve();
      await release.promise;
      yield {
        ...summaryRow(),
      };
    })(),
  );
  await entered.promise;
  void integration.subscribeToJournal(history);
  release.resolve();
  try {
    await summary;
    await history.waitForCommit();
    expect(next.getFilePath()).not.toBeNull();
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'continued' }],
    });
    await integration.flushAtTurnBoundary();
    const file = next.getFilePath();
    if (!file) throw new Error('Missing recording');
    expect((await readFile(file, 'utf8')).includes('continued')).toBe(true);
  } finally {
    await integration.dispose();
    await next.dispose();
  }
}
