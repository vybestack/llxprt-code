/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { launchAcceptanceChild } from '../../packages/agents/src/core/__tests__/childaccept-fixture.js';
import { sendChildHistory } from '../../packages/agents/src/core/__tests__/childaccept-transport.js';
import { textRow } from '../../packages/agents/src/core/__tests__/childaccept-operations.js';
import {
  heapCensus,
  observeDecodedRows,
  settleHeap,
} from '../../packages/cli/src/services/__tests__/support/wholememory-probe.js';
import { activeRequestBodyCount } from '../../packages/providers/src/utils/requestScopedBody.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';

declare const Bun: { version: string };
const [directory, countText, workload, mode, baseUrl] = process.argv.slice(2);
const count = Number(countText);
const pin = (await readFile('.bun-version', 'utf8')).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);

async function populate(history: HistoryService, size: number): Promise<void> {
  const lines = createInterface({
    input: createReadStream(join(directory, 'payloads.jsonl')),
    crlfDelay: Infinity,
  });
  let batch: IContent[] = [];
  let added = 0;
  try {
    for await (const line of lines) {
      batch.push(textRow(line, added % 2 !== 0));
      added += 1;
      if (batch.length === 32) {
        await history.addBatch(batch);
        batch = [];
      }
      if (workload === 'compressed' && added % 128 === 0 && added < size)
        await history.replaceAll([textRow(`summary-${added}`)]);
      if (added === size) break;
    }
  } finally {
    lines.close();
  }
  if (added !== size || batch.length !== 0)
    throw new Error('Incomplete fixture');
  await history.waitForCommit();
  await history.waitForTokenUpdates();
  await history.waitForOwnershipSettlement();
}

async function start(
  label: string,
): Promise<Awaited<ReturnType<typeof launchAcceptanceChild>>> {
  const path = join(directory, label);
  await mkdir(path, { recursive: true });
  return launchAcceptanceChild(path, baseUrl);
}

async function warmup(pass: number): Promise<void> {
  const fixture = await start(`warmup-${pass}`);
  try {
    await populate(fixture.child.runtime.history, 2048);
    const observer = observeDecodedRows('normal');
    try {
      await sendChildHistory(fixture.child);
      observer.snapshot();
    } finally {
      observer.restore();
    }
  } finally {
    await fixture.close();
  }
}

const warmups = [];
for (let pass = 0; pass < 4; pass += 1) {
  await warmup(pass);
  await settleHeap();
  warmups.push(heapCensus());
}
const fixture = await start('measured');
await settleHeap();
const before = heapCensus(join(directory, 'before.heap.json'));
await settleHeap();
await populate(fixture.child.runtime.history, count);
const observer = observeDecodedRows(mode);
await sendChildHistory(fixture.child);
await settleHeap();
const after = heapCensus(join(directory, 'after.heap.json'));
const report = {
  bun: Bun.version,
  count,
  workload,
  mode,
  warmups,
  before,
  after,
  retainedBytes: after.heapSize - before.heapSize,
  retainedExtraBytes: after.extraMemorySize - before.extraMemorySize,
  probes: observer.snapshot(),
  bodyLeases: activeRequestBodyCount(),
  historyRows: fixture.child.runtime.history.length(),
  scope:
    'settled child runtime with provider call complete; global transient peak unmeasured',
};
observer.restore();
const path = fixture.child.runtime.history.journalPath();
if (path === null) throw new Error('Child journal absent');
await copyFile(path, join(directory, 'child.jsonl'));
await writeFile(
  join(directory, 'report.json'),
  JSON.stringify(report, null, 2),
);
await fixture.close();
process.stdout.write(`${JSON.stringify(report)}\n`);
