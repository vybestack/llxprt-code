/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { HistoryService } from './HistoryService.js';
import { BatchOwnerCensus, batchGate } from './addbatch-stream-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

export async function withSynchronousFixture<T>(
  execute: (fixture: {
    history: HistoryService;
    recorder: SessionRecordingService;
    owners: BatchOwnerCensus;
    pauseWriter(): void;
    waitForPausedWrite: Promise<void>;
    releaseWriter(): void;
    writerPeakBytes(): number;
  }) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'sync-ticket-fixture-'));
  const gate = batchGate();
  const paused = batchGate();
  let pause = false;
  let peakBytes = 0;
  const recorder = new SessionRecordingService({
    sessionId: 'sync-ticket',
    projectHash: 'sync-ticket',
    workspaceDirs: [root],
    chatsDir: root,
    provider: 'test',
    model: 'test',
    observeWriter: (state) => {
      const queuedBytes = [
        ...state.preContent,
        ...state.queue,
        ...state.batch,
      ].reduce(
        (sum, record) => sum + Buffer.byteLength(record.json, 'utf8'),
        0,
      );
      peakBytes = Math.max(
        peakBytes,
        queuedBytes + Buffer.byteLength(state.lines ?? '', 'utf8'),
      );
    },
    io: {
      appendFile: async (path, data, encoding): Promise<void> => {
        if (pause) {
          paused.resolve();
          await gate.promise;
        }
        await appendFile(path, data, encoding);
      },
    },
  });
  const owners = new BatchOwnerCensus();
  const reads = createRowCounters();
  const history = new HistoryService({
    recording: recorder,
    mutationOwnership: owners,
    attachmentCounters: { ...reads.counters, ownership: owners },
  });
  history.setTokenizerFactory(exactTokenizer());
  try {
    return await execute({
      history,
      recorder,
      owners,
      pauseWriter: () => {
        pause = true;
      },
      waitForPausedWrite: paused.promise,
      releaseWriter: () => gate.resolve(),
      writerPeakBytes: () => peakBytes,
    });
  } finally {
    gate.resolve();
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
