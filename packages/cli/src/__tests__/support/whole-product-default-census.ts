/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { generateHeapSnapshot } from 'bun';
import { heapStats } from 'bun:jsc';
import { expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  retainedAfterSettling,
  settledHeap,
} from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { evaluateRetainedGrowth } from '../../../../agents/src/core/__tests__/support/journal-retained-growth-predicate.js';
import { wholeProductFixture } from './whole-product-fixture.js';
import { heapTurn } from './whole-product-heap-turn.js';
import {
  heapText,
  startWholeProductTransport,
} from './whole-product-transport.js';
import { observeWholeProductRetention } from './whole-product-retention.js';
import {
  historyDataCensus,
  measurementMode,
} from './whole-product-measurement.js';

interface CensusSample {
  readonly turn: number;
  readonly rawHeap: number;
  readonly extraMemorySize: number;
  readonly graph: ReturnType<typeof historyDataCensus>;
}

function censusCollector(): {
  samples: CensusSample[];
  census(turn: number): Promise<void>;
} {
  const samples: CensusSample[] = [];
  return {
    samples,
    census: async (turn): Promise<void> => {
      const rawHeap = await settledHeap();
      const stats = heapStats();
      const graph = historyDataCensus(generateHeapSnapshot());
      samples.push({
        turn,
        rawHeap,
        extraMemorySize: stats.extraMemorySize,
        graph,
      });
    },
  };
}

interface CensusResult {
  readonly trap: boolean;
  readonly requests: number;
  readonly toolRounds: number;
  readonly observedRows: number;
  readonly aliveRows: number;
  readonly lifetime: { outstanding: number };
  readonly verdict: { pass: boolean };
  readonly dataVerdict: { pass: boolean };
}

async function reportCensus(
  root: string,
  result: CensusResult,
): Promise<boolean> {
  await writeFile(
    join(root, `default-census-${result.trap ? 'retain' : 'release'}.json`),
    `${JSON.stringify(result, null, 2)}
`,
  );
  process.stdout.write(`W24 default census ${root}
`);
  expect(result.requests).toBe(24);
  expect(result.toolRounds).toBe(2);
  expect(result.observedRows).toBeGreaterThan(100);
  expect(result.lifetime.outstanding).toBe(0);
  expect(result.aliveRows).toBe(result.trap ? result.observedRows : 0);
  expect(result.dataVerdict.pass).toBe(!result.trap);
  if (result.trap) expect(result.verdict.pass).toBe(false);
  return result.aliveRows === (result.trap ? result.observedRows : 0);
}

export async function wholeProductDefaultCensus(
  trap: boolean,
): Promise<boolean> {
  expect(measurementMode()).toBe('default-jsc');
  const browserWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: undefined,
  });
  const server = startWholeProductTransport();
  const fixture = await wholeProductFixture(server);
  const retention = observeWholeProductRetention(trap, true);
  const digest = createHash('sha256');
  const { samples, census } = censusCollector();
  try {
    fixture.live.setEphemeralSetting('context-limit', 2_000_000);
    await fixture.live.session.setRecording({ enabled: true });
    await fixture.live.session.recordRecordingTitle('W24 heap and I/O');
    for (let turn = 0; turn < 20; turn++) await heapTurn(fixture, turn);
    await census(0);
    const before = server.receipt();
    retention.start();
    for (let turn = 10000; turn < 10020; turn++) {
      digest.update(heapText(turn));
      await heapTurn(fixture, turn);
      expect(retention.lifetime().outstanding).toBe(0);
      if (turn % 10 === 9) await census(turn - 9999);
    }
    const after = server.receipt();
    const first = samples.at(0);
    if (first === undefined) throw new Error('Missing census');
    const verdict = evaluateRetainedGrowth(
      { turn: 0, heapBytes: first.rawHeap },
      samples
        .slice(1)
        .map((sample) => ({ turn: sample.turn, heapBytes: sample.rawHeap })),
    );
    const dataVerdict = evaluateRetainedGrowth(
      { turn: 0, heapBytes: first.graph.dataBytes },
      samples.slice(1).map((sample) => ({
        turn: sample.turn,
        heapBytes: sample.graph.dataBytes,
      })),
    );
    const result = {
      pid: process.pid,
      trap,
      measurementMode: measurementMode(),
      diagnosticOnly: true,
      warmupTurns: 20,
      measuredTurns: 20,
      inputHash: digest.digest('hex'),
      requests: after.requests - before.requests,
      toolRounds: after.toolRounds - before.toolRounds,
      transport: after,
      samples,
      verdict,
      dataVerdict,
      lifetime: retention.lifetime(),
      observedRows: retention.weakRows().length,
      aliveRows: await retainedAfterSettling(retention.weakRows()),
      retainedRows: retention.retained(),
    };
    return await reportCensus(fixture.root, result);
  } finally {
    retention.restore();
    await fixture.close();
    await server.server.stop(true);
    if (browserWindow === undefined)
      Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', browserWindow);
  }
}
