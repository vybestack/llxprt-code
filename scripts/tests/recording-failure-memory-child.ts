/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingFailureStore } from '../../packages/core/src/recording/recording-failure-report.js';

async function settled(): Promise<{ heap: number; external: number }> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}
const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const count = Number(process.argv[2]);
const trap = process.argv[3] === 'trap';
if (!Number.isSafeInteger(count) || count < 1)
  throw new Error('Expected positive failure count');
const root = mkdtempSync(join(tmpdir(), 'recording-failure-memory-'));
try {
  const warmup = new RecordingFailureStore(join(root, 'warmup'));
  for (let generation = 1; generation <= 32; generation += 1)
    warmup.record(generation, new Error('warmup'));
  await warmup.takeThrough(32, 'warmup')?.close();
  const store = new RecordingFailureStore(join(root, 'probe'));
  const before = await settled();
  const probes: Array<WeakRef<{ text: string }>> = [];
  const retained: Error[] = [];
  for (let generation = 1; generation <= count; generation += 1) {
    const row = { text: randomBytes(1536).toString('base64') };
    const error = new Error(`failed-${generation}`, { cause: { row } });
    probes.push(new WeakRef(row));
    if (trap) retained.push(error);
    store.record(generation, error);
  }
  const trappedSummary = trap
    ? new AggregateError(retained, 'Old eager reporting contract')
    : undefined;
  retained.length = 0;
  const report = store.takeThrough(count, 'Probe persistence failed');
  if (report === undefined || report.count !== count)
    throw new Error('Missing failure report');
  const cursor = report.details();
  let heldDetail = await cursor.next();
  while (!heldDetail.done) {
    if (
      heldDetail.value.kind === 'string' &&
      heldDetail.value.path === '$.cause.row.text'
    )
      break;
    heldDetail = await cursor.next();
  }
  if (heldDetail.done)
    throw new Error('Failure cursor did not deliver the row diagnostic');
  const held = await settled();
  const diagnosticBytes = Buffer.byteLength(JSON.stringify(heldDetail.value));
  let liveRows = 0;
  let liveBytes = 0;
  for (const probe of probes) {
    const row = probe.deref();
    if (row !== undefined) {
      liveRows += 1;
      liveBytes += Buffer.byteLength(row.text);
    }
  }
  process.stdout.write(
    JSON.stringify({
      count: report.count,
      heap: held.heap - before.heap,
      external: held.external - before.external,
      liveRows,
      liveBytes,
      decodedDetails: 1,
      diagnosticBytes,
      trap,
      retainedErrors: trappedSummary?.errors.length ?? 0,
    }) + '\n',
  );
  await report.close();
  if (!(await cursor.next()).done)
    throw new Error('Closed failure cursor kept producing diagnostics');
  if (trap && trappedSummary?.errors.length !== count)
    throw new Error('Retaining trap did not remain alive');
} finally {
  rmSync(root, { recursive: true, force: true });
}
