import { forbidHistoryMaterializationForTest } from '../../../../core/src/test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AdmissionFailureRecorder } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { middleoutSetup, middleoutRow } from './middleout-disk-helpers.js';

export function pendingGate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve: () => resolve() };
}
export class PendingDiskHistory extends HistoryService {
  private eagerReached = false;
  getCurated(): IContent[] {
    this.eagerReached = true;
    throw new Error('eager pending-window preparation reached');
  }
  override getTotalTokens(): number {
    if (this.eagerReached)
      throw new Error('eager pending-window preparation reached');
    return super.getTotalTokens();
  }
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'eager pending-window raw preparation reached',
    );
  }
  override replaceAll(): Promise<void> {
    throw new Error('eager pending-window publication reached');
  }
  override async *streamCuratedHistory(): AsyncGenerator<
    IContent,
    void,
    unknown
  > {
    yield await Promise.reject<IContent>(
      new Error('primary source read failed'),
    );
  }
}
export type PendingFixture = {
  history: PendingDiskHistory;
  recorder: AdmissionFailureRecorder;
  owners: RowOwnership;
  reads: ReturnType<typeof createRowCounters>;
  setup: ReturnType<typeof middleoutSetup>;
  pauseWriter: () => void;
  releaseWriter: () => void;
};
export async function withPendingFixture<T>(
  size: number,
  action: (fixture: PendingFixture) => Promise<T>,
  bytes = 2048,
  contextLimit = 30000,
): Promise<T> {
  const root = mkdtempSync(join(process.cwd(), 'tmp/pending-window-fixture-'));
  const writer = pendingGate();
  let paused = false;
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'pending-window',
    projectHash: 'pending-window',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (file, data, encoding): Promise<void> => {
        if (paused) await writer.promise;
        await appendFile(file, data, encoding);
      },
    },
  });
  const owners = new RowOwnership();
  const reads = createRowCounters();
  const history = new PendingDiskHistory({
    recording: recorder,
    mutationOwnership: owners,
    attachmentCounters: { ...reads.counters, ownership: owners },
  });
  const setup = middleoutSetup(history, undefined, undefined, {
    contextLimit,
    'compression.density.readWritePruning': false,
    'compression.density.fileDedupe': false,
    'compression.density.recencyPruning': false,
  });
  try {
    for (let index = 0; index < size; index++) {
      await recorder.commit('content', { content: middleoutRow(index, bytes) });
    }
    await recorder.flush();
    await history.transformRows(async (source, sink) => {
      for await (const { row } of source.streamRows()) {
        if (row.blocks.length > 0) sink.appendDetached(row);
      }
    });
    await recorder.flush();
    history.setCacheAnchorSeq(1);
    history.setBaseTokenOffset(37);
    setup.handler.setLastPromptTokenCount(history.getTotalTokens() + 200000);
    return await action({
      history,
      recorder,
      owners,
      reads,
      setup,
      pauseWriter: () => {
        paused = true;
      },
      releaseWriter: () => writer.resolve(),
    });
  } finally {
    writer.resolve();
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
export function pendingCaller(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `pending caller ${index}` }],
  };
}
