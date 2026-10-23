/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { journalRows } from '../../recording/__tests__/support/journal-read-test-helpers.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';

import {
  suffixRow,
  withSuffixFixtureGraph,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import {
  RowOwnership,
  type RowOwnershipStats,
} from '../../recording/rowOwnership.js';
import {
  createCoreSuffixFixtureGraph,
  withCoreSuffixFixture,
  type CoreSuffixFixtureGraph,
} from './__tests__/support/core-suffix-fixture-test-helpers.js';
import { pausedNativeRollback } from './__tests__/support/native-rollback-owner-fixture.js';
import {
  HistoryService,
  type HistoryServiceJournalOptions,
} from './HistoryService.js';

async function sourceObservation(
  history: HistoryService,
  previous: RowOwnership,
): Promise<{ previous: RowOwnershipStats }> {
  expect(history).toBeInstanceOf(HistoryService);
  expect(previous).toBeInstanceOf(RowOwnership);
  return { previous: previous.snapshot() };
}

describe('source-owned suffix fixture boundary', () => {
  it('accepts a source service and source owner callback and infers the result', async () => {
    const result = await withCoreSuffixFixture(2, sourceObservation);
    const liveRows: number = result.previous.liveRows;
    expect(liveRows).toBe(0);
    expect(result.previous.peakRows).toBeLessThanOrEqual(440);
  });

  for (const size of [512, 8192]) {
    it(`streams and appends ${size} source-owned rows without retaining a full projection`, async () => {
      const transaction = new RowOwnership();
      await withCoreSuffixFixture(
        size,
        async (history: HistoryService, previous: RowOwnership) => {
          expect(history).toBeInstanceOf(HistoryService);
          expect(previous).toBeInstanceOf(RowOwnership);
          history.add(suffixRow(size, 2048));
          await history.waitForCommit();
          let seen = 0;
          for await (const row of history.streamRawHistory()) {
            expect(row).toStrictEqual(suffixRow(seen++, 2048));
          }
          expect(seen).toBe(size + 1);
          expect(previous.snapshot().liveRows).toBe(0);
          expect(transaction.snapshot().liveRows).toBe(0);
          expect(previous.snapshot().peakRows).toBeLessThanOrEqual(440);
          expect(previous.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
            8 * 1024 * 1024,
          );
        },
        2048,
        suffixRow,
        transaction,
      );
    }, 120_000);

    it(`keeps typed rollback observations and restores all ${size} rows`, async () => {
      const result = await pausedNativeRollback(size, false, 'density');
      const liveRows: number = result.previous.liveRows;
      expect(liveRows).toBe(0);
      expect(result.traversed).toBe(size);
      expect(result.bytes).toBeGreaterThan(size * 2048);
      expect(result.previous.peakRows).toBeLessThanOrEqual(440);
      expect(result.transaction.liveRows).toBeGreaterThan(0);
      expect(result.transaction.liveRows).toBeLessThanOrEqual(440);
      expect(result.transaction.liveSerializedBytes).toBeLessThanOrEqual(
        8 * 1024 * 1024,
      );
    }, 120_000);
  }

  it('exposes both violations from the 8192-row eager previous-owner trap', async () => {
    const result = await pausedNativeRollback(8192, true, 'density');
    expect(result.traversed).toBe(8192);
    expect(result.previous.peakRows).toBeGreaterThan(440);
    expect(result.previous.peakSerializedBytes).toBeGreaterThan(
      8 * 1024 * 1024,
    );
  }, 120_000);
});

describe('source graph failure cleanup', () => {
  it('closes a fully source-owned graph and removes its journal after callback failure', async () => {
    let graph: CoreSuffixFixtureGraph | undefined;
    let root = '';
    const failure = new Error('source suffix callback failure');
    await expect(
      withSuffixFixtureGraph(
        2,
        (directory) => {
          root = directory;
          graph = createCoreSuffixFixtureGraph(directory);
          expect(graph.service).toBeInstanceOf(HistoryService);
          expect(graph.recording).toBeInstanceOf(JournalRecordingService);
          expect(graph.ownership).toBeInstanceOf(RowOwnership);
          expect(graph.mutationOwnership).toBeInstanceOf(RowOwnership);
          return graph;
        },
        async (history: HistoryService, previous: RowOwnership) => {
          const result = await sourceObservation(history, previous);
          expect(result.previous.liveRows).toBe(0);
          expect(existsSync(root)).toBe(true);
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    if (graph === undefined)
      throw new Error('Source graph was not constructed');
    expect(graph.recording.isActive()).toBe(false);
    expect(graph.ownership.snapshot().liveRows).toBe(0);
    expect(graph.mutationOwnership.snapshot().liveRows).toBe(0);
    expect(root.length).toBeGreaterThan(0);
    expect(existsSync(root)).toBe(false);
  });
});

class FactoryHistory extends HistoryService {}

function capturedRecorder(
  recording: SessionRecordingPort | undefined,
): SessionRecordingPort {
  if (recording === undefined)
    throw new Error('Source factory was not invoked');
  return recording;
}

function sourceRecorder(
  recording: SessionRecordingPort | undefined,
): SessionRecordingPort {
  return capturedRecorder(recording);
}

async function verifySourceJournal(
  recording: SessionRecordingPort,
  size: number,
  payloadBytes: number,
): Promise<void> {
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing source journal');
  const rows = await journalRows(file);
  expect(rows).toHaveLength(size);
  for (const [index, row] of rows.entries())
    expect(row).toStrictEqual(suffixRow(index, payloadBytes));
}

describe('source factory record and flush', () => {
  it('uses source factory options for durable seeds, queued recording and typed results', async () => {
    let captured: SessionRecordingPort | undefined;
    const transaction = new RowOwnership();
    const result = await withCoreSuffixFixture(
      2,
      async (history: HistoryService, previous: RowOwnership) => {
        const recording = sourceRecorder(captured);
        expect(history).toBeInstanceOf(FactoryHistory);
        expect(recording).toBeInstanceOf(JournalRecordingService);
        expect(previous).toBeInstanceOf(RowOwnership);
        await verifySourceJournal(recording, 2, 64);
        await history.addBatch([suffixRow(2, 64)]);
        await history.waitForCommit();
        await recording.flush();
        await verifySourceJournal(recording, 3, 64);
        const file = recording.getFilePath();
        if (file === null) throw new Error('Missing flushed source journal');
        return statSync(file).size;
      },
      64,
      suffixRow,
      transaction,
      (options: HistoryServiceJournalOptions) => {
        captured = options.recording;
        expect(options.mutationOwnership).toBe(transaction);
        expect(options.attachmentCounters?.ownership).toBeInstanceOf(
          RowOwnership,
        );
        return new FactoryHistory(options);
      },
    );
    const durableBytes: number = result;
    expect(durableBytes).toBeGreaterThan(3 * 64);
    expect(sourceRecorder(captured).isActive()).toBe(false);
    expect(transaction.snapshot().liveRows).toBe(0);
  });
});

describe('source factory history publication', () => {
  it('publishes an append and reopens it after the durability barrier', async () => {
    let captured: SessionRecordingPort | undefined;
    await withCoreSuffixFixture(
      2,
      async (history: HistoryService, previous: RowOwnership) => {
        const recording = sourceRecorder(captured);
        expect(history).toBeInstanceOf(FactoryHistory);
        let publications = 0;
        history.on('contentAdded', () => publications++);
        history.add(suffixRow(2, 64));
        expect(history.length()).toBe(3);
        await history.waitForCommit();
        expect(publications).toBe(1);
        await verifySourceJournal(recording, 3, 64);
        let seen = 0;
        for await (const row of history.streamRawHistory())
          expect(row).toStrictEqual(suffixRow(seen++, 64));
        expect(seen).toBe(3);
        expect(previous.snapshot().liveRows).toBe(0);
        expect(previous.snapshot().peakRows).toBeLessThanOrEqual(440);
        expect(previous.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
          8 * 1024 * 1024,
        );
      },
      64,
      suffixRow,
      undefined,
      (options: HistoryServiceJournalOptions) => {
        captured = options.recording;
        return new FactoryHistory(options);
      },
    );
  });
});

describe('source factory seed failure cleanup', () => {
  it('preserves a row-generation failure and closes the source recorder before the callback', async () => {
    let captured: SessionRecordingPort | undefined;
    let root = '';
    let seedBytes = 0;
    const failure = new Error('source factory row generation failure');
    await expect(
      withCoreSuffixFixture(
        257,
        async () => {
          throw new Error('Callback ran after seed failure');
        },
        64,
        (index, bytes) => {
          if (index === 256) {
            const file = sourceRecorder(captured).getFilePath();
            if (file === null) throw new Error('Missing seeded source journal');
            root = dirname(file);
            seedBytes = statSync(file).size;
            throw failure;
          }
          return suffixRow(index, bytes);
        },
        undefined,
        (options: HistoryServiceJournalOptions) => {
          captured = options.recording;
          return new FactoryHistory(options);
        },
      ),
    ).rejects.toBe(failure);
    expect(sourceRecorder(captured).isActive()).toBe(false);
    expect(seedBytes).toBeGreaterThan(64);
    expect(root.length).toBeGreaterThan(0);
    expect(existsSync(root)).toBe(false);
  });
});

describe('source factory graph construction', () => {
  it('passes the same recorder and mutation owner into the source factory and returns its service', async () => {
    const transaction = new RowOwnership();
    await withSuffixFixtureGraph(
      1,
      (root) => {
        let captured: SessionRecordingPort | undefined;
        const graph = createCoreSuffixFixtureGraph(
          root,
          transaction,
          (options: HistoryServiceJournalOptions) => {
            captured = options.recording;
            expect(options.mutationOwnership).toBe(transaction);
            return new FactoryHistory(options);
          },
        );
        expect<SessionRecordingPort>(graph.recording).toBe(
          capturedRecorder(captured),
        );
        expect(graph.service).toBeInstanceOf(FactoryHistory);
        expect(graph.mutationOwnership).toBe(transaction);
        return graph;
      },
      async (history: HistoryService, previous: RowOwnership) => {
        expect(history).toBeInstanceOf(FactoryHistory);
        expect(previous.snapshot().liveRows).toBe(0);
      },
    );
  });
});
