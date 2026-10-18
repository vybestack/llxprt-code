/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import { compactionCandidatePath, requireSameHistory } from './compaction.js';
import {
  readCommittedFile,
  type CommittedFile,
  type FileOperations,
  type UnlinkedCandidate,
  type VerifiedCandidate,
} from './compactionSwap.js';
import { JournalFormatError } from './errors.js';
import type { IdKeyHasher } from './idKeys.js';
import type { JournalOpenDependencies } from './journalWriterOpen.js';
import type { JournalFileHandle } from './positionalFile.js';
import type { RecordAccess } from './recordAccess.js';
import { versionOf, type Version } from './version.js';
import {
  compactionCopy,
  compactionCopyUnlinked,
  type CopyResult,
} from './versionCopy.js';

/**
 * Step 6 of design 4.11: the copy is flushed, read back through `handle` and
 * compared with the published version. Its data is on disk before anything
 * is swapped in.
 */
async function verifyCopy(
  handle: JournalFileHandle,
  label: string,
  copy: CopyResult,
  published: Version,
  journal: JournalOpenDependencies,
): Promise<
  CommittedFile & { readonly trailer: NonNullable<CommittedFile['trailer']> }
> {
  journal.flush(handle.fd);
  const found = await readCommittedFile(handle, label);
  const written = copy.versions[copy.versions.length - 1];
  if (
    found.trailer === undefined ||
    found.trailer.selfOffset !== written.offset
  ) {
    throw new JournalFormatError(
      `The compacted copy ${label} does not end in the trailer that was written last`,
    );
  }
  requireSameHistory(published, versionOf(found.trailer));
  return { ...found, trailer: found.trailer };
}

/**
 * Steps 1 to 6 of design 4.11: the copy of every live version in
 * `<file>.compact`, flushed, read back and compared with the published
 * version. The old file is not touched. A failure removes the candidate and
 * throws.
 */
export async function writeCompactionCandidate(
  file: string,
  access: RecordAccess,
  published: Version,
  journal: JournalOpenDependencies,
  hasher: IdKeyHasher,
  ops: FileOperations,
): Promise<VerifiedCandidate> {
  const candidate = compactionCandidatePath(file);
  // A leftover of a refused swap whose unlink failed; the copy creates its file exclusively.
  await fsp.rm(candidate, { force: true });
  try {
    const copy = await compactionCopy(access, published, candidate, {
      journal,
      hasher,
    });
    const handle = await ops.open(candidate, 'r+');
    try {
      // Step 5: the rename publishes the whole file at once, so its data is on disk first.
      const found = await verifyCopy(
        handle,
        candidate,
        copy,
        published,
        journal,
      );
      return { fileId: found.header.fileId, trailer: found.trailer };
    } finally {
      await handle.close();
    }
  } catch (error) {
    await fsp.rm(candidate, { force: true });
    throw error;
  }
}

/**
 * The same copy for a file with no name (design 4.12): a second nameless file
 * made by `journal.open`, verified through the descriptor the copy ends with.
 * Nothing is renamed, so the swap hands this descriptor to the writer. A
 * failure closes the descriptor, which deletes the candidate, and throws.
 */
export async function writeUnlinkedCompactionCandidate(
  label: string,
  access: RecordAccess,
  published: Version,
  journal: JournalOpenDependencies,
  hasher: IdKeyHasher,
): Promise<UnlinkedCandidate> {
  const { result, handle } = await compactionCopyUnlinked(
    access,
    published,
    label,
    { journal, hasher },
  );
  try {
    const found = await verifyCopy(handle, label, result, published, journal);
    return {
      handle,
      syncMarker: found.header.syncMarker,
      size: found.size,
      trailer: found.trailer,
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
