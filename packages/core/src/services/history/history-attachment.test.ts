/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  collectRowsForAssertions,
  collectJournalRowsForAssertions,
} from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from './HistoryService.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import type { IContent } from './IContent.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { RecordingIntegration } from '../../recording/RecordingIntegration.js';
import { journalSeams } from '../../recording/__tests__/support/recordedJournals.js';
import { readJournalSnapshot } from '../../recording/__tests__/support/journalSnapshot.js';
let directory: string;
let recorders: JournalRecordingService[];
let histories: HistoryService[];
function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}
function journalFile(history: HistoryService): string {
  const path = history.journalPath();
  if (path === null) throw new Error('Missing history journal');
  return path;
}
function recorder(sessionId: string): JournalRecordingService {
  const created = JournalRecordingService.create({
    sessionId,
    projectHash: 'attachment',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
    journal: journalSeams(),
  });
  recorders.push(created);
  return created;
}
describe('bounded journal attachment', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'history-attachment-'));
    recorders = [];
    histories = [];
  });
  afterEach(async () => {
    for (const history of histories) await history.dispose();
    await Promise.all(recorders.map((recording) => recording.dispose()));
    await rm(directory, { recursive: true, force: true });
  });
  it(
    'late-attaches bare history through the recording integration without eager reads',
    verifyLateAttachesBareHistoryThroughTheRecordingIntegrationWithoutEagerReads,
  );
  it(
    'keeps the original binding usable when the destination rejects attachment',
    verifyKeepsTheOriginalBindingUsableWhenTheDestinationRejectsAttachment,
  );
  it(
    'restores the original binding when publication fails and retains later accepted writes',
    verifyRestoresTheOriginalBindingWhenPublicationFailsAndRetainsLaterAcceptedWrites,
  );
  it(
    'preserves chronology and context membership across attachment and subsequent addressed replacement',
    verifyPreservesChronologyAndContextMembershipAcrossAttachmentAndSubsequentAddressedReplacement,
  );
});
async function verifyLateAttachesBareHistoryThroughTheRecordingIntegrationWithoutEagerReads(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('source'));
  const destination = recorder('destination');
  await (await destination.session()).append([row('discarded destination')]);
  const integration = new RecordingIntegration(destination);
  const eager = spyOn(
    JournalHistoryStore.prototype,
    'materialize',
  ).mockImplementation(() => {
    throw new Error('eager attachment');
  });
  try {
    await integration.subscribeToJournal(history);
    await history.waitForCommit();
  } finally {
    eager.mockRestore();
  }
  history.add(row('after'));
  await history.waitForCommit();
  expect(history.journalPath()).toBe(destination.getFilePath());
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((content) => content.blocks)).toStrictEqual([
      row('source').blocks,
      row('after').blocks,
    ]);
  });
  await integration.dispose();
  await (await destination.session()).append([row('borrowed')]);
  await collectRowsForAssertions(history.streamRawHistory(), (detachedRows) => {
    expect(detachedRows.map((content) => content.blocks)).toStrictEqual([
      row('source').blocks,
      row('after').blocks,
    ]);
  });
}
async function verifyKeepsTheOriginalBindingUsableWhenTheDestinationRejectsAttachment(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('source'));
  await history.waitForCommit();
  await history.attachJournal(recorder('initial-' + histories.length), true);
  const originalFile = await stat(journalFile(history));
  const destination = recorder('disposed');
  await destination.dispose();
  await expect(history.attachJournal(destination, true)).rejects.toThrow(
    'Session recording is disposed',
  );
  await expect(destination.dispose()).rejects.toThrow(
    'Session recording is disposed',
  );
  history.add(row('accepted after failure'));
  await history.waitForCommit();
  expect((await stat(journalFile(history))).ino).toBe(originalFile.ino);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((content) => content.blocks)).toStrictEqual([
      row('source').blocks,
      row('accepted after failure').blocks,
    ]);
  });
}
async function verifyRestoresTheOriginalBindingWhenPublicationFailsAndRetainsLaterAcceptedWrites(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('original'));
  await history.waitForCommit();
  await history.attachJournal(recorder('initial-' + histories.length), true);
  const originalFile = await stat(journalFile(history));
  const destination = recorder('publication');
  const attaching = history.attachJournal(destination, true, () => {
    throw new Error('publication');
  });
  history.add(row('queued'));
  await expect(attaching).rejects.toThrow('publication');
  await history.waitForCommit();
  expect((await stat(journalFile(history))).ino).toBe(originalFile.ino);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((content) => content.blocks)).toStrictEqual([
      row('original').blocks,
      row('queued').blocks,
    ]);
  });
  await (await destination.session()).append([row('still usable')]);
}
async function verifyPreservesChronologyAndContextMembershipAcrossAttachmentAndSubsequentAddressedReplacement(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('one'));
  history.add(row('two'));
  history.add(row('three'));
  await history.waitForCommit();
  await collectJournalRowsForAssertions(history, async (initial) => {
    await history.replaceBatch([
      initial[0],
      { ...initial[2], blocks: row('rewritten three').blocks },
    ]);
    const expectedRows = [
      initial[0],
      { ...initial[2], blocks: row('rewritten three').blocks },
    ];
    const destination = recorder('mutations');
    await (await destination.session()).append([row('discarded')]);
    await history.attachJournal(destination, true);
    expect(history.getContextRange()).toStrictEqual({
      firstSeq: 1,
      lastSeq: 3,
      totalEntries: 2,
      removedInterior: [],
      approximate: false,
    });
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows).toStrictEqual(expectedRows);
    });
    const replacement = {
      ...expectedRows[1],
      blocks: row('after attachment').blocks,
    };
    await history.replaceBatch([expectedRows[0], replacement]);
    await history.waitForCommit();
    const reopened = await readJournalSnapshot(
      journalFile(history),
      'attachment',
    );
    expect(reopened.history).toStrictEqual([expectedRows[0], replacement]);
  });
}
