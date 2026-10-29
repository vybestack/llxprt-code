/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { retainedAfterSettling } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { evaluateRetainedGrowth } from '../../../../agents/src/core/__tests__/support/journal-retained-growth-predicate.js';
import {
  wholeProductFixture,
  type WholeProductFixture,
} from './whole-product-fixture.js';
import { startWholeProductTransport } from './whole-product-transport.js';
import { observeWholeProductIo, ioDifference } from './whole-product-io.js';
import { observeWholeProductRetention } from './whole-product-retention.js';
import { lockedRecordingPath } from './whole-product-observer.js';
import { measurementMode } from './whole-product-measurement.js';
import { warmUp } from './whole-product-heap-turn.js';
import {
  heapBaseline,
  measuredWindow,
  type HeapWindow,
} from './whole-product-heap-window.js';

type Transport = ReturnType<typeof startWholeProductTransport>;
type Io = Awaited<ReturnType<typeof observeWholeProductIo>>;
type Retention = ReturnType<typeof observeWholeProductRetention>;

async function measureFixture(
  fixture: WholeProductFixture,
  server: Transport,
  io: Io,
  retention: Retention,
  trap: boolean,
  warmed?: () => Promise<void>,
): Promise<boolean> {
  fixture.live.setEphemeralSetting('context-limit', 2_000_000);
  await fixture.live.session.setRecording({ enabled: true });
  await fixture.live.session.recordRecordingTitle('W24 heap and I/O');
  const path = await lockedRecordingPath(fixture.live);
  const warmup = await warmUp(fixture);
  await warmed?.();
  const baseline = await heapBaseline(fixture);
  const beforeTransport = server.receipt();
  const beforeIo = io.snapshot();
  const measured: HeapWindow = await measuredWindow(fixture, io, retention);
  const verdict = evaluateRetainedGrowth(baseline, measured.checkpoints);
  const afterTransport = server.receipt();
  const aliveRows = await retainedAfterSettling(retention.weakRows());
  const warmupAliveRows = await retainedAfterSettling(retention.warmRows());
  const result = {
    pid: process.pid,
    mode: trap ? 'trap' : 'normal',
    measurementMode: measurementMode(),
    engine: Bun.version,
    revision: Bun.revision,
    transport: afterTransport,
    path,
    rowBytes: 65_536,
    measuredTurns: 50,
    warmup,
    baseline,
    ...measured,
    verdict,
    retainedRows: retention.retained(),
    observedRows: retention.weakRows().length,
    aliveRows,
    warmupAliveRows,
    observedWarmupRows: retention.warmRows().length,
    lifetime: retention.lifetime(),
    requests: afterTransport.requests - beforeTransport.requests,
    toolRounds: afterTransport.toolRounds - beforeTransport.toolRounds,
    totalIo: ioDifference(io.snapshot(), beforeIo),
  };
  await writeFile(
    join(fixture.root, `${result.mode}-heap-io.json`),
    JSON.stringify(result, null, 2) + '\n',
  );
  process.stdout.write(
    `W24 heap receipt ${fixture.root}/${result.mode}-heap-io.json\n${JSON.stringify({ mode: result.mode, verdict, aliveRows, retainedRows: result.retainedRows, totalIo: result.totalIo })}\n`,
  );
  expect(result.requests).toBe(60);
  expect(result.toolRounds).toBe(5);
  expect(result.observedRows).toBeGreaterThanOrEqual(50);
  expect(verdict.failures).toStrictEqual([]);
  expect(verdict.pass).toBe(true);
  expect(aliveRows).toBe(0);
  expect(warmupAliveRows).toBe(0);
  expect(retention.retained()).toBe(0);
  return verdict.pass;
}

export async function wholeProductHeap(
  trap: boolean,
  warmed?: () => Promise<void>,
): Promise<boolean> {
  measurementMode();
  const server = startWholeProductTransport();
  const browserWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });
  const io = await observeWholeProductIo();
  try {
    const fixture = await wholeProductFixture(server);
    const retention = observeWholeProductRetention(trap);
    try {
      return await measureFixture(fixture, server, io, retention, trap, warmed);
    } finally {
      retention.restore();
      await fixture.close();
    }
  } finally {
    io.restore();
    await server.server.stop(true);
    if (browserWindow === undefined)
      Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', browserWindow);
  }
}
