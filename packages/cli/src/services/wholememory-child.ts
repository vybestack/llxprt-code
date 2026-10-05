/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
declare const Bun: { readonly version: string };
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryCommand } from './wholememory-command.js';
import {
  heapCensus,
  observeDecodedRows,
  settleHeap,
} from './wholememory-probe.js';

const [directory, countText, workload, target, mode] = process.argv.slice(2);
const count = Number(countText);
const pin = (
  await readFile(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      '.bun-version',
    ),
    'utf8',
  )
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}, got ${Bun.version}`);

async function warmup(): Promise<void> {
  const command = new MemoryCommand();
  const observer = observeDecodedRows('normal');
  try {
    await command.run(join(directory, 'warmup'), 2048, workload, target);
  } finally {
    observer.restore();
    await command.close();
  }
}

const warmups = [];
for (let pass = 0; pass < 4; pass += 1) {
  await warmup();
  await settleHeap();
  warmups.push(heapCensus());
}
const command = new MemoryCommand();
const observer = observeDecodedRows(mode);
await settleHeap();
const before = heapCensus(join(directory, 'before.heap.json'));
await settleHeap();
await command.run(directory, count, workload, target);
await settleHeap();
const after = heapCensus(join(directory, 'after.heap.json'));
const report = {
  bun: Bun.version,
  count,
  workload,
  target,
  mode,
  warmups,
  before,
  after,
  retainedBytes: after.heapSize - before.heapSize,
  retainedExtraBytes: after.extraMemorySize - before.extraMemorySize,
  snapshotByteDelta: after.bytes - before.bytes,
  readerCounters: command.counters.snapshot(),
  peakScope: 'reader-owned rows only; global transient peak unmeasured',
  pagerDecoded: command.pagerDecoded,
  uiRows: command.uiHistory.length,
  metadataDirectories: command.metadataDirectories,
  metadataDirectoryCharacters: command.metadataDirectoryCharacters,
  probes: observer.snapshot(),
  resident: command.pager?.metrics(),
};
process.stdout.write(`${JSON.stringify(report)}
`);
observer.restore();
await command.close();
