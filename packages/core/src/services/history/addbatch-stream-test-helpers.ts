import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import {
  AdmissionFailureRecorder,
  exactTokenizer,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';

export class BatchStreamHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'addBatch eager materialization reached',
    );
  }
}

/** Each acquisition remains charged in the aggregate. The second census names
 * values already held by the external input, without excusing an internal pin.
 */
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
    history: BatchStreamHistory;
    recorder: AdmissionFailureRecorder;
    owners: BatchOwnerCensus;
    reads: ReturnType<typeof createRowCounters>;
    pauseWriter(): void;
    waitForPausedWrite: Promise<void>;
    releaseWriter(): void;
  }) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(process.cwd(), 'tmp/addbatch-fixture-'));
  const writer = batchGate();
  const pausedWrite = batchGate();
  let paused = false;
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'addbatch-stream',
    projectHash: 'addbatch-stream',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (path, data, encoding): Promise<void> => {
        if (paused) {
          pausedWrite.resolve();
          await writer.promise;
        }
        await appendFile(path, data, encoding);
      },
    },
  });
  const owners = new BatchOwnerCensus();
  const reads = createRowCounters();
  const history = new BatchStreamHistory({
    recording: recorder,
    mutationOwnership: owners,
    attachmentCounters: { ...reads.counters, ownership: owners },
  });
  history.setTokenizerFactory(exactTokenizer());
  try {
    return await action({
      history,
      recorder,
      owners,
      reads,
      pauseWriter: () => {
        paused = true;
      },
      waitForPausedWrite: pausedWrite.promise,
      releaseWriter: () => writer.resolve(),
    });
  } finally {
    writer.resolve();
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
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
