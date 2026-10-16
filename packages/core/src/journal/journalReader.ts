/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import type { JournalHeader } from './fileHeader.js';
import type { FrameHead } from './frame.js';
import {
  createFileHandleReader,
  type JournalFileHandle,
} from './positionalFile.js';
import { createRecordAccess, type RecordAccess } from './recordAccess.js';
import type { TrailerHeader } from './trailerRecord.js';
import { locateCommittedState } from './trailerSearch.js';

export interface JournalReaderDependencies {
  readonly open: (path: string, flags: 'r') => Promise<JournalFileHandle>;
}

const defaultDependencies: JournalReaderDependencies = {
  open: (path, flags) => fsp.open(path, flags),
};

/**
 * A read-only view of one committed version of a journal: the last trailer
 * that was durable when the file was opened. Bytes behind that trailer are an
 * uncommitted tail and are ignored, never removed.
 */
export interface JournalReader extends RecordAccess {
  readonly path: string;
  readonly header: JournalHeader;
  /** Undefined when the journal holds no committed group. */
  readonly trailer: TrailerHeader | undefined;
  readonly fileSize: number;
  close(): Promise<void>;
}

function noCommittedState(): never {
  throw new Error('The journal has no committed group, so it has no records');
}

export async function openJournalReadOnly(
  path: string,
  dependencies: JournalReaderDependencies = defaultDependencies,
): Promise<JournalReader> {
  const handle = await dependencies.open(path, 'r');
  try {
    const { size } = await handle.stat();
    const reader = createFileHandleReader(handle);
    const { header, trailer } = await locateCommittedState(path, reader, size);
    const access: RecordAccess =
      trailer === undefined
        ? {
            readRecordHead: (): Promise<FrameHead> => noCommittedState(),
            readRecordBody: (): AsyncGenerator<Uint8Array> =>
              noCommittedState(),
          }
        : createRecordAccess(path, reader, trailer);
    return {
      path,
      header,
      trailer,
      fileSize: size,
      readRecordHead: access.readRecordHead,
      readRecordBody: access.readRecordBody,
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
