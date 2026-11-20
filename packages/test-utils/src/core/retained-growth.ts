/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export interface RetainedMeasurement {
  retainedBytes: number;
  retainedExtraBytes: number;
}

export function heapAccepted(
  small: RetainedMeasurement,
  large: RetainedMeasurement,
  tolerance: number,
): boolean {
  return (
    large.retainedBytes - small.retainedBytes <= tolerance &&
    large.retainedExtraBytes - small.retainedExtraBytes <= tolerance
  );
}

/**
 * Byte allowance for paired retained-growth certification. One-sided: growth
 * beyond this is failure; reductions are always acceptable.
 */
export const RETAINED_ALLOWANCE_BYTES = 1_048_576;

/** One paired large-minus-small delta per retained-heap counter. */
export interface PairedDelta {
  heap: number;
  external: number;
}

/**
 * Prospective paired-estimator verdict under the dated correction in
 * tmp/verify854/p05d/estimator-protocol.md. The sample median is the primary
 * statistic; a one-sided upper bound on each population median must also sit
 * inside the allowance. Nominal coverage requires i.i.d. pairs within each
 * workload and counter; it does not extend across workloads.
 */
export function pairedEstimate(
  deltas: readonly PairedDelta[],
  allowance = RETAINED_ALLOWANCE_BYTES,
): { median: PairedDelta; bound: PairedDelta; pass: boolean } {
  if (deltas.length === 0)
    throw new Error('Paired estimator requires at least one delta');
  const sorted = [...deltas].sort((left, right) => left.heap - right.heap);
  const medianHeap = median(sorted.map((delta) => delta.heap));
  const sortedExternal = [...deltas].sort(
    (left, right) => left.external - right.external,
  );
  const medianExternal = median(sortedExternal.map((delta) => delta.external));

  // The fixed one-sided upper median rank permits this many deltas strictly
  // above the allowance; rank selection never depends on observed deltas.
  const tolerated = pairedSignToleratedExceedances(sorted.length);
  const heapBound = sorted[sorted.length - 1 - tolerated].heap;
  const externalBound =
    sortedExternal[sortedExternal.length - 1 - tolerated].external;

  return {
    median: { heap: medianHeap, external: medianExternal },
    bound: { heap: heapBound, external: externalBound },
    pass:
      medianHeap <= allowance &&
      medianExternal <= allowance &&
      heapBound <= allowance &&
      externalBound <= allowance,
  };
}

function median(sortedValues: number[]): number {
  const count = sortedValues.length;
  const mid = Math.floor(count / 2);
  return count % 2 === 1
    ? sortedValues[mid]
    : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

/**
 * Maximum count of deltas strictly above the allowance compatible with the
 * fixed one-sided upper population-median bound (at least 95% marginal
 * coverage under i.i.d. pairs). N=4 has no finite qualifying order statistic.
 * Unsupported counts refuse certification rather than using a weaker rank.
 */
export function pairedSignToleratedExceedances(sampleCount: number): number {
  switch (sampleCount) {
    case 5:
    case 6:
      return 0;
    case 8:
    case 10:
      return 1;
    case 12:
      return 2;
    default:
      throw new Error(
        `No preregistered sign-test exceedance rank for N=${sampleCount}`,
      );
  }
}
