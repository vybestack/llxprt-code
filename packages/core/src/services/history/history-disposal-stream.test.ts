/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryService } from './HistoryService.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

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

async function commitRows(history: HistoryService): Promise<void> {
  await history.addBatch(
    Array.from({ length: 512 }, (_, index) => suffixRow(index)),
  );
  await history.waitForCommit();
  expect(history.length()).toBe(512);
}

describe('closed history stream access and durable cleanup', () => {
  it('rejects cold and new reads before closing its unlinked journal', async () => {
    const history = new HistoryService();
    try {
      await commitRows(history);
      expect(history.journalPath()).toBeNull();
      const cold = history.streamRawHistory();
      let microtaskRan = false;
      queueMicrotask(() => {
        microtaskRan = true;
      });
      const disposal = history.dispose();
      expect(microtaskRan).toBe(false);
      await expectClosed(cold);
      await expectClosed(history.streamRawHistory());
      await disposal;
    } finally {
      await history.dispose();
    }
  }, 10_000);

  it('rejects access to an injected journal without deleting caller-owned durable records or retaining read ownership', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'history-disposal-stream-'));
    const recorder = JournalRecordingService.create({
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
      const file = recorder.getFilePath();
      if (file === null) throw new Error('Missing injected durable journal');
      await history.dispose();
      await expectClosed(history.streamRawHistory());
      expect(counters.snapshot().rowsDecoded).toBe(512);
      expect(counters.snapshot().peakDecodedRows).toBe(1);
      expect(ownership.snapshot().liveRows).toBe(0);
      await recorder.dispose();
      expect(existsSync(file)).toBe(true);
    } finally {
      await history.dispose();
      await recorder.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 10_000);
});
