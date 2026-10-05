/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HistoryJournalStore } from './historyJournalStore.js';
import type { IContent } from './IContent.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata: {} };
}

let directory: string;

let recorders: SessionRecordingService[];

function recorder(id: string): SessionRecordingService {
  const recording = new SessionRecordingService({
    sessionId: id,
    projectHash: 'adoption',
    chatsDir: directory,
    workspaceDirs: [directory],
    provider: 'test',
    model: 'test',
  });
  recorders.push(recording);
  return recording;
}

async function seed(recording: SessionRecordingService, text: string) {
  const watermark = await recording.commit('content', { content: row(text) });
  const filePath = recording.getFilePath();
  if (filePath === null) throw new Error('Seeded journal has no path');
  return { watermark, filePath };
}

describe('journal adoption', () => {
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'history-adoption-'));
    recorders = [];
  });

  afterEach(async () => {
    await Promise.all(recorders.map((recorder) => recorder.dispose()));
    await fs.rm(directory, { recursive: true, force: true });
  });

  it(
    'adopts an existing durable range without copying the previous conversation',
    verifyAdoptsAnExistingDurableRangeWithoutCopyingThePreviousConversation,
  );

  it(
    'rolls back journal identity and pending rows without rewriting either file',
    verifyRollsBackJournalIdentityAndPendingRowsWithoutRewritingEitherFile,
  );

  it(
    'does not decode either journal during adoption or rollback',
    verifyDoesNotDecodeEitherJournalDuringAdoptionOrRollback,
  );

  it(
    'pins the adopted prefix even when the recorder has a later durable tail',
    verifyPinsTheAdoptedPrefixEvenWhenTheRecorderHasALaterDurable,
  );

  it(
    'can adopt an empty range without reading a later durable file',
    verifyCanAdoptAnEmptyRangeWithoutReadingALaterDurableFile,
  );

  it(
    'rejects writes and overlapping transitions until adoption is settled',
    verifyRejectsWritesAndOverlappingTransitionsUntilAdoptionIsSettled,
  );

  it(
    'retires a self-owned old journal only after commit, preserving rollback',
    verifyRetiresASelfOwnedOldJournalOnlyAfterCommitPreservingRollback,
  );
});

async function verifyAdoptsAnExistingDurableRangeWithoutCopyingThePreviousConversation(): Promise<void> {
  const previous = recorder('previous');
  const oldSeed = await seed(previous, 'previous row');
  const next = recorder('next');
  const nextSeed = await seed(next, 'next row');
  const store = new HistoryJournalStore(previous);
  const before = await fs.readFile(nextSeed.filePath, 'utf8');

  const adoption = store.adoptJournal(next, nextSeed.watermark);
  expect(store.journalPath()).toBe(nextSeed.filePath);
  expect(store.materialize()).toStrictEqual([row('next row')]);
  await adoption.commit();
  expect(await fs.readFile(nextSeed.filePath, 'utf8')).toBe(before);
  expect(await fs.readFile(oldSeed.filePath, 'utf8')).toContain('previous row');
  expect(previous.isActive()).toBe(true);

  store.apply({ kind: 'content', content: row('live row') });
  expect(store.materialize()).toStrictEqual([row('next row'), row('live row')]);
  await store.waitForDurable();
  expect(store.materialize()).toStrictEqual([row('next row'), row('live row')]);
}

async function verifyRollsBackJournalIdentityAndPendingRowsWithoutRewritingEitherFile(): Promise<void> {
  const previous = recorder('pending-previous');
  const next = recorder('pending-next');
  const nextSeed = await seed(next, 'candidate');
  await next.commit('content', { content: row('outside adopted range') });
  const store = new HistoryJournalStore(previous);
  const pending = row('pending before swap'.repeat(100));
  store.apply({ kind: 'content', content: pending });
  const durable = store.waitForDurable();
  const adoption = store.adoptJournal(next, nextSeed.watermark);

  await durable;
  await previous.flush();
  expect(store.materialize()).toStrictEqual([row('candidate')]);
  adoption.rollback();
  await store.waitForDurable();
  expect(store.journalPath()).toBe(previous.getFilePath());
  expect(store.materialize()).toStrictEqual([pending]);
  expect(next.isActive()).toBe(true);
}

async function verifyDoesNotDecodeEitherJournalDuringAdoptionOrRollback(): Promise<void> {
  const previous = recorder('unread-previous');
  const previousSeed = await seed(previous, 'previous');
  const next = recorder('unread-next');
  const nextSeed = await seed(next, 'candidate');
  const store = new HistoryJournalStore(previous);
  await fs.writeFile(previousSeed.filePath, '{"v":999}\n');
  await fs.writeFile(nextSeed.filePath, '{"v":999}\n');

  const adoption = store.adoptJournal(next, nextSeed.watermark);
  expect(store.journalPath()).toBe(nextSeed.filePath);
  adoption.rollback();
  expect(store.journalPath()).toBe(previousSeed.filePath);
  expect(() => store.materialize()).toThrow('Unsupported recording version');
}

async function verifyPinsTheAdoptedPrefixEvenWhenTheRecorderHasALaterDurable(): Promise<void> {
  const next = recorder('range');
  const selected = await seed(next, 'selected prefix');
  await next.commit('content', { content: row('outside selected range') });
  const store = new HistoryJournalStore();

  const adoption = store.adoptJournal(next, selected.watermark);
  expect(store.materialize()).toStrictEqual([row('selected prefix')]);
  adoption.rollback();
  expect(store.journalPath()).toBeNull();
  expect(store.materialize()).toStrictEqual([]);
}

async function verifyCanAdoptAnEmptyRangeWithoutReadingALaterDurableFile(): Promise<void> {
  const next = recorder('empty-range');
  await seed(next, 'outside empty range');
  const store = new HistoryJournalStore();
  const adoption = store.adoptJournal(next, { seq: 0, byteOffset: 0 });
  expect(store.materialize()).toStrictEqual([]);
  await adoption.commit();
  expect(store.materialize()).toStrictEqual([]);
}

async function verifyRejectsWritesAndOverlappingTransitionsUntilAdoptionIsSettled(): Promise<void> {
  const next = recorder('exclusive');
  const selected = await seed(next, 'candidate');
  const store = new HistoryJournalStore();
  const adoption = store.adoptJournal(next, selected.watermark);

  expect(() =>
    store.apply({ kind: 'content', content: row('racing write') }),
  ).toThrow('adoption');
  expect(() => store.adoptJournal(next, selected.watermark)).toThrow(
    'adoption',
  );
  expect(() => store.attachJournal(next)).toThrow('adoption');
  expect(() => store.dispose()).toThrow('adoption');
  adoption.rollback();
  expect(() => adoption.rollback()).toThrow('settled');
  await expect(adoption.commit()).rejects.toThrow('settled');
  expect(store.materialize()).toStrictEqual([]);
}

async function verifyRetiresASelfOwnedOldJournalOnlyAfterCommitPreservingRollback(): Promise<void> {
  const store = new HistoryJournalStore();
  store.apply({ kind: 'content', content: row('temporary row') });
  await store.waitForDurable();
  const previousPath = store.journalPath();
  if (previousPath === null) throw new Error('Expected temporary journal');
  const next = recorder('retirement');
  const selected = await seed(next, 'candidate');

  const cancelled = store.adoptJournal(next, selected.watermark);
  cancelled.rollback();
  expect(await fs.readFile(previousPath, 'utf8')).toContain('temporary row');
  const adoption = store.adoptJournal(next, selected.watermark);
  await adoption.commit();
  await expect(fs.stat(previousPath)).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(next.isActive()).toBe(true);
  expect(store.materialize()).toStrictEqual([row('candidate')]);
}
