/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from '../../recordAccess.js';

/** Record heads read through a counting access, by the name the reader gave the record. */
export type HeadReads = Map<string, number>;

/**
 * A record access that counts the record heads read through it, by record
 * name, and otherwise reads exactly what `access` reads. The count is a
 * measure of the work a copy does on the source that does not depend on how
 * fast or how loaded the machine is.
 */
export function countingAccess(
  access: RecordAccess,
  reads: HeadReads,
): RecordAccess {
  const count = (what: string | undefined): void => {
    const name = what ?? 'record';
    reads.set(name, (reads.get(name) ?? 0) + 1);
  };
  return {
    readRecordHead(offset, what, prefetchBytes) {
      count(what);
      return access.readRecordHead(offset, what, prefetchBytes);
    },
    readRecordStart(offset, what, prefetchBytes) {
      count(what);
      return access.readRecordStart(offset, what, prefetchBytes);
    },
    readRecordBody: (head, chunkBytes, what) =>
      access.readRecordBody(head, chunkBytes, what),
  };
}
