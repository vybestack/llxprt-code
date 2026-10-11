/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** The retained allowance for the whole run. It is a contract, not a tunable. */
export const RETAINED_ALLOWANCE_BYTES = 1_048_576;

/**
 * Measured settle jitter between two settled checkpoints of one process. An
 * interval that grows by less than this is indistinguishable from GC residue.
 */
export const SETTLE_NOISE_BYTES = 262_144;

/**
 * A checkpoint, and each convergence window, is the median of this many
 * consecutive settled samples. At one sample per 5 turns the window spans 45
 * turns, several times longer than the periodic transient that drops the
 * settled heap by 1 to 3 MB for about 10 turns, so the median ignores it.
 */
export const WINDOW_SAMPLES = 9;
/** Consecutive non-overlapping windows that must agree for warm-up to end. */
export const CONVERGENCE_WINDOWS = 3;

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Warm-up has settled when the medians of the last CONVERGENCE_WINDOWS
 * non-overlapping windows of WINDOW_SAMPLES readings all lie within
 * SETTLE_NOISE_BYTES of each other (spread, not just neighbouring steps, so a
 * slow steady climb cannot pass in small steps). An isolated dip lands in at
 * most one window slot and cannot move that window's median.
 */
export function hasConverged(heapReadings: readonly number[]): boolean {
  if (heapReadings.length < WINDOW_SAMPLES * CONVERGENCE_WINDOWS) return false;
  const medians: number[] = [];
  for (let slot = 0; slot < CONVERGENCE_WINDOWS; slot++) {
    const end = heapReadings.length - slot * WINDOW_SAMPLES;
    medians.push(median(heapReadings.slice(end - WINDOW_SAMPLES, end)));
  }
  return Math.max(...medians) - Math.min(...medians) < SETTLE_NOISE_BYTES;
}

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
  /**
   * Least-squares heap growth per turn over the late window, projected over
   * the late window's turn span. The late window starts at the checkpoint
   * that ends the first half of the run and is fitted against its own start.
   */
  readonly lateFittedGrowthBytes: number;
  /** Late-window last checkpoint minus its first checkpoint. */
  readonly lateEndpointGrowthBytes: number;
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
 * Index of the first late-window checkpoint: the checkpoint that closes the
 * first half of the run (checkpoint 4 of 8). The window runs to the last
 * checkpoint and is fitted against its own start.
 */
function lateWindowStart(checkpointCount: number): number {
  return Math.max(0, Math.floor(checkpointCount / 2) - 1);
}

/**
 * One predicate for the ordinary run and the deliberate-retention traps:
 * (1) the settled heap at EVERY checkpoint, minus the warmed baseline, stays
 * under the allowance, so a collection held between turns and released later
 * is still caught and a one-time step anywhere is bounded by the allowance,
 * and (2) heap growth does not accumulate with turn count: both the fitted
 * growth and the endpoint growth over the late half of the measured window
 * stay within settle noise. JavaScriptCore lazy compilation produces
 * bounded one-time steps at turns that vary by machine; a linear fit over the
 * whole window is dominated by one such step, while a sustained leak keeps
 * growing through the late half and fails it. Neither gate can be waived by a
 * quiet or negative interval elsewhere in the run.
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
  const late = checkpoints.slice(lateWindowStart(checkpoints.length));
  const lateStart = late[0];
  const lateFittedGrowthBytes =
    leastSquaresSlope(late) * (last.turn - lateStart.turn);
  const lateEndpointGrowthBytes = last.heapBytes - lateStart.heapBytes;
  const failures: string[] = [];
  checkpoints.forEach((point, index) => {
    if (checkpointDeltas[index] >= RETAINED_ALLOWANCE_BYTES)
      failures.push(
        `retained ${checkpointDeltas[index]} bytes at turn ${point.turn} exceeds allowance ${RETAINED_ALLOWANCE_BYTES}`,
      );
  });
  if (lateFittedGrowthBytes > SETTLE_NOISE_BYTES)
    failures.push(
      `heap growth scales with turn count: fitted ${Math.round(lateFittedGrowthBytes)} bytes over turns ${lateStart.turn} to ${last.turn} exceeds ${SETTLE_NOISE_BYTES} bytes of settle noise`,
    );
  if (lateEndpointGrowthBytes > SETTLE_NOISE_BYTES)
    failures.push(
      `heap grew ${lateEndpointGrowthBytes} bytes from turn ${lateStart.turn} to ${last.turn}, above ${SETTLE_NOISE_BYTES} bytes of settle noise`,
    );
  return {
    pass: failures.length === 0,
    failures,
    retainedBytes,
    checkpointDeltas,
    intervalGrowth,
    lateFittedGrowthBytes,
    lateEndpointGrowthBytes,
  };
}
