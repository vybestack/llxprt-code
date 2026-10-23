/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import {
  testJournalSeams,
  type Failures,
} from '../journal/__tests__/support/journalFixtures.js';
import { RECORD_KIND } from '../journal/recordKinds.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import {
  PROJECT_HASH,
  recordingConfig,
  rowTexts,
  textRow,
} from './__tests__/support/journalRecordingFixture.js';

describe('RecordingIntegration journal lifecycle', () => {
  const directory = useTempDir('recording-lifecycle-');
  let recording: JournalRecordingService;
  let integration: RecordingIntegration;
  let history: HistoryService;
  const histories: HistoryService[] = [];
  beforeEach(() => {
    recording = JournalRecordingService.create(
      recordingConfig(join(directory(), 'chats')),
    );
    integration = new RecordingIntegration(recording);
    history = new HistoryService();
    histories.push(history);
  });
  afterEach(async () => {
    await integration.dispose();
    for (const item of histories.splice(0)) await item.dispose();
    await recording.dispose();
  });
  async function saved(): Promise<
    Awaited<ReturnType<typeof readJournalSnapshot>>
  > {
    await integration.flushAtTurnBoundary();
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing journal');
    return readJournalSnapshot(file, PROJECT_HASH);
  }
  async function texts(): Promise<string[]> {
    return rowTexts((await saved()).history);
  }
  function second(): HistoryService {
    const result = new HistoryService();
    histories.push(result);
    return result;
  }

  it('persists delegated provider/model switches', async () => {
    await integration.subscribeToJournal(history);
    integration.recordProviderSwitch('openai', 'gpt-5');
    history.add(textRow('materialize'));
    expect((await saved()).metadata).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
    });
  });
  it('persists delegated workspace directory changes', async () => {
    await integration.subscribeToJournal(history);
    integration.recordDirectoriesChanged(['/a', '/b', '/c']);
    history.add(textRow('materialize'));
    expect((await saved()).metadata.workspaceDirs).toStrictEqual([
      '/a',
      '/b',
      '/c',
    ]);
  });
  it('flushes pending rows at the turn boundary', async () => {
    await integration.subscribeToJournal(history);
    history.add(textRow('flush-boundary'));
    expect(await texts()).toStrictEqual(['flush-boundary']);
  });
  it('does not create a recording when there is no activity', async () => {
    await integration.flushAtTurnBoundary();
    expect(recording.getFilePath()).toBeNull();
  });
  it('flushes the latest generation after rapid additions without a snapshot file', async () => {
    await integration.subscribeToJournal(history);
    for (const text of ['first', 'second', 'final']) history.add(textRow(text));
    expect(await texts()).toStrictEqual(['first', 'second', 'final']);
    const files = await readdir(join(directory(), 'chats'));
    expect(files.filter((file) => file.endsWith('.llxj'))).toHaveLength(1);
    expect(files.filter((file) => !file.endsWith('.llxj'))).toStrictEqual([]);
  });
  it('publishes a complete batch in order', async () => {
    await integration.subscribeToJournal(history);
    await history.addBatch([
      textRow('batch first'),
      textRow('batch second', 'ai'),
    ]);
    expect(await texts()).toStrictEqual(['batch first', 'batch second']);
  });
  it('rolls back the durable batch when its publication listener fails', async () => {
    await integration.subscribeToJournal(history);
    history.on('contentBatchAdded', () => {
      throw new Error('publication listener failed');
    });
    await expect(
      history.addBatch([
        textRow('rejected first'),
        textRow('rejected second', 'ai'),
      ]),
    ).rejects.toThrow('publication listener failed');
    expect(await Array.fromAsync(history.streamRawHistory())).toStrictEqual([]);
    expect((await saved()).history).toStrictEqual([]);
    await integration.dispose();
    expect((await saved()).history).toStrictEqual([]);
  });
  it('prevents post-disposal recording while retaining previously committed rows', async () => {
    await integration.subscribeToJournal(history);
    history.add(textRow('before-dispose'));
    await integration.flushAtTurnBoundary();
    await integration.dispose();
    history.add(textRow('after-dispose'));
    await history.waitForCommit();
    expect(await texts()).toStrictEqual(['before-dispose']);
  });
  for (const mirror of [false, true]) {
    it(`joins the admitted batch through its held ${mirror ? 'mirror' : 'primary'} trailer before disposal`, async () => {
      await integration.dispose();
      await recording.dispose();
      const failures: Failures = { recordKinds: true };
      const seams = testJournalSeams(failures);
      recording = JournalRecordingService.create({
        ...recordingConfig(join(directory(), 'chats')),
        journal: { journal: seams.dependencies },
      });
      integration = new RecordingIntegration(recording);
      if (mirror) {
        history.add(textRow('baseline'));
        await history.waitForCommit();
      }
      await integration.subscribeToJournal(history);
      if (!mirror) history.add(textRow('baseline'));
      await integration.flushAtTurnBoundary();
      const trailers = (): number =>
        seams.events.filter(
          (event) =>
            event.type === 'write' && event.kind === RECORD_KIND.TRAILER,
        ).length;
      const held = trailers();
      failures.gateTrailerAt = held;
      const batch = history.addBatch([
        textRow('admitted user'),
        textRow('admitted response', 'ai'),
      ]);
      const boundary = integration.flushAtTurnBoundary();
      let disposed = false;
      try {
        while (trailers() <= held)
          await new Promise<void>((resolve) => setImmediate(resolve));
        const disposal = integration.dispose().then(() => {
          disposed = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(disposed).toBe(false);
        seams.release();
        await batch;
        await boundary;
        await disposal;
        expect(await texts()).toStrictEqual([
          'baseline',
          'admitted user',
          'admitted response',
        ]);
      } finally {
        seams.release();
      }
    });
  }
  it('shares its in-flight disposal and is idempotent after settlement', async () => {
    const first = integration.dispose();
    expect(integration.dispose()).toBe(first);
    await first;
    await expect(integration.dispose()).resolves.toBeUndefined();
  });
  it('switches journal subscription to the new history instance', async () => {
    const replacement = second();
    await integration.subscribeToJournal(history);
    await integration.subscribeToJournal(replacement);
    replacement.add(textRow('from-new-service'));
    expect(await texts()).toStrictEqual(['from-new-service']);
  });
  it('ignores additions from the detached history after replacement', async () => {
    const replacement = second();
    await integration.subscribeToJournal(history);
    await integration.subscribeToJournal(replacement);
    history.add(textRow('from-old-service'));
    replacement.add(textRow('from-new-service'));
    expect(await texts()).toStrictEqual(['from-new-service']);
  });
  it('can subscribe to the same history twice without duplicate rows', async () => {
    await integration.subscribeToJournal(history);
    await integration.subscribeToJournal(history);
    history.add(textRow('same-instance'));
    expect(await texts()).toStrictEqual(['same-instance']);
  });
  it('finishes journal detachment even when the external detachment rejects', async () => {
    await integration.subscribeToJournal(history);
    history.add(textRow('before-unsubscribe'));
    await integration.flushAtTurnBoundary();
    const detach = history.detachJournal.bind(history);
    const injected = spyOn(history, 'detachJournal').mockImplementationOnce(
      async (recorder) => {
        await detach(recorder);
        throw new Error('journal detach failed');
      },
    );
    try {
      expect(() => integration.unsubscribeFromHistory()).not.toThrow();
      await expect(integration.dispose()).rejects.toThrow(
        'journal detach failed',
      );
      history.add(textRow('after-unsubscribe'));
      await history.waitForCommit();
      expect(await texts()).toStrictEqual(['before-unsubscribe']);
    } finally {
      injected.mockRestore();
    }
  });
});
