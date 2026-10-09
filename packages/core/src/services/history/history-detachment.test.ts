import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as filesystem from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryService } from './HistoryService.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { RecordingIntegration } from '../../recording/RecordingIntegration.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';

let directory: string;

let recording: SessionRecordingService;

let history: HistoryService;

describe('bounded journal detachment', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'history-detachment-'));
    recording = new SessionRecordingService({
      sessionId: 'source',
      projectHash: 'project',
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    history = new HistoryService({ recording });
  });
  afterEach(async () => {
    history.dispose();
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it(
    'detaches pending writes by copying raw journal bytes without materializing rows',
    verifyDetachesPendingWritesByCopyingRawJournalBytesWithoutMaterializingRows,
  );

  it(
    'integration disposal settles detachment before the caller closes its recorder',
    verifyIntegrationDisposalSettlesDetachmentBeforeTheCallerClosesItsRecorder,
  );

  it(
    'cancels detachment when history is disposed before the copy completes',
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
    'rejects detachment rather than dropping a write refused by a disposed recorder',
    verifyRejectsDetachmentRatherThanDroppingAWriteRefusedByADisposedRecorder,
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
  const eager = spyOn(
    HistoryJournalStore.prototype,
    'materialize',
  ).mockImplementation(() => {
    throw new Error('eager lifecycle read');
  });
  try {
    await history.detachJournal(recording);
    await history.waitForCommit();
  } finally {
    eager.mockRestore();
  }
  const source = recording.getFilePath();
  const target = history.journalPath();
  if (!source || !target) throw new Error('Missing journal');
  expect(target).not.toBe(source);
  expect(Buffer.compare(await readFile(source), await readFile(target))).toBe(
    0,
  );
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
  const flush = recording.flush.bind(recording);
  const gate = spyOn(recording, 'flush').mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    await flush();
  });
  const store = new HistoryJournalStore(recording);
  const detachment = store.detachJournal(recording);
  await entered.promise;
  store.dispose();
  release.resolve();
  try {
    await expect(detachment).rejects.toThrow('disposed');
    expect(store.journalPath()).toBe(recording.getFilePath());
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
  await rm(source);
  try {
    await expect(history.detachJournal(recording)).rejects.toThrow('ENOENT');
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
  const create = filesystem.createWriteStream;
  const fault = spyOn(filesystem, 'createWriteStream').mockImplementation(() =>
    create(directory, { flags: 'wx' }),
  );
  try {
    await expect(history.detachJournal(recording)).rejects.toThrow('EEXIST');
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
  const flush = recording.flush.bind(recording);
  const gate = spyOn(recording, 'flush').mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    await flush();
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

async function verifyRejectsDetachmentRatherThanDroppingAWriteRefusedByADisposedRecorder(): Promise<void> {
  await recording.dispose();
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'uncommitted' }],
  });
  await expect(history.detachJournal(recording)).rejects.toThrow('uncommitted');
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((row) => row.blocks)).toStrictEqual([
      [{ type: 'text', text: 'uncommitted' }],
    ]);
  });
}

async function verifyCancelsAnAttachmentQueuedBehindAnAsynchronousHistoryMutation(): Promise<void> {
  const next = new SessionRecordingService({
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
  const summary = history.summarizeOldHistory(0, async () => {
    entered.resolve();
    await release.promise;
    return { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] };
  });
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
  const next = new SessionRecordingService({
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
  const summary = history.summarizeOldHistory(0, async () => {
    entered.resolve();
    await release.promise;
    return { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] };
  });
  await entered.promise;
  void integration.subscribeToJournal(history);
  release.resolve();
  try {
    await summary;
    await history.waitForCommit();
    expect(history.journalPath()).toBe(next.getFilePath());
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
