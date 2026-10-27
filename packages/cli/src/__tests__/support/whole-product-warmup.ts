/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { median } from '../../../../agents/src/core/__tests__/support/journal-retained-growth-predicate.js';

export const WHOLE_PRODUCT_WARMUP_TURNS = 530;

export interface WholeProductWarmup {
  readonly turns: number;
  readonly samples: ReadonlyArray<{
    turn: number;
    heapBytes: number;
    readings: readonly number[];
  }>;
}

export async function wholeProductWarmup(
  runTurn: (turn: number, payloadBytes: number) => Promise<void>,
  readHeap: () => Promise<number>,
): Promise<WholeProductWarmup> {
  const samples = [];
  let readings: number[] = [];
  for (let turn = 0; turn < WHOLE_PRODUCT_WARMUP_TURNS; turn++) {
    await runTurn(turn, turn < 350 ? 4096 : 65_536);
    if (turn >= 350 && turn % 10 !== 0) readings.push(await readHeap());
    if ((turn + 1) % 10 !== 0 || turn < 359) continue;
    samples.push({ turn: turn + 1, heapBytes: median(readings), readings });
    readings = [];
  }
  return { turns: WHOLE_PRODUCT_WARMUP_TURNS, samples };
}
