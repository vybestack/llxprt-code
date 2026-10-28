/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  RETAINED_ALLOWANCE_BYTES,
  type SettledCheckpoint,
} from './journal-retained-growth-predicate.js';

/** Compare the half-size and full-size runs, retaining the intermediate gates. */
export function evaluateRetainedSizes(
  baseline: SettledCheckpoint,
  checkpoints: readonly SettledCheckpoint[],
): {
  readonly pass: boolean;
  readonly failures: readonly string[];
  readonly retainedBytes: number;
  readonly checkpointDeltas: readonly number[];
  readonly growthBytes: number;
} {
  if (checkpoints.length < 2)
    throw new Error('Retained growth needs at least two checkpoints');
  const small = checkpoints[Math.floor(checkpoints.length / 2) - 1];
  const large = checkpoints[checkpoints.length - 1];
  const checkpointDeltas = checkpoints.map(
    (point) => point.heapBytes - baseline.heapBytes,
  );
  const failures: string[] = [];
  for (let index = 0; index < checkpoints.length; index++) {
    if (checkpointDeltas[index] >= RETAINED_ALLOWANCE_BYTES)
      failures.push(
        `retained ${checkpointDeltas[index]} bytes at turn ${checkpoints[index].turn} exceeds allowance ${RETAINED_ALLOWANCE_BYTES}`,
      );
  }
  const growthBytes = large.heapBytes - small.heapBytes;
  if (growthBytes >= RETAINED_ALLOWANCE_BYTES)
    failures.push(
      `heap grew ${growthBytes} bytes between ${small.turn - baseline.turn} and ${large.turn - baseline.turn} measured turns, exceeds allowance ${RETAINED_ALLOWANCE_BYTES}`,
    );
  return {
    pass: failures.length === 0,
    failures,
    retainedBytes: large.heapBytes - baseline.heapBytes,
    checkpointDeltas,
    growthBytes,
  };
}
