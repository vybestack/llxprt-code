/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJournalReadOnly } from '../../../../journal/journalReader.js';
import { decodeFrameStart } from '../../../../journal/frame.js';
import { decodeTrailerHeader } from '../../../../journal/trailerRecord.js';
import { readStoredRow } from '../../../../journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../../journal/rowTreeReader.js';
import type { RowCounters } from '../../../../recording/journalCounters.js';
import type { SessionRecordingPort } from '../../../../recording/recordingPort.js';
import type { RowOwnership } from '../../../../recording/rowOwnership.js';
import { exactTokenizer } from '../../chronology-rollback-test-helpers.js';
import { detachedDigest } from '../../detached-rollback-test-helpers.js';
import { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';
import { decodeStoredRow } from '../../journalRowCodec.js';
import { JournalSession } from '../../journalSession.js';
import { batchGate, BatchOwnerCensus } from './addbatch-stream-test-helpers.js';
import { createCoreSuffixFixtureGraph } from './core-suffix-fixture-test-helpers.js';
import { DetachedIOFaults } from './detached-io-faults.js';

export interface DetachedContractFixture {
  readonly history: HistoryService;
  readonly owners: RowOwnership;
  durable(): ReturnType<typeof detachedDigest>;
}

export interface NativeDetachedFixture extends DetachedContractFixture {
  readonly recording: SessionRecordingPort;
  readonly reads: RowCounters;
  readonly owners: BatchOwnerCensus;
  readonly writerPaused: Promise<void>;
  readonly io: DetachedIOFaults;
  readonly session: JournalSession;
  primaryRows(): AsyncIterable<IContent>;
  bindOrigin(origin: object): Promise<void>;
  persistedRows(): AsyncIterable<IContent>;
  pauseWriter(rows?: number): void;
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

async function heldSession(
  root: string,
  io: DetachedIOFaults,
): Promise<{
  session: JournalSession;
  paused: Promise<void>;
  arm(rows?: number): void;
  release(): void;
}> {
  const entered = batchGate();
  const gate = batchGate();
  let armed = false;
  let targetRows: number | undefined;
  const wait = async (rows?: number): Promise<void> => {
    if (!armed || (targetRows !== undefined && targetRows !== rows)) return;
    entered.resolve();
    await gate.promise;
  };
  const session = await JournalSession.create(join(root, 'primary.llxj'), {
    journal: {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          fd: handle.fd,
          read: async (...args) => {
            const result = io.read()
              ? { bytesRead: 0 }
              : await handle.read(...args);
            io.recordRead(result.bytesRead);
            return result;
          },
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          write: async (...args) => {
            if (targetRows === undefined) await wait();
            else {
              const [buffer, offset, length, position] = args;
              const trailer = decodeTrailerHeader(
                decodeFrameStart(
                  buffer.subarray(offset, offset + length),
                  position,
                ).kindHeader,
              );
              await wait(trailer.rootAggregate.rows);
            }
            const result = io.write('trailer')
              ? { bytesWritten: 0 }
              : await handle.write(...args);
            io.recordWrite(result.bytesWritten);
            return result;
          },
          writev: async (...args) => {
            await wait();
            const result = io.write('records')
              ? { bytesWritten: 0 }
              : await handle.writev(...args);
            io.recordWrite(result.bytesWritten);
            return result;
          },
        };
      },
    },
  });
  return {
    session,
    paused: entered.promise,
    arm: (rows) => {
      targetRows = rows;
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
    return createCoreSuffixFixtureGraph(root, owners, (options) => {
      if (options.attachmentCounters === undefined)
        throw new Error('Missing native attachment counters');
      return new HistoryService({
        ...options,
        attachmentCounters: {
          ...options.attachmentCounters,
          ownership: owners,
        },
      });
    });
  } finally {
    opener.mockRestore();
  }
}

export async function withNativeDetachedFixture<T>(
  action: (fixture: NativeDetachedFixture) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'native-detached-contract-'));
  const io = new DetachedIOFaults();
  const writer = await heldSession(root, io);
  const owners = new BatchOwnerCensus();
  const {
    service: history,
    recording,
    counters: reads,
  } = nativeGraph(root, owners, writer.session);
  history.setTokenizerFactory(exactTokenizer());
  try {
    await history.waitForCommit();
    return await action({
      history,
      recording,
      reads,
      owners,
      writerPaused: writer.paused,
      io,
      session: writer.session,
      primaryRows: () => fileRows(writer.session.path),
      bindOrigin: async (origin) => {
        await history.detachJournal(recording);
        await history.attachJournal(recording, true, undefined, origin);
      },
      async *persistedRows(): AsyncGenerator<IContent, void, unknown> {
        await history.waitForCommit();
        const path = recording.getFilePath();
        if (path === null) throw new Error('Missing native detached mirror');
        yield* fileRows(path);
      },
      pauseWriter: (rows) => writer.arm(rows),
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
