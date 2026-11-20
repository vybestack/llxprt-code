/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapStats } from 'bun:jsc';
import { createRecordAccess } from '../../recordAccess.js';
import { ArrivalRecordCache } from '../../arrival-record-cache.js';

const size = Number(process.argv[2]);
if (!Number.isSafeInteger(size) || size <= 0)
  throw new Error('Expected a positive access count');
const reader = {
  readAt: async (): Promise<Uint8Array> => {
    throw new Error('Unused access must not read');
  },
};
const cache = new ArrivalRecordCache();
// Warm both factories before taking the allocation census.
cache.access(
  createRecordAccess('warm', reader, { selfOffset: 0, durableEnd: 0 }),
  0,
);
gcAndSweep();
const before = heapStats().objectTypeCounts.Map;
const accesses = Array.from({ length: size }, () =>
  cache.access(
    createRecordAccess('unused', reader, { selfOffset: 0, durableEnd: 0 }),
    0,
  ),
);
gcAndSweep();
const maps = heapStats().objectTypeCounts.Map - before;
// Keep every access live through the census, then exercise its owned path.
let entries = 0;
for (const [offset, access] of accesses.entries()) {
  entries += access.rowTreePath.size;
  access.rowTreePath.set(0, { offset, node: { kind: 'leaf', entries: [] } });
}
const offsetSum = accesses.reduce(
  (sum, access) => sum + (access.rowTreePath.get(0)?.offset ?? -1),
  0,
);
process.stdout.write(
  JSON.stringify({ size: accesses.length, maps, entries, offsetSum }),
);
