/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { median } from '../../../../agents/src/core/__tests__/support/journal-retained-growth-predicate.js';
import type { WholeProductFixture } from './whole-product-fixture.js';
import { heapTurn } from './whole-product-heap-turn.js';
import { heapText } from './whole-product-transport.js';
import {
  ioDifference,
  type observeWholeProductIo,
  type IoSnapshot,
} from './whole-product-io.js';
import type { observeWholeProductRetention } from './whole-product-retention.js';

interface Checkpoint {
  readonly turn: number;
  readonly heapBytes: number;
  readonly readings: readonly number[];
}
interface TurnMeasurement {
  readonly turn: number;
  readonly tool: boolean;
  readonly compression: boolean;
  readonly wallMs: number;
  readonly cpu: NodeJS.CpuUsage;
  readonly io: IoSnapshot;
}
export interface HeapWindow {
  readonly checkpoints: readonly Checkpoint[];
  readonly measurements: readonly TurnMeasurement[];
  readonly inputHash: string;
}

export async function heapBaseline(
  fixture: WholeProductFixture,
): Promise<Checkpoint> {
  const readings = [];
  for (let turn = 0; turn < 10; turn++) {
    await heapTurn(fixture, 9000 + turn);
    if (turn > 0) readings.push(await settledHeap());
  }
  return { turn: 0, heapBytes: median(readings), readings };
}

export async function measuredWindow(
  fixture: WholeProductFixture,
  io: Awaited<ReturnType<typeof observeWholeProductIo>>,
  retention: ReturnType<typeof observeWholeProductRetention>,
): Promise<HeapWindow> {
  const measurements = [];
  const checkpoints = [];
  const input = createHash('sha256');
  let readings: number[] = [];
  retention.start();
  for (let turn = 1; turn <= 50; turn++) {
    input.update(heapText(10000 + turn - 1));
    const before = io.snapshot();
    const cpu = process.cpuUsage();
    const started = performance.now();
    await heapTurn(fixture, 10000 + turn - 1);
    measurements.push({
      turn,
      tool: turn % 10 === 5,
      compression: turn % 10 === 0,
      wallMs: performance.now() - started,
      cpu: process.cpuUsage(cpu),
      io: ioDifference(io.snapshot(), before),
    });
    expect(retention.lifetime().outstanding).toBe(0);
    if (turn % 10 !== 1) readings.push(await settledHeap());
    if (turn % 10 === 0) {
      checkpoints.push({ turn, heapBytes: median(readings), readings });
      readings = [];
    }
  }
  return { measurements, checkpoints, inputHash: input.digest('hex') };
}
