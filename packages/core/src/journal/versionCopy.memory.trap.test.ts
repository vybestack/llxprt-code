/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  ageOutIdleCode,
  IN_FLIGHT_BOUND_BYTES,
  measureCompaction,
  PerVersionBuilders,
  RETAINED_BOUND_BYTES,
  isolatedSessionWithCheckpoints,
  warmCompaction,
} from './__tests__/support/compactionMemory.js';
import type { JournalStore } from './journalStore.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const TRAPPED = 100;

describe('compaction copy memory trap (design 13.6)', () => {
  const directory = useTempDir('journal-compaction-trap-');

  const open: JournalStore[] = [];

  afterEach(async () => {
    await Promise.all(open.splice(0).map((store) => store.close()));
  });

  it('a copy that keeps the state of every version in memory exceeds the bounds of both checks', async () => {
    const warm = await isolatedSessionWithCheckpoints(
      path.join(directory(), 'source-warm.llxj'),
      TRAPPED,
    );
    const source = await isolatedSessionWithCheckpoints(
      path.join(directory(), 'source-trap.llxj'),
      TRAPPED,
    );
    open.push(warm, source);
    const trap = new PerVersionBuilders(source);
    await ageOutIdleCode();
    // As in the compaction test: compiled code from a hot copy is in the baseline, so it is not mistaken for what the trap holds.
    await warmCompaction(warm, path.join(directory(), 'compacted-warm.llxj'));
    const trapped = await measureCompaction(
      source,
      path.join(directory(), 'compacted-trap.llxj'),
      trap,
    );
    expect(trapped.held).toBe(TRAPPED + 1);
    // (i) retained: the trap is still held after the copy.
    expect(trapped.finalGrowth).toBeGreaterThan(RETAINED_BOUND_BYTES);
    // (ii) in flight: and it was held through the second half of the copy.
    expect(trapped.settledGrowth).toBeGreaterThan(IN_FLIGHT_BOUND_BYTES);
  }, 150_000);
});
