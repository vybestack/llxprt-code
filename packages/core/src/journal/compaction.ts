/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import { encodeAggregate } from './aggregate.js';
import { getU64, putU64, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { Version } from './version.js';

const MIB = 1024 * 1024;

/** A session below this size never compacts (design 4.11); tuned by the write budget test and nowhere else. */
export const COMPACTION_FLOOR_BYTES = 64 * MIB;
/** After a refused swap the trigger is evaluated again once the file has grown this much. */
export const COMPACTION_REARM_BYTES = 16 * MIB;
/** The factor of design 4.11: the file may be twice what it needs before it is compacted. */
const COMPACTION_FACTOR = 2;
/** The entry, its share of internal nodes and its id facts (design 4.11). */
const ROW_ESTIMATE_BYTES = 1550;

/**
 * The unversioned state map entry (design 3.5) that holds the size of the
 * file the last compaction wrote, so the trigger survives reopen, pop and
 * restore. A file that was never compacted has no entry and reads as 0.
 */
export const COMPACTED_BYTES_KEY = 'compaction:bytes';

export function encodeCompactedBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(8);
  putU64(viewOf(bytes), 0, 'compactedBytes', size);
  return bytes;
}

export function decodeCompactedBytes(bytes: Uint8Array | undefined): number {
  if (bytes === undefined) return 0;
  if (bytes.length !== 8)
    throw new JournalFormatError('Invalid compacted size entry');
  return getU64(viewOf(bytes), 0, 'compactedBytes');
}

/** What the trigger knows besides the trailer: the transcript's reachable bytes and the last compacted size. */
export interface CompactionSizes {
  readonly transcriptReachableBytes?: number;
  readonly compactedBytes?: number;
}

/**
 * Whether the file has outgrown what its published version needs (design
 * 4.11 and 16.3), computed from the last trailer and two state entries.
 * `notBefore` is the file size below which the answer is no, set after a
 * refused swap. The live side is the larger of the estimate and the size the
 * last compaction wrote, so an estimate that undercounts never re-triggers a
 * copy of a file that has not doubled since.
 */
export function compactionDue(
  version: Version,
  notBefore = 0,
  sizes: CompactionSizes = {},
): boolean {
  if (version.durableEnd < notBefore) return false;
  const estimate =
    Math.max(
      sizes.transcriptReachableBytes ?? version.aggregate.liveBytes,
      version.aggregate.liveBytes,
    ) +
    version.ckptBytes +
    version.aggregate.rows * ROW_ESTIMATE_BYTES;
  const live = Math.max(sizes.compactedBytes ?? 0, estimate);
  return version.durableEnd > COMPACTION_FACTOR * live + COMPACTION_FLOOR_BYTES;
}

/** The file the copy is written to, in the same directory so the rename stays on one volume. */
export function compactionCandidatePath(path: string): string {
  return `${path}.compact`;
}

/** Owner open deletes a candidate a crashed compaction left behind (design 4.11 step 1). */
export async function removeStaleCompaction(path: string): Promise<void> {
  await fsp.rm(compactionCandidatePath(path), { force: true });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((b, at) => b === right[at]);
}

/**
 * Design 4.11 step 6: the copy must hold the history it was made from. A
 * difference is a bug in the copy, and nothing recovers from it silently.
 */
export function requireSameHistory(old: Version, copied: Version): void {
  if (
    !sameBytes(
      encodeAggregate(old.aggregate),
      encodeAggregate(copied.aggregate),
    )
  ) {
    throw new JournalFormatError(
      `The compacted copy differs from the journal it was made from (rows ${copied.aggregate.rows} against ${old.aggregate.rows}, live bytes ${copied.aggregate.liveBytes} against ${old.aggregate.liveBytes})`,
    );
  }
}
