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
    it(`runs the frozen input sequence with ${growing ? 'growing' : 'flat'} heap readings`, async () => {
      const measured = await measureWarmup(growing);
      expect(measured.turns).toStrictEqual(
        Array.from({ length: 530 }, (_, index) => index),
      );
      expect(measured.payloadBytes).toStrictEqual([
        ...Array.from({ length: 350 }, () => 4096),
        ...Array.from({ length: 180 }, () => 65_536),
      ]);
      expect(measured.result.turns).toBe(measured.turns.length);
      expect(
        measured.result.samples.map((sample) => sample.turn),
      ).toStrictEqual(
        Array.from({ length: 18 }, (_, index) => 360 + index * 10),
      );
      expect(
        measured.result.samples.map((sample) => sample.readings.length),
      ).toStrictEqual(Array.from({ length: 18 }, () => 9));
      const last = measured.result.samples.at(-1);
      if (last === undefined) throw new Error('Missing warmup sample');
      expect(last.heapBytes).toBe(growing ? 158 * 1_048_576 : 1_048_576);
    });
  }
});
