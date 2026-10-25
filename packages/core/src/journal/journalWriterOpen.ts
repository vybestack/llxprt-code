/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { writeSync, closeSync } from 'node:fs';
import { createJournalHeader, encodeJournalHeader } from './fileHeader.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { loadFlushRecords, type FlushRecords } from './flushRecords.js';
import { JournalGroupWriter } from './groupWriter.js';
import {
  createFileHandleReader,
  createFileHandleSink,
  type JournalFileHandle,
} from './positionalFile.js';
import { locateCommittedState } from './trailerSearch.js';

/** `wx+` creates the file exclusively; `r+` opens an existing one. Neither is append mode (design 4.12). */
export type JournalOpenFlags = 'wx+' | 'r+' | 'r';

export interface JournalOpenDependencies {
  readonly open: (
    path: string,
    flags: JournalOpenFlags,
  ) => Promise<JournalFileHandle>;
  readonly flush: FlushRecords;
  readonly nowMs: () => number;
  readonly random: (length: number) => Uint8Array;
}

/** The dependencies of this process: real files, the platform flush, the clock and secure randomness. */
export async function resolveJournalDependencies(
  overrides: Partial<JournalOpenDependencies> = {},
): Promise<JournalOpenDependencies> {
  return {
    open: overrides.open ?? ((path, flags) => fsp.open(path, flags)),
    flush: overrides.flush ?? (await loadFlushRecords()),
    nowMs: overrides.nowMs ?? Date.now,
    random: overrides.random ?? ((length) => randomBytes(length)),
  };
}

/** Creates a new journal file holding only its header and returns its writer. */
export async function createJournal(
  path: string,
  dependencies: JournalOpenDependencies,
): Promise<JournalGroupWriter> {
  const header = createJournalHeader(dependencies.nowMs, dependencies.random);
  const handle = await dependencies.open(path, 'wx+');
  try {
    await createFileHandleSink(handle, 0)(encodeJournalHeader(header));
  } catch (error) {
    await handle.close();
    throw error;
  }
  return new JournalGroupWriter(
    {
      handle,
      syncMarker: header.syncMarker,
      writeOffset: JOURNAL_HEADER_BYTES,
      published: undefined,
    },
    dependencies,
  );
}

export function createSynchronousJournal(
  handle: JournalFileHandle,
  dependencies: JournalOpenDependencies,
): JournalGroupWriter {
  const header = createJournalHeader(dependencies.nowMs, dependencies.random);
  const bytes = encodeJournalHeader(header);
  try {
    for (let offset = 0; offset < bytes.length; ) {
      const count = writeSync(
        handle.fd,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (count === 0) throw new Error('Journal header write made no progress');
      offset += count;
    }
  } catch (error) {
    closeSync(handle.fd);
    throw error;
  }
  return new JournalGroupWriter(
    {
      handle,
      syncMarker: header.syncMarker,
      writeOffset: JOURNAL_HEADER_BYTES,
      published: undefined,
    },
    dependencies,
  );
}

/** What owner open did about bytes behind the last trailer. */
export interface TailRecovery {
  readonly uncommittedBytes: number;
  readonly truncated: boolean;
  /** Why the best-effort truncation did not happen; the writer then starts after the tail. */
  readonly truncationError?: unknown;
}

export interface OwnerOpen {
  readonly writer: JournalGroupWriter;
  readonly recovery: TailRecovery;
}

/**
 * Opens an existing journal for its single writer (design 4.1 and 4.12). The
 * last trailer is found first, so a damaged root throws before anything is
 * changed. Bytes behind the trailer are removed on a best-effort basis: no
 * reader can reach them, so a refused truncation only means the writer starts
 * at the end of the file instead of at the last durable end.
 */
export async function openJournalForOwner(
  path: string,
  dependencies: JournalOpenDependencies,
): Promise<OwnerOpen> {
  const handle = await dependencies.open(path, 'r+');
  try {
    const { size } = await handle.stat();
    const { header, trailer } = await locateCommittedState(
      path,
      createFileHandleReader(handle),
      size,
    );
    const durableEnd = trailer?.durableEnd ?? JOURNAL_HEADER_BYTES;
    const recovery = await truncateTail(handle, size, durableEnd);
    const writer = new JournalGroupWriter(
      {
        handle,
        syncMarker: header.syncMarker,
        writeOffset: recovery.truncated ? durableEnd : size,
        published: trailer,
      },
      dependencies,
    );
    return { writer, recovery };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function truncateTail(
  handle: JournalFileHandle,
  size: number,
  durableEnd: number,
): Promise<TailRecovery> {
  const uncommittedBytes = size - durableEnd;
  if (uncommittedBytes === 0) return { uncommittedBytes, truncated: false };
  try {
    await handle.truncate(durableEnd);
    return { uncommittedBytes, truncated: true };
  } catch (truncationError) {
    return { uncommittedBytes, truncated: false, truncationError };
  }
}
