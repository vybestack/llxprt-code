/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalSession } from '../services/history/journalSession.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { makeDensityResult } from './durable-mutations.test.helpers.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import {
  PROJECT_HASH,
  recordingConfig,
  rowTexts,
  textRow,
} from './__tests__/support/journalRecordingFixture.js';

describe('durable native mutations preserve membership and chronology', () => {
  const directory = useTempDir('durable-native-');
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

  async function saved(): Promise<readonly IContent[]> {
    await history.waitForCommit();
    await recording.flush();
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing journal');
    return (await readJournalSnapshot(file, PROJECT_HASH)).history;
  }
  async function assertRows(
    expected: ReadonlyArray<{ chron: number; text: string }>,
  ): Promise<void> {
    const durable = await saved();
    expect(
      durable.map((content) => ({
        chron: content.metadata?.chronology?.seq,
        text: rowTexts([content])[0],
      })),
    ).toStrictEqual([...expected]);
    expect(await Array.fromAsync(history.streamRawHistory())).toStrictEqual([
      ...durable,
    ]);
    const survivors = new Set(
      durable.map((row) => row.metadata?.chronology?.seq),
    );
    for (const span of history.getContextRange().removedInterior) {
      for (let seq = span.start; seq <= span.end; seq++)
        expect(survivors.has(seq)).toBe(span.reason === 'density-replaced');
    }
  }
  function call(): IContent {
    return {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'B' },
        {
          type: 'tool_call',
          id: 'call-7',
          name: 'runner',
          parameters: { q: 1 },
        },
      ],
    };
  }

  it('retains the exact density-removal prefix and membership spans', async () => {
    await history.addBatch([
      textRow('A'),
      textRow('B', 'ai'),
      textRow('C', 'ai'),
    ]);
    await history.applyDensityResult(makeDensityResult([1]));
    expect(history.getStatistics().totalMessages).toBeGreaterThan(0);
    await assertRows([
      { chron: 1, text: 'A' },
      { chron: 3, text: 'C' },
    ]);
  });
  it('persists a density replacement under the inherited chronology marker', async () => {
    await history.addBatch([
      textRow('A'),
      textRow('B', 'ai'),
      textRow('C', 'ai'),
    ]);
    await history.applyDensityResult(
      makeDensityResult([], new Map([[1, textRow('B-dense', 'ai')]])),
    );
    expect(history.getStatistics().totalMessages).toBeGreaterThan(0);
    await assertRows([
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B-dense' },
      { chron: 3, text: 'C' },
    ]);
  });
  it('persists a synthetic response with its own row identity and chronology', async () => {
    await history.addBatch([textRow('Q1'), call()]);
    await history.validateAndFix();
    const rows = await saved();
    expect(rows).toHaveLength(3);
    expect(rows[2].speaker).toBe('tool');
    expect(rows[2].blocks).toContainEqual(
      expect.objectContaining({ type: 'tool_response', callId: 'call-7' }),
    );
    expect(rows.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
      1, 2, 3,
    ]);
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing journal');
    const session = await JournalSession.open(file);
    try {
      const stored = await Array.fromAsync(session.rows());
      expect(new Set(stored.map((row) => row.entry.label)).size).toBe(3);
      expect(stored[2].entry.recordOffset).not.toBe(
        stored[1].entry.recordOffset,
      );
    } finally {
      await session.close();
    }
  });
  it('retains density removal and synthetic response after a prefix rewind', async () => {
    await history.addBatch([
      textRow('A'),
      call(),
      textRow('C', 'ai'),
      textRow('D'),
    ]);
    await history.applyDensityResult(makeDensityResult([2]));
    await history.validateAndFix();
    const before = await Array.fromAsync(history.streamRawHistory());
    expect(before).toHaveLength(4);
    expect(before[2].blocks).toContainEqual(
      expect.objectContaining({ type: 'tool_response', callId: 'call-7' }),
    );
    await history.replaceAll(before.slice(0, -1));
    const durable = await saved();
    expect(durable).toStrictEqual(before.slice(0, 3));
    expect(rowTexts(durable).slice(0, 2)).toStrictEqual(['A', 'B']);
    expect(durable.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
      1,
      2,
      before[2].metadata?.chronology?.seq,
    ]);
  });
});
