/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import { encodeAggregate } from './aggregate.js';
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
 * Whether the file has outgrown what its published version needs (design
 * 4.11), computed from the last trailer alone. `notBefore` is the file size
 * below which the answer is no, set after a refused swap.
 */
export function compactionDue(version: Version, notBefore = 0): boolean {
  if (version.durableEnd < notBefore) return false;
  const live =
    version.aggregate.liveBytes +
    version.ckptBytes +
    version.aggregate.rows * ROW_ESTIMATE_BYTES;
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
