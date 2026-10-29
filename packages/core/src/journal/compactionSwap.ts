/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { DebugLogger } from '../debug/index.js';
import { compactionCandidatePath } from './compaction.js';
import type { JournalHeader } from './fileHeader.js';
import type { GroupWriterStart, JournalGroupWriter } from './groupWriter.js';
import type { JournalOpenFlags } from './journalWriterOpen.js';
import {
  createFileHandleReader,
  type JournalFileHandle,
} from './positionalFile.js';
import { locateCommittedState } from './trailerSearch.js';
import type { TrailerHeader } from './trailerRecord.js';

const logger = new DebugLogger('llxprt:journal:compaction');

/**
 * The file operations of the swap (design 4.11): a test refuses the rename
 * after the descriptors are closed, and runs the Windows branch on POSIX.
 */
export interface FileOperations {
  readonly platform: NodeJS.Platform;
  close(handle: JournalFileHandle): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  open(path: string, flags: JournalOpenFlags): Promise<JournalFileHandle>;
  /** Orders a name change on POSIX (step C); a no-op where a directory cannot be synced. */
  syncDirectory(directory: string): Promise<void>;
}

export function realFileOperations(
  open: FileOperations['open'],
): FileOperations {
  return {
    platform: process.platform,
    close: (handle) => handle.close(),
    rename: (from, to) => fsp.rename(from, to),
    open,
    syncDirectory: async (directory) => {
      if (process.platform === 'win32') return;
      const handle = await fsp.open(directory, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
  };
}

/** The file a candidate must become: what step 6 verified. */
export interface VerifiedCandidate {
  readonly fileId: Uint8Array;
  readonly trailer: TrailerHeader;
}

/** The candidate of a file with no name: the open descriptor is the only way to reach it. */
export interface UnlinkedCandidate {
  readonly handle: JournalFileHandle;
  readonly syncMarker: Uint8Array;
  readonly size: number;
  readonly trailer: TrailerHeader;
}

export type SwapOutcome = 'swapped' | 'refused';

/**
 * The swap for a file with no name (design 4.12): nothing is renamed, so the
 * writer gives up its descriptor for the candidate's and the old descriptor is
 * closed, which deletes the old file. The caller holds the commit queue and
 * no read is in flight, as for `CompactionSwap`.
 */
export async function swapInUnlinkedCandidate(
  writer: JournalGroupWriter,
  ops: FileOperations,
  candidate: UnlinkedCandidate,
): Promise<'swapped'> {
  const old = writer.detach();
  writer.attach({
    handle: candidate.handle,
    syncMarker: candidate.syncMarker,
    writeOffset: candidate.size,
    published: candidate.trailer,
  });
  await ops.close(old);
  return 'swapped';
}

export interface CommittedFile {
  readonly header: JournalHeader;
  readonly trailer: TrailerHeader | undefined;
  readonly size: number;
}

export async function readCommittedFile(
  handle: JournalFileHandle,
  file: string,
): Promise<CommittedFile> {
  const { size } = await handle.stat();
  const state = await locateCommittedState(
    file,
    createFileHandleReader(handle),
    size,
  );
  return { ...state, size };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((b, at) => b === right[at]);
}

function sameTrailer(
  left: TrailerHeader | undefined,
  right: TrailerHeader | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  return (
    left.commitSeq === right.commitSeq &&
    left.groupTag === right.groupTag &&
    left.selfOffset === right.selfOffset
  );
}

/** A refusal Windows gives a rename over a file another handle holds open (design 4.11). */
function isRecognizedRefusal(
  platform: NodeJS.Platform,
  error: unknown,
): boolean {
  if (platform !== 'win32') return false;
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

/**
 * The swap of design 4.11 step 7, as the state machine in its table. The
 * caller holds the commit queue and no read is in flight. A and B give up the
 * descriptor and rename; C opens the new file and requires it to be the
 * candidate that was verified; R puts the old file back. No exit from A
 * leaves the writer without a file, and a writer that cannot be given one is
 * poisoned with the cause.
 */
export class CompactionSwap {
  constructor(
    private readonly writer: JournalGroupWriter,
    private readonly file: string,
    private readonly ops: FileOperations,
  ) {}

  async run(candidate: VerifiedCandidate): Promise<SwapOutcome> {
    const snapshot = this.writer.currentFile();
    const oldId = await this.oldFileId(snapshot.handle);
    const candidatePath = compactionCandidatePath(this.file);
    await this.detach(snapshot, oldId);
    try {
      await this.ops.rename(candidatePath, this.file);
    } catch (error) {
      await this.restore(snapshot, oldId, error);
      if (isRecognizedRefusal(this.ops.platform, error)) {
        logger.debug(
          () =>
            `compaction rename refused (${String(error)}); keeping the old file`,
        );
        return 'refused';
      }
      throw error;
    }
    await this.attach(candidate);
    return 'swapped';
  }

  private async oldFileId(handle: JournalFileHandle): Promise<Uint8Array> {
    return (await readCommittedFile(handle, this.file)).header.fileId;
  }

  /** Step A. */
  private async detach(
    snapshot: GroupWriterStart,
    oldId: Uint8Array,
  ): Promise<void> {
    this.writer.detach();
    try {
      await this.ops.close(snapshot.handle);
    } catch (error) {
      await this.restore(snapshot, oldId, error);
      throw error;
    }
  }

  /** Step C. */
  private async attach(candidate: VerifiedCandidate): Promise<void> {
    try {
      const handle = await this.ops.open(this.file, 'r+');
      try {
        const found = await readCommittedFile(handle, this.file);
        if (
          !sameBytes(found.header.fileId, candidate.fileId) ||
          !sameTrailer(found.trailer, candidate.trailer)
        ) {
          throw new Error(
            `${this.file} is not the compacted copy that was verified`,
          );
        }
        await this.ops.syncDirectory(path.dirname(this.file));
        this.writer.attach({
          handle,
          syncMarker: found.header.syncMarker,
          writeOffset: found.size,
          published: found.trailer,
        });
      } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      this.writer.poison(error);
      throw error;
    }
  }

  /** Step R: serves the old file again, or poisons the writer with both errors. */
  private async restore(
    snapshot: GroupWriterStart,
    oldId: Uint8Array,
    cause: unknown,
  ): Promise<void> {
    try {
      const handle = await this.ops.open(this.file, 'r+');
      const found = await readCommittedFile(handle, this.file);
      if (
        !sameBytes(found.header.fileId, oldId) ||
        !sameTrailer(found.trailer, snapshot.published)
      ) {
        await handle.close().catch(() => undefined);
        throw new Error(`${this.file} is not the file that was swapped out`);
      }
      this.writer.attach({
        ...snapshot,
        handle,
        writeOffset: Math.max(found.size, snapshot.writeOffset),
      });
      // A candidate that cannot be unlinked now is removed by the next owner open.
      await fsp
        .rm(compactionCandidatePath(this.file), { force: true })
        .catch(() => undefined);
    } catch (restoreError) {
      const both = new AggregateError(
        [cause, restoreError],
        'A compaction failed and the journal file could not be reopened',
      );
      this.writer.poison(both);
      throw both;
    }
  }
}
