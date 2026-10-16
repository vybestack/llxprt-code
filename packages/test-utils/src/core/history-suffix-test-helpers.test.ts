/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import {
  suffixRow,
  withSuffixFixture,
  withSuffixFixtureGraph,
} from './history-suffix-test-helpers.js';

function realGraph(root: string): {
  service: HistoryService;
  recording: SessionRecordingService;
  ownership: RowOwnership;
  counters: ReturnType<typeof createRowCounters>;
} {
  const recording = new SessionRecordingService({
    sessionId: 'suffix-test',
    projectHash: 'suffix-test',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  const service = new HistoryService({
    recording,
    attachmentCounters: { ...counters.counters, ownership },
  });
  return { service, recording, ownership, counters };
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

  it('cleans up when generating a seed row fails', async () => {
    let root = '';
    const failure = new Error('suffix seed failure');
    await expect(
      withSuffixFixtureGraph(
        3,
        (directory) => {
          root = directory;
          return realGraph(directory);
        },
        async (): Promise<void> => {
          throw new Error('callback must not run after seed failure');
        },
        0,
        (index) => {
          if (index === 1) throw failure;
          return suffixRow(index);
        },
      ),
    ).rejects.toBe(failure);
    expect(root.length).toBeGreaterThan(0);
    expect(existsSync(root)).toBe(false);
  });

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
