import {
  collectRowsForAssertions,
  collectJournalRowsForAssertions,
} from '../../test-utils/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { appendFile, access, mkdtemp, rm, stat } from 'node:fs/promises';
import type { RecordingWriterIo } from '../../recording/types.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { MediaAdmissionService } from '../../storage/media-admission-service.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from './HistoryService.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import type { IContent } from './IContent.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { RecordingIntegration } from '../../recording/RecordingIntegration.js';
import { JournalResolver } from '../../recording/journalResolver.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { replaySession } from '../../recording/ReplayEngine.js';
import { writeResumeProjection } from './historyResumeProjection.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function journalFile(history: HistoryService): string {
  const filePath = history.journalPath();
  if (filePath === null) throw new Error('Missing history journal');
  return filePath;
}

let directory: string;

let recorders: SessionRecordingService[];

let histories: HistoryService[];

function recorder(id: string, io?: RecordingWriterIo): SessionRecordingService {
  const recording = new SessionRecordingService({
    sessionId: id,
    io,
    projectHash: 'attachment',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  recorders.push(recording);
  return recording;
}

describe('bounded journal attachment', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'history-attachment-'));
    recorders = [];
    histories = [];
  });
  afterEach(async () => {
    for (const history of histories) history.dispose();
    await Promise.all(recorders.map((recording) => recording.dispose()));
    await rm(directory, { recursive: true, force: true });
  });

  it(
    'orders an attachment back to the original recorder behind an in-flight attachment',
    verifyOrdersAnAttachmentBackToTheOriginalRecorderBehindAnInFlight,
  );

  it(
    'rejects a stale destination range without removing a concurrently accepted recorder append',
    verifyRejectsAStaleDestinationRangeWithoutRemovingAConcurrentlyAcceptedRecorderAppend,
  );

  it(
    'reports committed destination effects after a write failure without discarding the source or queued additions',
    verifyReportsCommittedDestinationEffectsAfterAWriteFailureWithoutDiscardingTheSource,
  );

  it(
    'keeps the original journal usable when a retirement observer rejects publication',
    verifyKeepsTheOriginalJournalUsableWhenARetirementObserverRejectsPublication,
  );

  it(
    'late-attaches bare history through the recording integration without eager reads',
    verifyLateAttachesBareHistoryThroughTheRecordingIntegrationWithoutEagerReads,
  );

  it(
    'preserves destination then source ordering and queues later accepted history mutations',
    verifyPreservesDestinationThenSourceOrderingAndQueuesLaterAcceptedHistoryMutations,
  );

  it(
    'keeps the original binding usable when the destination rejects attachment',
    verifyKeepsTheOriginalBindingUsableWhenTheDestinationRejectsAttachment,
  );

  it(
    'copies only the selected source range, not a later external tail',
    verifyCopiesOnlyTheSelectedSourceRangeNotALaterExternalTail,
  );

  it(
    'makes projected media and response stripping durable before releasing projection ownership',
    verifyMakesProjectedMediaAndResponseStrippingDurableBeforeReleasingProjectionOwnership,
  );

  it(
    'restores the original binding when publication fails and retains later accepted writes',
    verifyRestoresTheOriginalBindingWhenPublicationFailsAndRetainsLaterAcceptedWrites,
  );

  it(
    'preserves chronology and context membership across attachment and subsequent addressed replacement',
    verifyPreservesChronologyAndContextMembershipAcrossAttachmentAndSubsequentAddressedReplacement,
  );

  it.each([512, 8192])(
    'streams %s uncompressed rows through real attachment with constant decoded residency',
    verifyStreamsCountUncompressedRowsThroughRealAttachmentWithConstantDecodedResidency,
  );
});

async function verifyOrdersAnAttachmentBackToTheOriginalRecorderBehindAnInFlight(): Promise<void> {
  const original = recorder('fifo-original');
  const history = new HistoryService({ recording: original });
  histories.push(history);
  history.add(row('original'));
  const next = recorder('fifo-next');
  const first = history.attachJournal(next, true);
  const second = history.attachJournal(original, true);
  history.add(row('after both'));
  await Promise.all([first, second]);
  await history.waitForCommit();
  expect(history.journalPath()).toBe(original.getFilePath());
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((content) => content.blocks)).toStrictEqual([
      row('original').blocks,
      row('after both').blocks,
    ]);
  });
}

async function verifyRejectsAStaleDestinationRangeWithoutRemovingAConcurrentlyAcceptedRecorderAppend(): Promise<void> {
  const source = recorder('range-source');
  await source.commit('content', { content: row('source') });
  const destination = recorder('range-destination');
  await destination.commit('content', { content: row('existing') });
  let envelopes = 0;
  const history = new HistoryService({
    recording: source,
    attachmentCounters: {
      recordDecoded() {
        if (++envelopes === 3)
          destination.recordContent(row('concurrent accepted'));
      },
      rowDecoded() {},
      rowReleased() {},
    },
  });
  histories.push(history);
  await expect(history.attachJournal(destination, true)).rejects.toThrow(
    'Destination recording changed',
  );
  await destination.flush();
  expect(history.journalPath()).toBe(source.getFilePath());
  const reopened = new HistoryJournalStore(destination);
  expect(reopened.materialize().map((content) => content.blocks)).toStrictEqual(
    [row('existing').blocks, row('concurrent accepted').blocks],
  );
  reopened.dispose();
}

async function verifyReportsCommittedDestinationEffectsAfterAWriteFailureWithoutDiscardingTheSource(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('first source'));
  history.add(row('rejected source'));
  await history.waitForCommit();
  const originalFile = await stat(journalFile(history));
  const destination = recorder('partial', {
    async appendFile(file, data, encoding) {
      if (data.includes('rejected source'))
        throw new Error('injected append failure');
      await appendFile(file, data, encoding);
    },
  });
  destination.recordContent(row('destination'));
  const attaching = history.attachJournal(destination, true);
  history.add(row('accepted later'));
  await expect(attaching).rejects.toMatchObject({
    committedRows: 1,
    destinationRewound: true,
  });
  await history.waitForCommit();
  expect((await stat(journalFile(history))).ino).toBe(originalFile.ino);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((content) => content.blocks)).toStrictEqual([
      row('first source').blocks,
      row('rejected source').blocks,
      row('accepted later').blocks,
    ]);
  });
  const reopened = new HistoryJournalStore(destination);
  expect(reopened.materialize().map((content) => content.blocks)).toStrictEqual(
    [row('first source').blocks],
  );
  reopened.dispose();
}

async function verifyKeepsTheOriginalJournalUsableWhenARetirementObserverRejectsPublication(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('retained'));
  await history.waitForCommit();
  const originalFile = await stat(journalFile(history));
  const unsubscribe = history.onJournalRetired(() => {
    throw new Error('retirement observer');
  });
  const attaching = history.attachJournal(recorder('retirement'));
  history.add(row('queued'));
  await expect(attaching).rejects.toThrow('retirement observer');
  unsubscribe();
  await history.waitForCommit();
  expect((await stat(journalFile(history))).ino).toBe(originalFile.ino);
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((content) => content.blocks)).toStrictEqual([
      row('retained').blocks,
      row('queued').blocks,
    ]);
  });
}

async function verifyLateAttachesBareHistoryThroughTheRecordingIntegrationWithoutEagerReads(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('source'));
  const destination = recorder('destination');
  destination.recordContent(row('discarded destination'));
  const integration = new RecordingIntegration(destination);
  const eager = spyOn(
    HistoryJournalStore.prototype,
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
  await destination.commit('content', { content: row('borrowed') });
  await collectRowsForAssertions(history.streamRawHistory(), (detachedRows) => {
    expect(detachedRows.map((content) => content.blocks)).toStrictEqual([
      row('source').blocks,
      row('after').blocks,
    ]);
  });
}

async function verifyPreservesDestinationThenSourceOrderingAndQueuesLaterAcceptedHistoryMutations(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('source'));
  const destination = recorder('append');
  destination.recordContent(row('destination'));
  const attachment = history.attachJournal(destination);
  history.add(row('later'));
  await attachment;
  await history.waitForCommit();
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows.map((content) => content.blocks)).toStrictEqual([
      row('destination').blocks,
      row('source').blocks,
      row('later').blocks,
    ]);
  });
}

async function verifyKeepsTheOriginalBindingUsableWhenTheDestinationRejectsAttachment(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('source'));
  await history.waitForCommit();
  const originalFile = await stat(journalFile(history));
  const destination = recorder('disposed');
  await destination.dispose();
  await expect(history.attachJournal(destination, true)).rejects.toThrow(
    'Journal attachment failed',
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

async function verifyCopiesOnlyTheSelectedSourceRangeNotALaterExternalTail(): Promise<void> {
  const source = recorder('pinned-source');
  const watermark = await source.commit('content', {
    content: row('selected'),
  });
  const store = new HistoryJournalStore();
  await store.adoptJournal(source, watermark).commit();
  await source.commit('content', { content: row('outside range') });
  const destination = recorder('pinned-target');
  await store.attachJournal(destination);
  expect(store.materialize()).toStrictEqual([row('selected')]);
  store.dispose();
}

async function verifyMakesProjectedMediaAndResponseStrippingDurableBeforeReleasingProjectionOwnership(): Promise<void> {
  const source = recorder('projected-source');
  const watermark = await source.commit('content', {
    content: row('legacy'),
  });
  const mediaStore = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const admission = new MediaAdmissionService(mediaStore);
  const context = { turnId: 'projection', source: 'attachment-test' };
  const admitted = await admission.admitContents(
    [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          },
        ],
      },
    ],
    context,
  );
  const projected: IContent = {
    speaker: 'ai',
    blocks: admitted[0].blocks,
    metadata: {
      responsesStored: true,
      chronology: { seq: 7, userTurn: 1, step: 1, recordedAt: 10 },
    },
  };
  const projection = await writeResumeProjection(
    (async function* () {
      yield projected;
    })(),
    async () => {},
  );
  const store = new HistoryJournalStore();
  await store.adoptJournal(source, watermark, true, projection).commit();
  store.apply({ kind: 'content', content: row('tail') });
  const destination = recorder('projected-target');
  await store.attachJournal(destination, true);
  const reopened = new HistoryJournalStore(destination);
  expect(reopened.materialize()).toStrictEqual([
    {
      ...projected,
      metadata: { chronology: projected.metadata?.chronology },
    },
    { ...row('tail'), metadata: {} },
  ]);
  await expect(access(projection.filePath)).rejects.toMatchObject({
    code: 'ENOENT',
  });
  const block = projected.blocks[0];
  if (block.type !== 'media' || block.encoding !== 'reference')
    throw new Error('Missing media reference');
  expect(await mediaStore.hasReservations(block.contentId)).toBe(true);
  store.dispose();
  reopened.dispose();
  await admission.releaseContents(admitted, context);
  await mediaStore.close();
}

async function verifyRestoresTheOriginalBindingWhenPublicationFailsAndRetainsLaterAcceptedWrites(): Promise<void> {
  const history = new HistoryService();
  histories.push(history);
  history.add(row('original'));
  await history.waitForCommit();
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
  await destination.commit('content', { content: row('still usable') });
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
    destination.recordContent(row('discarded'));
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
    const reopened = new HistoryJournalStore(destination);
    expect(reopened.materialize()).toStrictEqual([
      expectedRows[0],
      replacement,
    ]);
    reopened.dispose();
  });
}

async function verifyStreamsCountUncompressedRowsThroughRealAttachmentWithConstantDecodedResidency(
  count: number,
): Promise<void> {
  const source = recorder(`source-${count}`);
  for (let index = 0; index < count; index++) {
    await source.commit('content', {
      content: row(`${index}:${'x'.repeat(256)}`),
    });
  }
  const measured = createRowCounters();
  const history = new HistoryService({
    recording: source,
    attachmentCounters: measured.counters,
  });
  histories.push(history);
  const destination = recorder(`destination-${count}`);
  const integration = new RecordingIntegration(destination);
  await integration.subscribeToJournal(history);
  await history.waitForCommit();
  expect(history.journalPath()).toBe(destination.getFilePath());
  expect(measured.snapshot().rowsDecoded).toBeGreaterThanOrEqual(count);
  expect(measured.snapshot().peakDecodedRows).toBeLessThanOrEqual(2);
  const file = destination.getFilePath();
  if (file === null) throw new Error('Missing destination');
  const resolver = await JournalResolver.open(file);
  let index = 0;
  try {
    for await (const entry of resolver.resolve()) {
      expect(entry.content.blocks).toStrictEqual(
        row(`${index}:${'x'.repeat(256)}`).blocks,
      );
      index++;
    }
  } finally {
    await resolver.close();
  }
  expect(index).toBe(count);
  const negative = createRowCounters();
  const eager = await replaySession(file, 'attachment', {
    counters: negative.counters,
  });
  expect(eager.ok).toBe(true);
  expect(negative.snapshot().peakDecodedRows).toBe(count);
  await integration.dispose();
}
