/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { median } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  ageOutIdleCode,
  FLATNESS_BOUND_BYTES,
  IN_FLIGHT_BOUND_BYTES,
  measureCompaction,
  RETAINED_BOUND_BYTES,
  warmCompaction,
  isolatedSessionWithCheckpoints,
  type CompactionMeasurement,
} from './__tests__/support/compactionMemory.js';
import type { JournalStore } from './journalStore.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const SMALL = 10;
const MEDIUM = 100;
/**
 * The largest count. The copy's time grows with the checkpoints times the
 * depth of the state map (see the phase 2d notes), so 400 checkpoints, 40
 * times the smallest case, keep this file under two minutes on a loaded
 * machine.
 */
const LARGE = 400;
/** Exercise the largest copy's optimizing tiers before every measured size. */
const WARMUP = LARGE;
const PAIRED_SAMPLES = 5;

function spreadOf(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe('compaction copy memory with growing checkpoint counts (design 13.6)', () => {
  const directory = useTempDir('journal-compaction-memory-');

  const open: JournalStore[] = [];

  afterEach(async () => {
    await Promise.all(open.splice(0).map((store) => store.close()));
  });

  /** A source with `checkpoints` checkpoints; every source is built before the first measured copy. */
  async function build(
    checkpoints: number,
    label: string,
  ): Promise<JournalStore> {
    const source = await isolatedSessionWithCheckpoints(
      path.join(directory(), `source-${label}.llxj`),
      checkpoints,
    );
    open.push(source);
    return source;
  }

  function compact(
    source: JournalStore,
    checkpoints: number,
    sample: number,
  ): Promise<CompactionMeasurement> {
    return measureCompaction(
      source,
      path.join(directory(), `compacted-${sample}-${checkpoints}.llxj`),
    );
  }

  it('retains nothing that grows with the checkpoints, and holds a bounded amount while it runs', async () => {
    // A first copy pays the one-time costs (lazy initialisation, compiled code), which are not growth with the count.
    const sources = {
      warm: await build(WARMUP, 'warm'),
      small: await build(SMALL, 'small'),
      medium: await build(MEDIUM, 'medium'),
      large: await build(LARGE, 'large'),
    };
    await ageOutIdleCode();
    // Compiled code is not growth with the count: the copy's own code is
    // compiled again here, after the old code is gone, so every baseline holds it.
    const warm = await warmCompaction(
      sources.warm,
      path.join(directory(), 'compacted-warm.llxj'),
    );
    expect(warm.versions).toHaveLength(WARMUP + 1);

    const retained: number[][] = [];
    const inFlight: number[][] = [];
    for (let sample = 0; sample < PAIRED_SAMPLES; sample++) {
      const small = await compact(sources.small, SMALL, sample);
      const medium = await compact(sources.medium, MEDIUM, sample);
      const large = await compact(sources.large, LARGE, sample);

      expect(small.versions).toBe(SMALL + 1);
      expect(medium.versions).toBe(MEDIUM + 1);
      expect(large.versions).toBe(LARGE + 1);
      expect(large.rows).toBeGreaterThan(medium.rows * 3);
      expect(small.samples).toBeGreaterThanOrEqual(5);
      expect(large.samples).toBeGreaterThanOrEqual(10);

      const measurements = [small, medium, large];
      retained.push(measurements.map((m) => m.finalGrowth));
      inFlight.push(measurements.map((m) => m.settledGrowth));
    }

    // Pair the counts within each run before taking medians: isolated JSC
    // heap excursions survive settled readings, but persistent retention
    // appears in every pair. Keep negative deltas and every sample.
    const retainedMedians = [0, 1, 2].map((index) =>
      median(retained.map((sample) => sample[index])),
    );
    expect(
      retainedMedians.filter((growth) => growth >= RETAINED_BOUND_BYTES),
    ).toStrictEqual([]);
    expect({ retained, spread: median(retained.map(spreadOf)) }).toSatisfy(
      (reading: { spread: number }) => reading.spread < FLATNESS_BOUND_BYTES,
    );

    // Cache caps account for the initial in-flight rise. Compare the two
    // counts that fill them, using the median of their paired differences.
    const inFlightMedians = [0, 1, 2].map((index) =>
      median(inFlight.map((sample) => sample[index])),
    );
    expect(
      inFlightMedians.filter((growth) => growth >= IN_FLIGHT_BOUND_BYTES),
    ).toStrictEqual([]);
    expect({
      inFlight,
      difference: median(inFlight.map((sample) => sample[2] - sample[1])),
    }).toSatisfy(
      (reading: { difference: number }) =>
        reading.difference < FLATNESS_BOUND_BYTES,
    );
  }, 180_000);
});
