/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { observeHistorySynchronouslyForTest } from '../../test-utils/synchronous-history-test-observation.js';
import { HistoryService } from './HistoryService.js';
import { suffixRow } from './history-suffix-test-helpers.js';

async function expectClosed(
  rows: ReturnType<HistoryService['streamRawHistory']>,
): Promise<void> {
  try {
    await expect(rows.next()).rejects.toThrow('disposed');
    expect((await rows.next()).done).toBe(true);
  } finally {
    await rows.return();
  }
}

async function waitForRemoval(directory: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (existsSync(directory) && Date.now() < deadline) await Bun.sleep(10);
  expect(existsSync(directory)).toBe(false);
}

async function commitRows(history: HistoryService): Promise<void> {
  await history.addBatch(
    Array.from({ length: 512 }, (_, index) => suffixRow(index)),
  );
  await history.waitForCommit();
  expect(history.length()).toBe(512);
}

describe('closed history stream access and durable cleanup', () => {
  it('rejects cold and new reads before independently removing its owned durable journal', async () => {
    const history = new HistoryService();
    let directory: string | undefined;
    try {
      await commitRows(history);
      const file = history.journalPath();
      if (file === null) throw new Error('Missing committed owned journal');
      directory = dirname(file);
      expect(existsSync(file)).toBe(true);
      const cold = history.streamRawHistory();
      let microtaskRan = false;
      queueMicrotask(() => {
        microtaskRan = true;
      });
      history.dispose();
      expect(microtaskRan).toBe(false);
      expect(observeHistorySynchronouslyForTest(history)).toHaveLength(512);
      await expectClosed(cold);
      await expectClosed(history.streamRawHistory());
      await waitForRemoval(directory);
    } finally {
      history.dispose();
      if (directory !== undefined)
        rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it('rejects access to an injected journal without deleting caller-owned durable records or retaining read ownership', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'history-disposal-stream-'));
    const recorder = new SessionRecordingService({
      sessionId: 'closed-stream',
      projectHash: 'closed-stream',
      chatsDir: directory,
      workspaceDirs: [directory],
      provider: 'test',
      model: 'test',
    });
    const counters = createRowCounters();
    const ownership = new RowOwnership();
    const history = new HistoryService({
      recording: recorder,
      attachmentCounters: { ...counters.counters, ownership },
    });
    try {
      await commitRows(history);
      let count = 0;
      for await (const row of history.streamRawHistory())
        expect(row.metadata?.chronology?.seq).toBe(++count);
      expect(count).toBe(512);
      history.dispose();
      expect(observeHistorySynchronouslyForTest(history)).toHaveLength(512);
      await expectClosed(history.streamRawHistory());
      expect(counters.snapshot().rowsDecoded).toBe(512);
      expect(counters.snapshot().peakDecodedRows).toBe(1);
      expect(ownership.snapshot().liveRows).toBe(0);
      await recorder.dispose();
      const file = history.journalPath();
      if (file === null) throw new Error('Missing injected durable journal');
      expect(existsSync(file)).toBe(true);
    } finally {
      history.dispose();
      await recorder.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);
});
