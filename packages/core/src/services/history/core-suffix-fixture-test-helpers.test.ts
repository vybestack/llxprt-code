/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { foldDurableRows } from '../../recording/durableRowFold.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import {
  HistoryService,
  type HistoryServiceJournalOptions,
} from './HistoryService.js';
import {
  RowOwnership,
  type RowOwnershipStats,
} from '../../recording/rowOwnership.js';
import {
  suffixRow,
  withSuffixFixtureGraph,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  withCoreSuffixFixture,
  createCoreSuffixFixtureGraph,
  type CoreSuffixFixtureGraph,
} from './core-suffix-fixture-test-helpers.js';
import { pausedDensity } from './chronology-rollback-owner-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';

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
      const result = await pausedDensity(size, false);
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
    const result = await pausedDensity(8192, true);
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
          expect(graph.recording).toBeInstanceOf(SessionRecordingService);
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

function sourceRecorder(
  recording: SessionRecordingService | undefined,
): SessionRecordingService {
  if (recording === undefined)
    throw new Error('Source factory was not invoked');
  return recording;
}

async function verifySourceJournal(
  recording: SessionRecordingService,
  size: number,
  payloadBytes: number,
): Promise<void> {
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing source journal');
  const reopened = await foldDurableRows({
    filePath: file,
    maxBytes: statSync(file).size,
  });
  try {
    expect(reopened.length).toBe(size);
    for (let index = 0; index < size; index++)
      expect(await reopened.readRow(index)).toStrictEqual(
        suffixRow(index, payloadBytes),
      );
  } finally {
    await reopened.close();
  }
}

describe('source factory record and flush', () => {
  it('uses source factory options for durable seeds, queued recording and typed results', async () => {
    let captured: SessionRecordingService | undefined;
    const transaction = new RowOwnership();
    const result = await withCoreSuffixFixture(
      2,
      async (history: HistoryService, previous: RowOwnership) => {
        const recording = sourceRecorder(captured);
        expect(history).toBeInstanceOf(FactoryHistory);
        expect(recording).toBeInstanceOf(SessionRecordingService);
        expect(previous).toBeInstanceOf(RowOwnership);
        expect({
          bytes: recording.getPendingByteCount(),
          records: recording.getPendingRecordCount(),
        }).toStrictEqual({ bytes: 0, records: 0 });
        await verifySourceJournal(recording, 2, 64);
        recording.recordContent(suffixRow(2, 64));
        expect(recording.getPendingByteCount()).toBeGreaterThan(0);
        await recording.flush();
        expect(recording.getPendingByteCount()).toBe(0);
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
  it('publishes an append in the same turn and reopens it after the durability barrier', async () => {
    let captured: SessionRecordingService | undefined;
    await withCoreSuffixFixture(
      2,
      async (history: HistoryService, previous: RowOwnership) => {
        const recording = sourceRecorder(captured);
        expect(history).toBeInstanceOf(FactoryHistory);
        let publications = 0;
        history.on('contentAdded', () => publications++);
        history.add(suffixRow(2, 64));
        expect(history.length()).toBe(3);
        expect(publications).toBe(1);
        await history.waitForCommit();
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

describe('source factory writer failure', () => {
  it('surfaces a real append failure through flush and poisoned commit and releases queue bytes', async () => {
    let captured: SessionRecordingService | undefined;
    await withCoreSuffixFixture(
      1,
      async (history: HistoryService, previous: RowOwnership) => {
        const recording = sourceRecorder(captured);
        expect(history).toBeInstanceOf(FactoryHistory);
        const file = recording.getFilePath();
        if (file === null) throw new Error('Missing source journal');
        renameSync(file, file + '.preserved');
        mkdirSync(file);
        recording.recordContent(suffixRow(1));
        expect(recording.getPendingByteCount()).toBeGreaterThan(0);
        const failure = await rejectedValue(recording.flush());
        expect(failure).toMatchObject({ code: 'EISDIR' });
        await expect(
          recording.commit('content', { content: suffixRow(2) }),
        ).rejects.toBe(failure);
        expect(recording.getPendingByteCount()).toBe(0);
        expect(recording.getPendingRecordCount()).toBe(0);
        expect(recording.isActive()).toBe(false);
        expect(previous.snapshot().liveRows).toBe(0);
      },
      0,
      suffixRow,
      undefined,
      (options: HistoryServiceJournalOptions) => {
        captured = options.recording;
        return new FactoryHistory(options);
      },
    );
    expect(sourceRecorder(captured).getPendingByteCount()).toBe(0);
  });
});

describe('source factory seed failure cleanup', () => {
  it('preserves a row-generation failure and closes the source recorder before the callback', async () => {
    let captured: SessionRecordingService | undefined;
    let root = '';
    let seedBytes = 0;
    const failure = new Error('source factory row generation failure');
    await expect(
      withCoreSuffixFixture(
        2,
        async () => {
          throw new Error('Callback ran after seed failure');
        },
        64,
        (index, bytes) => {
          if (index === 1) {
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
    expect(sourceRecorder(captured).getPendingByteCount()).toBe(0);
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
        let captured: SessionRecordingService | undefined;
        const graph = createCoreSuffixFixtureGraph(
          root,
          transaction,
          (options: HistoryServiceJournalOptions) => {
            captured = options.recording;
            expect(options.mutationOwnership).toBe(transaction);
            return new FactoryHistory(options);
          },
        );
        expect(graph.recording).toBe(sourceRecorder(captured));
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
