/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import { DumpScratch } from '../../../../utils/dumpScratch.js';
import { KeyedRowIndex } from '../../../../utils/keyed-row-index.js';

export interface StorageCounts {
  /** Record reads from the message and block stores. */
  readonly tableReads: number;
  /** Record writes (append and replace) to those stores. */
  readonly tableWrites: number;
  /** Lookups and writes on the keyed id indexes. */
  readonly indexOperations: number;
  readonly total: number;
}

/**
 * Counts every storage operation made while `work` runs, by spying on the two
 * storage classes the table is built from. The spies call through, so the work
 * behaves exactly as it does without them.
 */
export async function countStorageOperations(
  work: () => Promise<unknown>,
): Promise<StorageCounts> {
  const reads = spyOn(DumpScratch.prototype, 'read');
  const writes = spyOn(DumpScratch.prototype, 'replace');
  const gets = spyOn(KeyedRowIndex.prototype, 'get');
  const sets = spyOn(KeyedRowIndex.prototype, 'set');
  try {
    await work();
    const tableReads = reads.mock.calls.length;
    const tableWrites = writes.mock.calls.length;
    const indexOperations = gets.mock.calls.length + sets.mock.calls.length;
    return {
      tableReads,
      tableWrites,
      indexOperations,
      total: tableReads + tableWrites + indexOperations,
    };
  } finally {
    reads.mockRestore();
    writes.mockRestore();
    gets.mockRestore();
    sets.mockRestore();
  }
}
