/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import { compactionCandidatePath, requireSameHistory } from './compaction.js';
import {
  readCommittedFile,
  type FileOperations,
  type VerifiedCandidate,
} from './compactionSwap.js';
import { JournalFormatError } from './errors.js';
import type { IdKeyHasher } from './idKeys.js';
import type { JournalOpenDependencies } from './journalWriterOpen.js';
import type { RecordAccess } from './recordAccess.js';
import { versionOf, type Version } from './version.js';
import { compactionCopy } from './versionCopy.js';

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
      journal.flush(handle.fd);
      const found = await readCommittedFile(handle, candidate);
      const written = copy.versions[copy.versions.length - 1];
      if (
        found.trailer === undefined ||
        found.trailer.selfOffset !== written.offset
      ) {
        throw new JournalFormatError(
          `The compacted copy ${candidate} does not end in the trailer that was written last`,
        );
      }
      requireSameHistory(published, versionOf(found.trailer));
      return { fileId: found.header.fileId, trailer: found.trailer };
    } finally {
      await handle.close();
    }
  } catch (error) {
    await fsp.rm(candidate, { force: true });
    throw error;
  }
}
