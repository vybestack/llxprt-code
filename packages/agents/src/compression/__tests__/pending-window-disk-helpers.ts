/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, spyOn } from 'bun:test';
import { tmpdir } from 'node:os';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import { createRecorderForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { selectBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { middleoutSetup, middleoutRow } from './middleout-disk-helpers.js';
import { pausedWriter } from './support/native-fallback-fixture.js';
import { nativeFileRows } from './support/native-file-rows.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { PendingPublicationOwner } from './support/pending-publication-owner.js';

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
  recorder: SessionRecordingPort;
  owners: RowOwnership;
  reads: ReturnType<typeof createRowCounters>;
  setup: ReturnType<typeof middleoutSetup>;
  pauseWriter: () => void;
  releaseWriter: () => void;
  failAdmissionAfter: (rows: number) => void;
  publishedRows: () => AsyncIterable<IContent>;
  assertCommitted: () => Promise<void>;
  pausePublication: (
    ready: ReturnType<typeof pendingGate>,
    release: ReturnType<typeof pendingGate>,
  ) => Promise<void>;
};
type NativeWriter = Awaited<ReturnType<typeof pausedWriter>> | undefined;

function pendingRecording(
  root: string,
  native: NativeWriter,
): {
  recorder: SessionRecordingPort;
  pause(): void;
  release(): void;
  fail(history: HistoryService, rows: number): void;
  restore(): void;
} {
  const writer = pendingGate();
  let paused = false;
  let remaining: number | undefined;
  const failure = new Error('injected journal admission failure');
  const recorder = createRecorderForTest({
    sessionId: 'pending-window',
    projectHash: 'pending-window',
    chatsDir: root,
    io: {
      appendFile: async (file, data, encoding): Promise<void> => {
        if (paused) await writer.promise;
        await appendFile(file, data, encoding);
      },
    },
  });
  const admit = (): void => {
    if (remaining === 0) {
      remaining = undefined;
      throw failure;
    }
    if (remaining !== undefined) remaining--;
  };
  const enqueue =
    recorder instanceof SessionRecordingService
      ? recorder.enqueue.bind(recorder)
      : undefined;
  const admission =
    recorder instanceof SessionRecordingService && enqueue !== undefined
      ? spyOn(recorder, 'enqueue').mockImplementation((type, payload) => {
          admit();
          return enqueue(type, payload);
        })
      : undefined;
  recorder.recordSessionMetadata('pending-window fixture');
  return {
    recorder,
    pause: () => {
      paused = true;
      native?.arm();
    },
    release: () => {
      writer.resolve();
      native?.release();
    },
    fail: (history, rows) => {
      remaining = rows;
      if (native !== undefined)
        history.setTokenizerFactory(exactTokenizer(admit));
    },
    restore: () => admission?.mockRestore(),
  };
}

function pendingHistory(
  recorder: SessionRecordingPort,
  native: NativeWriter,
  owners: RowOwnership,
  reads: PendingFixture['reads'],
): PendingDiskHistory {
  const opener =
    native === undefined
      ? undefined
      : spyOn(JournalSession, 'createUnlinked').mockResolvedValue(
          native.session,
        );
  try {
    return new PendingDiskHistory({
      recording: recorder,
      mutationOwnership: owners,
      attachmentCounters: { ...reads.counters, ownership: owners },
    });
  } finally {
    opener?.mockRestore();
  }
}

function* pendingSeed(size: number, bytes: number): Generator<IContent> {
  for (let index = 0; index < size; index++) {
    const row = middleoutRow(index, bytes);
    if (row.blocks.length > 0) yield row;
  }
}
async function seedPendingHistory(
  history: PendingDiskHistory,
  recorder: SessionRecordingPort,
  size: number,
  bytes: number,
): Promise<void> {
  if (recorder instanceof SessionRecordingService) {
    for (let index = 0; index < size; index++)
      await recorder.commit('content', { content: middleoutRow(index, bytes) });
    await recorder.flush();
    await history.detachedValues.transform(
      async (source, sink) => {
        for await (const row of source.streamRows())
          if (row.blocks.length > 0) await sink.appendValue(row);
      },
      undefined,
      { publishTokens: true },
    );
  } else {
    await history.detachedValues.replace(pendingSeed(size, bytes), undefined, {
      publishTokens: true,
    });
  }
}

async function assertPendingCommitted(
  history: PendingDiskHistory,
  recorder: SessionRecordingPort,
  native: NativeWriter,
): Promise<void> {
  await history.waitForCommit();
  await recorder.flush();
  if (native === undefined) return;
  const path = recorder.getFilePath();
  if (path === null) throw new Error('Missing pending-window mirror');
  const published = await compressionValueDigest(
    nativeFileRows(native.session.path),
  );
  expect(published.count).toBe(history.length());
  expect(await compressionValueDigest(nativeFileRows(path))).toStrictEqual(
    published,
  );
  expect(
    await compressionValueDigest(history.streamRawHistory()),
  ).toStrictEqual(published);
}

export async function pendingPublishedRows(
  fixture: Pick<PendingFixture, 'publishedRows'>,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of fixture.publishedRows()) rows.push(row);
  return rows;
}

export async function withPendingFixture<T>(
  size: number,
  action: (fixture: PendingFixture) => Promise<T>,
  bytes = 2048,
  contextLimit = 30000,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'pending-window-fixture-'));
  const native =
    selectBackend() === 'journal' ? await pausedWriter(root) : undefined;
  const control = pendingRecording(root, native);
  const { recorder } = control;
  const media = new LocalMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024,
  });
  const owners = new RowOwnership();
  const reads = createRowCounters();
  const history = pendingHistory(recorder, native, owners, reads);
  const setup = middleoutSetup(history, undefined, undefined, {
    contextLimit,
    'compression.density.readWritePruning': false,
    'compression.density.fileDedupe': false,
    'compression.density.recencyPruning': false,
  });
  const assertCommitted = (): Promise<void> =>
    assertPendingCommitted(history, recorder, native);
  try {
    await seedPendingHistory(history, recorder, size, bytes);
    await assertCommitted();
    history.setCacheAnchorSeq(1);
    history.setBaseTokenOffset(37);
    setup.handler.setLastPromptTokenCount(history.getTotalTokens() + 200000);
    return await action({
      history,
      recorder,
      owners,
      reads,
      setup,
      assertCommitted,
      publishedRows: () =>
        native === undefined
          ? history.streamRawHistory()
          : nativeFileRows(native.session.path),
      pausePublication: async (ready, release) => {
        const owner = new PendingPublicationOwner(
          media,
          ready.resolve,
          release.promise,
        );
        await history.registerMediaOwner(owner);
        await history.settleMediaOwnership();
        owner.arm(await history.openDumpSnapshot());
      },
      failAdmissionAfter: (rows) => control.fail(history, rows),
      pauseWriter: () => control.pause(),
      releaseWriter: () => control.release(),
    });
  } finally {
    control.release();
    control.restore();
    await history.dispose();
    await recorder.dispose();
    await media.close();
    rmSync(root, { recursive: true, force: true });
  }
}
export function pendingCaller(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `pending caller ${index}` }],
  };
}
