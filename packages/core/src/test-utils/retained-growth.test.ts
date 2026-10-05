/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  pairedSignToleratedExceedances,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
} from './retained-growth.js';

const ALLOWANCE = RETAINED_ALLOWANCE_BYTES;

function heapDeltas(bytes: number[]): PairedDelta[] {
  return bytes.map((value) => ({ heap: value, external: value }));
}

function splitDeltas(
  heapBytes: number[],
  externalBytes: number[],
): PairedDelta[] {
  return heapBytes.map((heap, index) => ({
    heap,
    external: externalBytes[index],
  }));
}

describe('paired sign-test tolerated exceedances', () => {
  it('follows the preregistered protocol table', () => {
    expect(() => pairedSignToleratedExceedances(4)).toThrow(
      'No preregistered sign-test exceedance rank for N=4',
    );
    expect(pairedSignToleratedExceedances(5)).toStrictEqual(0);
    expect(pairedSignToleratedExceedances(6)).toStrictEqual(0);
    expect(pairedSignToleratedExceedances(8)).toStrictEqual(1);
    expect(pairedSignToleratedExceedances(10)).toStrictEqual(1);
    expect(pairedSignToleratedExceedances(12)).toStrictEqual(2);
    expect(() => pairedSignToleratedExceedances(7)).toThrow(
      'No preregistered sign-test exceedance rank for N=7',
    );
    expect(() => pairedSignToleratedExceedances(0)).toThrow(
      'No preregistered sign-test exceedance rank for N=0',
    );
  });
});

describe('paired estimator synthetic cases (a)-(d)', () => {
  it('case (a): detects real growth at the allowance with all-positive tight deltas', () => {
    const estimate = pairedEstimate(heapDeltas(Array(6).fill(1_048_577)));
    expect(estimate.median.heap).toStrictEqual(1_048_577);
    expect(estimate.bound.heap).toStrictEqual(1_048_577);
    expect(estimate.pass).toBe(false);
  });

  it('case (b): accepts one-sided negative growth', () => {
    const estimate = pairedEstimate(heapDeltas(Array(6).fill(-3_000_000)));
    expect(estimate.median.heap).toStrictEqual(-3_000_000);
    expect(estimate.bound.heap).toStrictEqual(-3_000_000);
    expect(estimate.pass).toBe(true);
  });

  it('case (c): a single over-allowance outlier refuses certification', () => {
    const bytes = [-447_957, -476_534, -709_602, 15_382, -300_000, 2_097_152];
    const estimate = pairedEstimate(heapDeltas(bytes));
    expect(estimate.median.heap).toBe(-373_978.5);
    expect(estimate.bound.heap).toBe(2_097_152);
    expect(estimate.bound.external).toBe(2_097_152);
    expect(estimate.pass).toBe(false);
  });

  it('case (d): ambiguous edge with bound beyond allowance refuses certification', () => {
    const bytes = [
      1_048_576, 1_048_576, 15_382, -1_048_576, 1_500_000, 2_097_152,
    ];
    const estimate = pairedEstimate(heapDeltas(bytes));
    expect(estimate.median.heap).toStrictEqual(1_048_576);
    expect(estimate.bound.heap).toBe(2_097_152);
    expect(estimate.pass).toBe(false);
  });
});

describe('paired estimator bound ranks per N', () => {
  it('N=6: one exceedance above allowance refuses certification', () => {
    const overLimit = heapDeltas([
      -1_048_576, -524_288, 0, 524_288, 1_048_576, 2_097_152,
    ]);
    const estimate = pairedEstimate(overLimit);
    expect(estimate.bound.heap).toBe(2_097_152);
    expect(estimate.pass).toBe(false);
  });

  it('N=6: two deltas above allowance refuse', () => {
    const refused = heapDeltas([
      -1_048_576, -524_288, 15_382, 524_288, 1_048_577, 2_097_152,
    ]);
    expect(pairedEstimate(refused).pass).toBe(false);
  });
});

describe('paired estimator bound ranks per N, mid samples', () => {
  it('N=4: no finite 95% upper median bound is supported', () => {
    expect(() => pairedEstimate(heapDeltas(Array(4).fill(1_048_577)))).toThrow(
      'No preregistered sign-test exceedance rank for N=4',
    );
    const edge = heapDeltas([-1_048_576, -1_000, -1, 1_048_576]);
    expect(() => pairedEstimate(edge)).toThrow(
      'No preregistered sign-test exceedance rank for N=4',
    );
  });

  it('N=5: bound is the maximum delta', () => {
    expect(pairedEstimate(heapDeltas(Array(5).fill(1_048_577))).pass).toBe(
      false,
    );
  });

  it('N=5: settled deltas inside the allowance pass', () => {
    const settled = heapDeltas([-3_000_000, -524_288, 0, 15_382, 1_048_576]);
    expect(pairedEstimate(settled).pass).toBe(true);
  });

  it('N=8: exactly one delta above allowance tolerated', () => {
    const settled = heapDeltas([
      -3_000_000, -524_288, 0, 15_382, 15_382, 524_288, 1_048_576, 2_097_152,
    ]);
    const estimate = pairedEstimate(settled);
    expect(estimate.bound.heap).toBeLessThanOrEqual(ALLOWANCE);
    expect(estimate.pass).toBe(true);
  });

  it('N=8: two deltas above allowance refuse', () => {
    const refused = heapDeltas([
      -3_000_000, -524_288, 0, 15_382, 15_382, 524_288, 1_048_577, 2_097_152,
    ]);
    expect(pairedEstimate(refused).pass).toBe(false);
  });
});

describe('paired estimator bound ranks per N, large samples', () => {
  it('N=10: two deltas above allowance refuse; exactly one tolerated', () => {
    const twoAbove = heapDeltas([
      -3_000_000, -524_288, 0, 15_382, 15_382, 524_288, 1_048_576, 1_048_577,
      2_097_152, 2_097_152,
    ]);
    const estimate = pairedEstimate(twoAbove);
    expect(estimate.bound.heap).toBeGreaterThan(ALLOWANCE);
    expect(estimate.pass).toBe(false);

    const oneAbove = heapDeltas([
      -3_000_000, -524_288, 0, 15_382, 15_382, 524_288, 1_048_576, 1_048_576,
      1_048_576, 2_097_152,
    ]);
    const tolerated = pairedEstimate(oneAbove);
    expect(tolerated.bound.heap).toBeLessThanOrEqual(ALLOWANCE);
    expect(tolerated.pass).toBe(true);
  });

  it('N=12: two deltas above allowance tolerated; three refuse', () => {
    const tolerated = heapDeltas([
      -3_000_000, -1_048_576, -524_288, 0, 15_382, 15_382, 15_382, 524_288,
      524_288, 1_048_576, 2_097_152, 2_097_152,
    ]);
    const estimate = pairedEstimate(tolerated);
    expect(estimate.bound.heap).toBeLessThanOrEqual(ALLOWANCE);
    expect(estimate.pass).toBe(true);

    const refused = heapDeltas([
      -3_000_000, -1_048_576, -524_288, 0, 15_382, 15_382, 524_288, 524_288,
      1_048_577, 1_500_000, 2_097_152, 3_000_000,
    ]);
    expect(pairedEstimate(refused).pass).toBe(false);
  });
});

describe('paired estimator misc', () => {
  it('zero deltas count toward the bound but not as growth', () => {
    const estimate = pairedEstimate(heapDeltas(Array(6).fill(0)));
    expect(estimate.median.heap).toStrictEqual(0);
    expect(estimate.bound.heap).toStrictEqual(0);
    expect(estimate.pass).toBe(true);
  });

  it('empty delta sets fail closed', () => {
    expect(() => pairedEstimate([])).toThrow(
      'Paired estimator requires at least one delta',
    );
  });

  it('heap and external counters are each judged against the allowance', () => {
    const zero = Array(6).fill(0);
    const overLimit = [-3, -2, -1, 0, ALLOWANCE, ALLOWANCE + 1];
    const withinLimit = [-3, -2, -1, 0, ALLOWANCE, ALLOWANCE];
    const boundaryRefusal = pairedEstimate(heapDeltas(overLimit));
    expect(boundaryRefusal.bound.heap).toBe(ALLOWANCE + 1);
    expect(boundaryRefusal.pass).toBe(false);
    const boundaryAcceptance = pairedEstimate(heapDeltas(withinLimit));
    expect(boundaryAcceptance.bound.heap).toBe(ALLOWANCE);
    expect(boundaryAcceptance.pass).toBe(true);

    const externalOnly = pairedEstimate(splitDeltas(zero, overLimit));
    expect(externalOnly.median.heap).toBe(0);
    expect(externalOnly.bound.heap).toBe(0);
    expect(externalOnly.bound.external).toBe(ALLOWANCE + 1);
    expect(externalOnly.pass).toBe(false);

    const heapOnly = pairedEstimate(splitDeltas(overLimit, zero));
    expect(heapOnly.bound.heap).toBe(ALLOWANCE + 1);
    expect(heapOnly.bound.external).toBe(0);
    expect(heapOnly.pass).toBe(false);
    expect(pairedEstimate(splitDeltas(zero, zero)).pass).toBe(true);

    const heapGrowth = splitDeltas(
      [-1_000, -1_000, -1_000, 0, 1_048_577, 2_097_152],
      Array(6).fill(-1_000),
    );
    const heapRefused = pairedEstimate(heapGrowth);
    expect(heapRefused.bound.heap).toBe(2_097_152);
    expect(heapRefused.pass).toBe(false);

    const externalRefused = splitDeltas(
      Array(6).fill(-1_000),
      [-1_000, -1_000, -1_000, 0, 1_048_577, 2_097_152],
    );
    const refused = pairedEstimate(externalRefused);
    expect(refused.bound.external).toBe(2_097_152);
    expect(refused.pass).toBe(false);
  });
});
