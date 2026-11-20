/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  RETAINED_ALLOWANCE_BYTES,
  median,
  type SettledCheckpoint,
} from './journal-retained-growth-predicate.js';

/** Fit median pairwise growth over the half/full-size span; gate every checkpoint. */
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
  const slopes: number[] = [];
  for (let first = 0; first < checkpoints.length - 1; first++) {
    for (let last = first + 1; last < checkpoints.length; last++) {
      const earlier = checkpoints[first];
      const later = checkpoints[last];
      if (later.turn <= earlier.turn)
        throw new Error(
          'Retained growth checkpoints must increase in turn count',
        );
      slopes.push(
        (later.heapBytes - earlier.heapBytes) / (later.turn - earlier.turn),
      );
    }
  }
  const growthBytes = median(slopes) * (large.turn - small.turn);
  if (growthBytes >= RETAINED_ALLOWANCE_BYTES)
    failures.push(
      `median fitted heap grew ${growthBytes} bytes over ${large.turn - small.turn} measured turns, exceeds allowance ${RETAINED_ALLOWANCE_BYTES}`,
    );
  return {
    pass: failures.length === 0,
    failures,
    retainedBytes: large.heapBytes - baseline.heapBytes,
    checkpointDeltas,
    growthBytes,
  };
}
