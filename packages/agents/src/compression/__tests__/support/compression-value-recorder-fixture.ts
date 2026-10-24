/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type { HistoryServiceJournalOptions } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { createRecorderForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import {
  suffixRow,
  suffixSeeder,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  compressionDurableValueDigest,
  compressionValueDigest,
  ValueCompressionHistory,
  valueGate,
} from '../compression-value-fixture.js';
import { nativeFileRows } from './native-file-rows.js';

export interface CompressionValueRecorderFixture {
  readonly root: string;
  readonly history: ValueCompressionHistory;
  readonly recorder: SessionRecordingPort;
  readonly owners: RowOwnership;
  readonly failure: Error;
  readonly ready: ReturnType<typeof valueGate>;
  arm(): void;
  release(): void;
  failAdmissionAfter(successes: number): void;
  durable(): ReturnType<typeof compressionValueDigest>;
}
type CreateHistory = (
  options: HistoryServiceJournalOptions,
) => ValueCompressionHistory;

function valueWriter(): {
  readonly failure: Error;
  readonly ready: ReturnType<typeof valueGate>;
  admit(): void;
  arm(): void;
  release(): void;
  failAfter(successes: number): void;
  wait(): Promise<void>;
} {
  const failure = new Error('injected journal admission failure');
  const ready = valueGate();
  const gate = valueGate();
  let armed = false;
  let remaining: number | undefined;
  return {
    failure,
    ready,
    admit: () => {
      if (remaining === 0) {
        remaining = undefined;
        throw failure;
      }
      if (remaining !== undefined) remaining--;
    },
    arm: () => {
      armed = true;
    },
    release: () => gate.resolve(),
    failAfter: (successes) => {
      remaining = successes;
    },
    wait: async () => {
      if (!armed) return;
      armed = false;
      ready.resolve();
      await gate.promise;
    },
  };
}

async function nativeWriter(
  root: string,
  wait: () => Promise<void>,
): Promise<JournalSession> {
  return JournalSession.create(join(root, 'primary.llxj'), {
    journal: {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          fd: handle.fd,
          read: (...args) => handle.read(...args),
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          write: async (...args) => {
            await wait();
            return handle.write(...args);
          },
          writev: async (buffers, position) => {
            await wait();
            return handle.writev([...buffers], position);
          },
        };
      },
    },
  });
}

function recordedHistory(
  recorder: SessionRecordingPort,
  session: JournalSession,
  owners: RowOwnership,
  create: CreateHistory,
): ValueCompressionHistory {
  const opener = spyOn(JournalSession, 'createUnlinked').mockResolvedValue(
    session,
  );
  try {
    return create({
      recording: recorder,
      mutationOwnership: owners,
      attachmentCounters: {
        ...createRowCounters().counters,
        ownership: owners,
      },
    });
  } finally {
    opener.mockRestore();
  }
}

function failNativeAdmission(
  history: ValueCompressionHistory,
  admit: () => void,
): void {
  const transform = history.detachedValues.transform;
  history.detachedValues.transform = (task, model, options) => {
    history.detachedValues.transform = transform;
    history.setTokenizerFactory(exactTokenizer(admit));
    return transform(task, model, options).finally(() => {
      history.setTokenizerFactory(exactTokenizer());
    });
  };
}

async function durableValue(
  root: string,
  history: ValueCompressionHistory,
  recorder: SessionRecordingPort,
): ReturnType<typeof compressionValueDigest> {
  await history.waitForCommit();
  await recorder.flush();
  const committed = await compressionDurableValueDigest(recorder);
  expect(
    await compressionValueDigest(nativeFileRows(join(root, 'primary.llxj'))),
  ).toStrictEqual(committed);
  return committed;
}

export async function withCompressionValueRecorder<T>(
  size: number,
  action: (fixture: CompressionValueRecorderFixture) => Promise<T>,
  makeRow: (index: number) => IContent = (index) => suffixRow(index, 2048),
  createHistory: CreateHistory = (options) =>
    new ValueCompressionHistory(options),
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'compression-value-recorder-'));
  const owners = new RowOwnership();
  const writer = valueWriter();
  const recorder = createRecorderForTest({
    sessionId: 'compression-value',
    projectHash: 'compression-value',
    chatsDir: root,
  });
  const session = await nativeWriter(root, writer.wait);
  const history = recordedHistory(recorder, session, owners, createHistory);
  try {
    await suffixSeeder(history)(
      (function* () {
        for (let index = 0; index < size; index++) yield makeRow(index);
      })(),
    );
    return await action({
      root,
      history,
      recorder,
      owners,
      failure: writer.failure,
      ready: writer.ready,
      arm: writer.arm,
      release: writer.release,
      failAdmissionAfter: (successes) => {
        writer.failAfter(successes);
        failNativeAdmission(history, writer.admit);
      },
      durable: () => durableValue(root, history, recorder),
    });
  } finally {
    writer.release();
    await history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
