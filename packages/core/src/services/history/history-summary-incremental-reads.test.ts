/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { HistoryService } from './HistoryService.js';

/** Journal bytes plus fold-scratch bytes read through readSync by `action`. */
async function bytesRead(action: () => Promise<void>): Promise<number> {
  const original = fs.readSync;
  let total = 0;
  const spy = spyOn(fs, 'readSync').mockImplementation(((
    ...args: unknown[]
  ): number => {
    const count = (original as (...forward: unknown[]) => number)(...args);
    total += count;
    return count;
  }) as typeof fs.readSync);
  try {
    await action();
  } finally {
    spy.mockRestore();
  }
  return total;
}

async function withSession<T>(
  rows: number,
  action: (history: HistoryService) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'history-summary-reads-'));
  const recording = new SessionRecordingService({
    sessionId: 'summary-reads',
    projectHash: 'summary-reads',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const history = new HistoryService({ recording });
  history.setTokenizerFactory(exactTokenizer());
  try {
    for (let start = 0; start < rows; start += 256) {
      const chunk = [];
      for (let index = start; index < Math.min(rows, start + 256); index++)
        chunk.push(batchRow(index));
      await history.addBatch(chunk);
    }
    await history.waitForCommit();
    return await action(history);
  } finally {
    await history.dispose();
    await recording.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

async function askAll(history: HistoryService): Promise<void> {
  history.getStatistics();
  history.getContextRange();
  await history.getLastUserContent();
  await history.getLastAIContent();
}

/**
 * After one appended row, the three queries read the appended row and a fixed
 * digest of the journal tail, whatever the history length.
 */
async function bytesAfterOneAppend(
  rows: number,
  settle: boolean,
): Promise<number> {
  return withSession(rows, async (history) => {
    await askAll(history);
    history.add(batchRow(rows));
    if (settle) await history.waitForCommit();
    const bytes = await bytesRead(() => askAll(history));
    expect(history.getStatistics().totalMessages).toBe(rows + 1);
    expect(history.getContextRange().totalEntries).toBe(rows + 1);
    return bytes;
  });
}

describe('scalar history queries on an append-only session', () => {
  const SMALL = 128;
  const LARGE = 2048;
  const BOUND = 64 * 1024;

  it('read bytes that do not grow with history after an acknowledged append', async () => {
    const small = await bytesAfterOneAppend(SMALL, true);
    const large = await bytesAfterOneAppend(LARGE, true);
    expect(small).toBeLessThan(BOUND);
    expect(large).toBeLessThan(BOUND);
    expect(large).toBeLessThanOrEqual(small + 4096);
  });

  it('read bytes that do not grow with history while the append is still pending', async () => {
    const small = await bytesAfterOneAppend(SMALL, false);
    const large = await bytesAfterOneAppend(LARGE, false);
    expect(small).toBeLessThan(BOUND);
    expect(large).toBeLessThan(BOUND);
    expect(large).toBeLessThanOrEqual(small + 4096);
  });

  it('read no row bytes when nothing was appended since the last query', async () => {
    await withSession(LARGE, async (history) => {
      await askAll(history);
      const repeated = await bytesRead(() => askAll(history));
      expect(repeated).toBeLessThan(BOUND);
    });
  });

  it('fold the journal again only for the mutation that changed it', async () => {
    await withSession(LARGE, async (history) => {
      await askAll(history);
      await history.pop();
      await history.waitForCommit();
      const afterMutation = await bytesRead(() => askAll(history));
      expect(afterMutation).toBeGreaterThan(LARGE * 1024);
      history.add(batchRow(LARGE + 1));
      await history.waitForCommit();
      const afterAppend = await bytesRead(() => askAll(history));
      expect(afterAppend).toBeLessThan(BOUND);
    });
  });
});
