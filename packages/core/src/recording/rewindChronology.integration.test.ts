/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { NativeHistoryPrefixOwner } from '../services/history/native-history-prefix.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { makeDensityResult } from './durable-mutations.test.helpers.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import {
  PROJECT_HASH,
  recordingConfig,
  rowTexts,
  textRow,
} from './__tests__/support/journalRecordingFixture.js';

describe('native rewind chronology survives density changes', () => {
  const directory = useTempDir('rewind-native-');
  let history: HistoryService;
  let recording: JournalRecordingService;
  beforeEach(() => {
    recording = JournalRecordingService.create(recordingConfig(directory()));
    history = new HistoryService({ recording });
  });
  afterEach(async () => {
    await history.dispose();
    await recording.dispose();
  });

  async function seed(): Promise<void> {
    await history.addBatch([
      textRow('Q1'),
      textRow('A1', 'ai'),
      textRow('Q2'),
      textRow('A2', 'ai'),
      textRow('Q3'),
      textRow('A3', 'ai'),
      textRow('T3', 'tool'),
      textRow('A3-followup', 'ai'),
    ]);
    await history.applyDensityResult(makeDensityResult([6]));
  }
  async function cut(turns: number, fromEnd: boolean): Promise<void> {
    await new NativeHistoryPrefixOwner(history).withPrefix(
      turns,
      fromEnd,
      undefined,
      async (prefix) => {
        await prefix.apply(history);
      },
    );
  }
  async function saved(): Promise<
    Awaited<ReturnType<typeof readJournalSnapshot>>
  > {
    await history.waitForCommit();
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing journal');
    return readJournalSnapshot(file, PROJECT_HASH);
  }

  it('restore keeps removed turns removed in the reopened version', async () => {
    await seed();
    expect(
      rowTexts(await Array.fromAsync(history.streamRawHistory())),
    ).toStrictEqual(['Q1', 'A1', 'Q2', 'A2', 'Q3', 'A3', 'A3-followup']);
    await cut(1, true);
    expect(rowTexts((await saved()).history)).toStrictEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
    ]);
  });
  it('clear keeps only the first human-led turn after density removal', async () => {
    await history.addBatch([
      textRow('Q1'),
      textRow('A1', 'ai'),
      textRow('T1', 'tool'),
      textRow('Q2'),
      textRow('A2', 'ai'),
      textRow('T2', 'tool'),
      textRow('Q3'),
    ]);
    await history.applyDensityResult(makeDensityResult([5]));
    await cut(2, false);
    expect(rowTexts((await saved()).history)).toStrictEqual(['Q1', 'A1', 'T1']);
  });
  it('preserves the exact live token total after restore and reopening', async () => {
    await seed();
    await cut(1, true);
    const live = await Array.fromAsync(history.streamRawHistory());
    const reopened = (await saved()).history;
    const expected = await history.estimateTokensForContents(live);
    expect(expected).toBeGreaterThan(0);
    expect(await history.estimateTokensForContents([...reopened])).toBe(
      expected,
    );
    expect(reopened).toStrictEqual(live);
  });
  it('keeps replacement values and chronology before the clear cut', async () => {
    await history.addBatch([
      textRow('Q1'),
      textRow('A1', 'ai'),
      textRow('T1', 'tool'),
      textRow('Q2'),
      textRow('A2', 'ai'),
    ]);
    await history.applyDensityResult(
      makeDensityResult([4], new Map([[2, textRow('T1 (truncated)', 'tool')]])),
    );
    await cut(2, false);
    const reopened = (await saved()).history;
    expect(rowTexts(reopened)).toStrictEqual(['Q1', 'A1', 'T1 (truncated)']);
    expect(reopened.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
      1, 2, 3,
    ]);
  });
  it('restoring more turns than exist leaves an empty durable version', async () => {
    await history.addBatch([
      textRow('Q1'),
      textRow('A1', 'ai'),
      textRow('T1', 'tool'),
      textRow('Q2'),
    ]);
    await history.applyDensityResult(makeDensityResult([2]));
    await cut(5, true);
    expect((await saved()).history).toStrictEqual([]);
  });
  it('cuts unmarked native rows by their labels rather than chronology markers', async () => {
    const session = await recording.session();
    await session.append([
      textRow('Q1'),
      textRow('A1', 'ai'),
      textRow('Q2'),
      textRow('A2', 'ai'),
    ]);
    expect(
      (await Array.fromAsync(session.rows())).every(
        (row) => row.content.metadata?.chronology === undefined,
      ),
    ).toBe(true);
    const { JournalResumeBoot, resumePointOf } = await import(
      './journalResume.js'
    );
    await history.adoptResumeBoot(
      recording,
      new JournalResumeBoot(recording, await resumePointOf(recording)),
    );
    await cut(1, true);
    expect(rowTexts((await saved()).history)).toStrictEqual(['Q1', 'A1']);
    expect((await saved()).history).toStrictEqual(
      await Array.fromAsync(history.streamRawHistory()),
    );
  });
});
