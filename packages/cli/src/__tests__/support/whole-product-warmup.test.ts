/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { wholeProductWarmup } from './whole-product-warmup.js';

interface WarmupRun {
  readonly turns: readonly number[];
  readonly payloadBytes: readonly number[];
  readonly result: Awaited<ReturnType<typeof wholeProductWarmup>>;
}

async function measureWarmup(growing: boolean): Promise<WarmupRun> {
  const turns: number[] = [];
  const payloadBytes: number[] = [];
  let samples = 0;
  const result = await wholeProductWarmup(
    async (turn, bytes): Promise<void> => {
      turns.push(turn);
      payloadBytes.push(bytes);
    },
    async (): Promise<number> => {
      samples++;
      return growing ? samples * 1_048_576 : 1_048_576;
    },
  );
  return { turns, payloadBytes, result };
}

describe('whole-product warmup workload', () => {
  for (const growing of [false, true]) {
    it(`warms every turn and the measured payload path with ${growing ? 'growing' : 'flat'} heap readings`, async () => {
      const measured = await measureWarmup(growing);
      expect(measured.turns).toStrictEqual(
        Array.from({ length: 610 }, (_, index) => index),
      );
      expect(measured.payloadBytes).toStrictEqual([
        ...Array.from({ length: 580 }, () => 4096),
        ...Array.from({ length: 30 }, () => 65_536),
      ]);
      expect(measured.result.turns).toBe(measured.turns.length);
      expect(
        measured.result.samples.map((sample) => sample.turn),
      ).toStrictEqual([590, 600, 610]);
      expect(
        measured.result.samples.map((sample) => sample.readings.length),
      ).toStrictEqual([9, 9, 9]);
      const last = measured.result.samples.at(-1);
      if (last === undefined) throw new Error('Missing warmup sample');
      expect(last.heapBytes).toBe(growing ? 23 * 1_048_576 : 1_048_576);
    });
  }
});
