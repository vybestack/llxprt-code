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
  /** Settled heap minus the warmed baseline at the last checkpoint. */
  readonly retainedBytes: number;
  /** Settled heap minus the warmed baseline, one entry per checkpoint. */
  readonly checkpointDeltas: readonly number[];
  readonly intervalGrowth: readonly number[];
  /** Least-squares heap growth per turn, projected over the whole run. */
  readonly fittedRunGrowthBytes: number;
}

/** Least-squares slope of heap bytes against turn number. */
function leastSquaresSlope(points: readonly SettledCheckpoint[]): number {
  const count = points.length;
  const meanTurn = points.reduce((sum, p) => sum + p.turn, 0) / count;
  const meanHeap = points.reduce((sum, p) => sum + p.heapBytes, 0) / count;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.turn - meanTurn) * (point.heapBytes - meanHeap);
    variance += (point.turn - meanTurn) ** 2;
  }
  return covariance / variance;
}

/**
 * One predicate for the ordinary run and the deliberate-retention traps:
 * (1) the settled heap at EVERY checkpoint, minus the warmed baseline, stays
 * under the allowance, so a collection held between turns and released later
 * is still caught, and (2) heap growth does not scale with turn count: the
 * fitted growth over the whole run stays within settle noise. Neither gate
 * can be waived by a quiet or negative interval elsewhere in the run.
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
  const checkpointDeltas = checkpoints.map(
    (point) => point.heapBytes - baseline.heapBytes,
  );
  const last = checkpoints[checkpoints.length - 1];
  const retainedBytes = last.heapBytes - baseline.heapBytes;
  const fittedRunGrowthBytes =
    leastSquaresSlope(points) * (last.turn - baseline.turn);
  const failures: string[] = [];
  checkpoints.forEach((point, index) => {
    if (checkpointDeltas[index] >= RETAINED_ALLOWANCE_BYTES)
      failures.push(
        `retained ${checkpointDeltas[index]} bytes at turn ${point.turn} exceeds allowance ${RETAINED_ALLOWANCE_BYTES}`,
      );
  });
  if (fittedRunGrowthBytes > SETTLE_NOISE_BYTES)
    failures.push(
      `heap growth scales with turn count: fitted ${Math.round(fittedRunGrowthBytes)} bytes over the run exceeds ${SETTLE_NOISE_BYTES} bytes of settle noise`,
    );
  return {
    pass: failures.length === 0,
    failures,
    retainedBytes,
    checkpointDeltas,
    intervalGrowth,
    fittedRunGrowthBytes,
  };
}
