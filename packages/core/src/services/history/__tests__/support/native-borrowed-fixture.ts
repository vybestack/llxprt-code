/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalRecordingService } from '../../../../recording/journalRecordingService.js';
import { journalSeams } from '../../../../recording/__tests__/support/recordedJournals.js';
import { expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRowCounters } from '../../../../recording/journalCounters.js';
import { RowOwnership } from '../../../../recording/rowOwnership.js';
import { borrowedRow } from '../../borrowed-snapshot-test-helpers.js';
import { exactTokenizer } from '../../chronology-rollback-test-helpers.js';
import type { HistoryRowView } from '../../historyRowView.js';
import { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';

export class NativeBorrowedHistory extends HistoryService {
  readRows<T>(
    execute: (view: HistoryRowView) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.journal.readRows(execute, signal);
  }
}

class BorrowedCensus extends RowOwnership {
  failure: Error | undefined;
  releaseFailure: Error | undefined;
  releases = 0;

  override retain(row: object): void {
    if (this.failure !== undefined) {
      const failure = this.failure;
      this.failure = undefined;
      throw failure;
    }
    super.retain(row);
  }

  override release(row: object): void {
    super.release(row);
    this.releases++;
    if (this.releaseFailure !== undefined) {
      const failure = this.releaseFailure;
      this.releaseFailure = undefined;
      throw failure;
    }
  }
}

export async function* nativeBorrowedRows(
  size: number,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield borrowedRow(index, bytes);
}

export async function withNativeBorrowedFixture(
  size: number,
  bytes: number,
  action: (
    history: NativeBorrowedHistory,
    owners: BorrowedCensus,
  ) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'native-borrowed-'));
  const recording = JournalRecordingService.create({
    sessionId: 'borrowed',
    projectHash: 'borrowed',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    journal: journalSeams(),
  });
  const owners = new BorrowedCensus();
  const counters = createRowCounters();
  let released = 0;
  const history = new NativeBorrowedHistory({
    recording,
    attachmentCounters: {
      ...counters.counters,
      ownership: owners,
      rowReleased: () => {
        released++;
        counters.counters.rowReleased();
      },
    },
  });
  history.setTokenizerFactory(exactTokenizer());
  try {
    await history.detachedValues.replace(nativeBorrowedRows(size, bytes));
    await history.waitForCommit();
    await action(history, owners);
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.snapshot().liveSerializedBytes).toBe(0);
    expect(owners.snapshot().acquisitions).toBe(owners.releases);
    expect(counters.snapshot().rowsDecoded).toBe(released);
    expect(counters.snapshot().peakDecodedRows).toBeLessThanOrEqual(2);
    if (size > 1 && owners.snapshot().acquisitions > 0)
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
  } finally {
    await history.dispose();
    await recording.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
