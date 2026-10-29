/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import {
  suffixRow,
  suffixSeeder,
  withSuffixFixture,
  withSuffixFixtureGraph,
} from './history-suffix-test-helpers.js';
import { createRecorderForTest } from './recorder-for-test.js';

function realGraph(root: string): {
  service: HistoryService;
  recording: SessionRecordingPort;
  ownership: RowOwnership;
  counters: ReturnType<typeof createRowCounters>;
  seed: ReturnType<typeof suffixSeeder>;
} {
  const recording = createRecorderForTest({
    sessionId: 'suffix-test',
    projectHash: 'suffix-test',
    chatsDir: root,
  });
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  const service = new HistoryService({
    recording,
    attachmentCounters: { ...counters.counters, ownership },
  });
  return {
    service,
    recording,
    ownership,
    counters,
    seed: suffixSeeder(service),
  };
}

describe('suffix fixture journal lifecycle', () => {
  for (const size of [512, 8192]) {
    it(`streams ${size} durable rows and a later append in order on the default graph`, async () => {
      await withSuffixFixture(
        size,
        async (history, ownership, counters) => {
          expect(history).toBeInstanceOf(HistoryService);
          history.add(suffixRow(size, 2048));
          await history.waitForCommit();
          let seen = 0;
          for await (const row of history.streamRawHistory()) {
            expect(row).toStrictEqual(suffixRow(seen++, 2048));
          }
          expect(seen).toBe(size + 1);
          expect(counters.snapshot().rowsDecoded).toBeGreaterThanOrEqual(size);
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(440);
          expect(ownership.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
            8 * 1024 * 1024,
          );
        },
        2048,
      );
    }, 120_000);
  }
});

function historicalEmptyRow(index: number): IContent {
  const speakers: ReadonlyArray<IContent['speaker']> = ['human', 'tool', 'ai'];
  return { ...suffixRow(index), speaker: speakers[index], blocks: [] };
}

describe('historical suffix rows', () => {
  it('preserves empty recorded rows without admitting new zero-block turns', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const rows: IContent[] = [];
        for await (const row of history.streamRawHistory()) rows.push(row);
        expect(rows).toStrictEqual([
          { ...suffixRow(0), speaker: 'human', blocks: [] },
          { ...suffixRow(1), speaker: 'tool', blocks: [] },
          { ...suffixRow(2), speaker: 'ai', blocks: [] },
        ]);
        history.add({ speaker: 'human', blocks: [] });
        await history.waitForCommit();
        expect(history.length()).toBe(3);
        const curated: IContent[] = [];
        for await (const row of history.streamCuratedHistory())
          curated.push(row);
        expect(curated).toStrictEqual(rows.slice(0, 2));
      },
      0,
      historicalEmptyRow,
    );
  });
});

describe('suffix fixture failure cleanup', () => {
  it('removes the real journal directory and preserves the callback failure', async () => {
    let root = '';
    const failure = new Error('suffix callback failure');
    await expect(
      withSuffixFixtureGraph(
        2,
        (directory) => {
          root = directory;
          return realGraph(directory);
        },
        async (history) => {
          expect(existsSync(root)).toBe(true);
          let seen = 0;
          for await (const row of history.streamRawHistory()) {
            expect(row).toStrictEqual(suffixRow(seen++));
          }
          expect(seen).toBe(2);
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(root.length).toBeGreaterThan(0);
    expect(existsSync(root)).toBe(false);
  });

  for (const failingIndex of [0, 1, 257]) {
    it(`cleans up when generating seed row ${failingIndex} fails`, async () => {
      let root = '';
      const failure = new Error('suffix seed failure');
      await expect(
        withSuffixFixtureGraph(
          failingIndex + 1,
          (directory) => {
            root = directory;
            return realGraph(directory);
          },
          async (): Promise<void> => {
            throw new Error('callback must not run after seed failure');
          },
          0,
          (index) => {
            if (index === failingIndex) throw failure;
            return suffixRow(index);
          },
        ),
      ).rejects.toBe(failure);
      expect(root.length).toBeGreaterThan(0);
      expect(existsSync(root)).toBe(false);
    });
  }

  it('removes the directory when graph construction fails', async () => {
    let root = '';
    const failure = new Error('suffix factory failure');
    await expect(
      withSuffixFixtureGraph(
        0,
        (directory): never => {
          root = directory;
          expect(existsSync(root)).toBe(true);
          throw failure;
        },
        async (): Promise<void> => {
          throw new Error('callback must not run after factory failure');
        },
      ),
    ).rejects.toBe(failure);
    expect(root.length).toBeGreaterThan(0);
    expect(existsSync(root)).toBe(false);
  });
});
