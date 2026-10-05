/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withSynchronousFixture } from '../../packages/core/src/services/history/synchronous-ticket-test-helpers.js';
import { batchRow } from '../../packages/core/src/services/history/addbatch-stream-test-helpers.js';
import {
  settledHeapCensus,
  heapCensus,
} from '../../packages/cli/src/services/wholememory-probe.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

const [directory, sizeText, mode] = process.argv.slice(2);
const size = Number(sizeText);
if (Bun.version !== readFileSync('.bun-version', 'utf8').trim())
  throw new Error('Bun pin mismatch');
mkdirSync(directory, { recursive: true });

function populate(
  history: Parameters<
    Parameters<typeof withSynchronousFixture>[0]
  >[0]['history'],
  count: number,
): void {
  for (let ordinal = 0; ordinal < count; ordinal++)
    history.add(batchRow(ordinal));
}

for (let warmup = 0; warmup < 4; warmup++) {
  await withSynchronousFixture(async ({ history }) => {
    populate(history, 2048);
    await history.waitForCommit();
    await history.waitForTokenUpdates();
  });
  await settledHeapCensus();
}

await withSynchronousFixture(async (fixture) => {
  const retained: IContent[] = [];
  if (mode === 'retaining')
    fixture.history.on('contentAdded', (row) => {
      retained.push(row);
      fixture.owners.retain(row);
    });
  await settledHeapCensus();
  const before = heapCensus(join(directory, 'before.heap.json'));
  fixture.pauseWriter();
  populate(fixture.history, size);
  await fixture.waitForPausedWrite;
  await settledHeapCensus();
  const paused = heapCensus(join(directory, 'paused.heap.json'));
  fixture.releaseWriter();
  await fixture.history.waitForCommit();
  await fixture.history.waitForTokenUpdates();
  await fixture.history.waitForOwnershipSettlement();
  await settledHeapCensus();
  const after = heapCensus(join(directory, 'after.heap.json'));
  const report = {
    bun: Bun.version,
    size,
    mode,
    before,
    paused,
    after,
    retainedBytes: after.heapSize - before.heapSize,
    retainedExtraBytes: after.extraMemorySize - before.extraMemorySize,
    pausedBytes: paused.heapSize - before.heapSize,
    owners: fixture.owners.snapshot(),
    writerPeakBytes: fixture.writerPeakBytes(),
    retainedRows: retained.length,
    historyRows: fixture.history.length(),
  };
  writeFileSync(
    join(directory, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  for (const row of retained) fixture.owners.release(row);
  retained.length = 0;
});
