/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { appendFileSync } from 'node:fs';
import type { RowCounters } from '../../../../recording/journalCounters.js';
import type { SessionRecordingPort } from '../../../../recording/recordingPort.js';
import { RowOwnership } from '../../../../recording/rowOwnership.js';
import { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';
import { rollbackRow } from '../../chronology-rollback-test-helpers.js';
import type { JournalSession } from '../../journalSession.js';
import { withNativeDetachedFixture } from './detached-contract-fixture.js';
import type { DetachedIOFaults } from './detached-io-faults.js';

export class BatchStreamHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'addBatch eager materialization reached',
    );
  }
}

export class BatchOwnerCensus extends RowOwnership {
  readonly external = new RowOwnership();
  readonly internal = new RowOwnership();
  private readonly inputs = new WeakSet<object>();

  registerInput(rows: readonly IContent[]): void {
    for (const row of rows) {
      this.inputs.add(row);
      if (row.metadata?.chronology !== undefined)
        this.inputs.add(row.metadata.chronology);
    }
  }

  override retain(row: object): void {
    super.retain(row);
    (this.inputs.has(row) ? this.external : this.internal).retain(row);
  }

  override release(row: object): void {
    (this.inputs.has(row) ? this.external : this.internal).release(row);
    super.release(row);
  }
}

export function batchRow(index: number, bytes = 2048): IContent {
  return {
    ...rollbackRow(index, bytes),
    metadata: {
      timestamp: 1700000000000 + index,
      model: 'batch-test',
      chronology: {
        seq: index + 1,
        userTurn: Math.floor(index / 3) + 1,
        step: index % 3,
        recordedAt: 1700000000000 + index,
      },
    },
  };
}

export function batchGate(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
}

export async function withBatchFixture<T>(
  action: (fixture: {
    history: HistoryService;
    recorder: SessionRecordingPort;
    owners: BatchOwnerCensus;
    reads: RowCounters;
    io: DetachedIOFaults;
    session: JournalSession;
    pauseWriter(rows?: number): void;
    waitForPausedWrite: Promise<void>;
    releaseWriter(): void;
  }) => Promise<T>,
): Promise<T> {
  return withNativeDetachedFixture(async (fixture) => {
    forbidHistoryMaterializationForTest(
      fixture.history,
      'addBatch eager materialization reached',
    );
    return action({
      history: fixture.history,
      recorder: fixture.recording,
      owners: fixture.owners,
      reads: fixture.reads,
      io: fixture.io,
      session: fixture.session,
      pauseWriter: fixture.pauseWriter,
      waitForPausedWrite: fixture.writerPaused,
      releaseWriter: fixture.releaseWriter,
    });
  });
}

export function recordBatchOwners(
  phase: string,
  size: number,
  owners: BatchOwnerCensus,
): void {
  const output = process.env.ADDBATCH_OWNER_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      `${JSON.stringify({ phase, size, aggregate: owners.snapshot(), external: owners.external.snapshot(), internal: owners.internal.snapshot() })}\n`,
    );
}
