/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJournalReadOnly } from '../../../../journal/journalReader.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../../journal/rowTreeReader.js';
import { readStoredRow } from '../../../../journal/rowReads.js';
import { decodeStoredRow } from '../../journalRowCodec.js';
import { HistoryService } from '../../HistoryService.js';
import { JournalSession } from '../../journalSession.js';
import type { HistoryBackend } from '../../historyBackendSelect.js';
import {
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
} from '../../detached-rollback-test-helpers.js';
import { exactTokenizer } from '../../chronology-rollback-test-helpers.js';
import { batchGate, BatchOwnerCensus } from './addbatch-stream-test-helpers.js';
import { createCoreSuffixFixtureGraph } from './core-suffix-fixture-test-helpers.js';
import type { RowOwnership } from '../../../../recording/rowOwnership.js';
import type { IContent } from '../../IContent.js';

export interface DetachedContractFixture {
  readonly history: HistoryService;
  readonly owners: RowOwnership;
  durable(): ReturnType<typeof detachedDigest>;
}

export interface NativeDetachedFixture extends DetachedContractFixture {
  readonly owners: BatchOwnerCensus;
  readonly writerPaused: Promise<void>;
  persistedRows(): AsyncIterable<IContent>;
  pauseWriter(): void;
  releaseWriter(): void;
}

async function* fileRows(
  path: string,
): AsyncGenerator<IContent, void, unknown> {
  const reader = await openJournalReadOnly(path);
  try {
    const root = rowTreeRootOf(reader.trailer);
    if (root === undefined) return;
    for await (const entry of iterateRowEntries(reader, root))
      yield decodeStoredRow(await readStoredRow(reader, entry));
  } finally {
    await reader.close();
  }
}

function fileDigest(path: string): ReturnType<typeof detachedDigest> {
  return detachedDigest(fileRows(path));
}

async function heldSession(root: string): Promise<{
  session: JournalSession;
  paused: Promise<void>;
  arm(): void;
  release(): void;
}> {
  const entered = batchGate();
  const gate = batchGate();
  let armed = false;
  const wait = async (): Promise<void> => {
    if (!armed) return;
    entered.resolve();
    await gate.promise;
  };
  const session = await JournalSession.create(join(root, 'primary.llxj'), {
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
          writev: async (...args) => {
            await wait();
            return handle.writev(...args);
          },
        };
      },
    },
  });
  return {
    session,
    paused: entered.promise,
    arm: () => {
      armed = true;
    },
    release: () => gate.resolve(),
  };
}

function nativeGraph(
  root: string,
  owners: BatchOwnerCensus,
  session: JournalSession,
): ReturnType<typeof createCoreSuffixFixtureGraph> {
  const opener = spyOn(JournalSession, 'createUnlinked').mockResolvedValue(
    session,
  );
  try {
    return createCoreSuffixFixtureGraph(
      root,
      owners,
      (options) => {
        if (options.attachmentCounters === undefined)
          throw new Error('Missing native attachment counters');
        return new HistoryService({
          ...options,
          attachmentCounters: {
            ...options.attachmentCounters,
            ownership: owners,
          },
        });
      },
      'journal',
    );
  } finally {
    opener.mockRestore();
  }
}

export async function withNativeDetachedFixture(
  action: (fixture: NativeDetachedFixture) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'native-detached-contract-'));
  const writer = await heldSession(root);
  const owners = new BatchOwnerCensus();
  const { service: history, recording } = nativeGraph(
    root,
    owners,
    writer.session,
  );
  history.setTokenizerFactory(exactTokenizer());
  try {
    await history.waitForCommit();
    await action({
      history,
      owners,
      writerPaused: writer.paused,
      async *persistedRows(): AsyncGenerator<IContent, void, unknown> {
        await history.waitForCommit();
        const path = recording.getFilePath();
        if (path === null) throw new Error('Missing native detached mirror');
        yield* fileRows(path);
      },
      pauseWriter: () => writer.arm(),
      releaseWriter: () => writer.release(),
      durable: async () => {
        await history.waitForCommit();
        await recording.flush();
        const path = recording.getFilePath();
        if (path === null) throw new Error('Missing native detached mirror');
        const primary = await fileDigest(writer.session.path);
        const mirror = await fileDigest(path);
        if (JSON.stringify(primary) !== JSON.stringify(mirror))
          throw new Error('Native detached primary and mirror differ');
        return mirror;
      },
    });
  } finally {
    writer.release();
    await history.dispose();
    await recording.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

export async function withDetachedContractFixture(
  backend: HistoryBackend,
  action: (fixture: DetachedContractFixture) => Promise<void>,
): Promise<void> {
  if (backend === 'journal') {
    await withNativeDetachedFixture(action);
    return;
  }
  await withDetachedFixture(async ({ history, recorder, owners }) => {
    await action({
      history,
      owners,
      durable: () => detachedDurableDigest(recorder),
    });
  });
}
