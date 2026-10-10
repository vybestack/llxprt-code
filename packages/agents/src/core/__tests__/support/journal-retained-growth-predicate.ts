/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** The retained allowance for the whole run. It is a contract, not a tunable. */
export const RETAINED_ALLOWANCE_BYTES = 1_048_576;

/**
 * Measured settle jitter between two settled checkpoints of one process. An
 * interval that grows by less than this is indistinguishable from GC residue.
 */
export const SETTLE_NOISE_BYTES = 262_144;

export interface SettledCheckpoint {
  readonly turn: number;
  /** Median of the settled heap readings taken at this checkpoint. */
  readonly heapBytes: number;
}

export interface RetainedGrowthVerdict {
  readonly pass: boolean;
  readonly failures: readonly string[];
  readonly retainedBytes: number;
  readonly intervalGrowth: readonly number[];
}

/**
 * One predicate for the ordinary run and the deliberate-retention trap:
 * (1) settled heap at the last checkpoint minus the warmed baseline stays
 * under the allowance, and (2) growth does not accumulate with turn count,
 * meaning at least one interval stays within settle noise.
 */
export function evaluateRetainedGrowth(
  baseline: SettledCheckpoint,
  checkpoints: readonly SettledCheckpoint[],
): RetainedGrowthVerdict {
  if (checkpoints.length < 2)
    throw new Error('Retained growth needs at least two checkpoints');
  const points = [baseline, ...checkpoints];
  const intervalGrowth = points
    .slice(1)
    .map((point, index) => point.heapBytes - points[index].heapBytes);
  const last = checkpoints[checkpoints.length - 1];
  const retainedBytes = last.heapBytes - baseline.heapBytes;
  const failures: string[] = [];
  if (retainedBytes >= RETAINED_ALLOWANCE_BYTES)
    failures.push(
      `retained ${retainedBytes} bytes at turn ${last.turn} exceeds allowance ${RETAINED_ALLOWANCE_BYTES}`,
    );
  if (intervalGrowth.every((growth) => growth > SETTLE_NOISE_BYTES))
    failures.push(
      `every checkpoint interval grew beyond ${SETTLE_NOISE_BYTES} bytes of settle noise: ${intervalGrowth.join(', ')}`,
    );
  return {
    pass: failures.length === 0,
    failures,
    retainedBytes,
    intervalGrowth,
  };
}
