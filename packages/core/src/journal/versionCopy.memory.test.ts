/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  ageOutIdleCode,
  FLATNESS_BOUND_BYTES,
  IN_FLIGHT_BOUND_BYTES,
  measureCompaction,
  RETAINED_BOUND_BYTES,
  warmCompaction,
  sessionWithCheckpoints,
  type CompactionMeasurement,
} from './__tests__/support/compactionMemory.js';
import type { JournalStore } from './journalStore.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const SMALL = 10;
const MEDIUM = 100;
/**
 * The warm-up copy is as large as the middle case. A copy that is hot enough
 * to be compiled by the optimising tiers leaves that code on the heap, which
 * is a one-time cost and not growth with the count, so it must be in every
 * baseline and not only in the first copy that gets hot.
 */
const WARMUP = MEDIUM;
/**
 * The largest count. The copy's time grows with the checkpoints times the
 * depth of the state map (see the phase 2d notes), so 400 checkpoints, 40
 * times the smallest case, keep this file under two minutes on a loaded
 * machine.
 */
const LARGE = 400;

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
    const source = await sessionWithCheckpoints(
      path.join(directory(), `source-${label}.llxj`),
      checkpoints,
    );
    open.push(source);
    return source;
  }

  function compact(
    source: JournalStore,
    checkpoints: number,
  ): Promise<CompactionMeasurement> {
    return measureCompaction(
      source,
      path.join(directory(), `compacted-${checkpoints}.llxj`),
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
    const small = await compact(sources.small, SMALL);
    const medium = await compact(sources.medium, MEDIUM);
    const large = await compact(sources.large, LARGE);

    expect(warm.versions).toHaveLength(WARMUP + 1);
    expect(small.versions).toBe(SMALL + 1);
    expect(medium.versions).toBe(MEDIUM + 1);
    expect(large.versions).toBe(LARGE + 1);
    expect(large.rows).toBeGreaterThan(medium.rows * 3);
    expect(small.samples).toBeGreaterThanOrEqual(5);
    expect(large.samples).toBeGreaterThanOrEqual(10);

    const measurements = [small, medium, large];

    // (i) Retained: what is still held after the copy, which must not grow with the count.
    const retained = measurements.map((m) => m.finalGrowth);
    expect(
      retained.filter((growth) => growth >= RETAINED_BOUND_BYTES),
    ).toStrictEqual([]);
    // The received object lists the three growths (10, 100, 400) when the spread fails.
    expect({ retained, spread: spreadOf(retained) }).toSatisfy(
      (reading: { spread: number }) => reading.spread < FLATNESS_BOUND_BYTES,
    );

    // (ii) In flight: what the copy holds while it runs. The node caches fill
    // to their caps as the count grows, which is a one-time rise that stops
    // once they are full (the smallest copy never fills them), so the
    // flatness is read between the two counts that do.
    const inFlight = measurements.map((m) => m.settledGrowth);
    expect(
      inFlight.filter((growth) => growth >= IN_FLIGHT_BOUND_BYTES),
    ).toStrictEqual([]);
    expect({
      inFlight,
      difference: large.settledGrowth - medium.settledGrowth,
    }).toSatisfy(
      (reading: { difference: number }) =>
        reading.difference < FLATNESS_BOUND_BYTES,
    );
  }, 150_000);
});
