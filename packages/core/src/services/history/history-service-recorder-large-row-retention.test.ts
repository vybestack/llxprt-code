/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { MIB } from './__tests__/support/service-large-row.js';
import {
  largeRowAccepted,
  useLargeRowProof,
} from './__tests__/support/service-large-row-proof.js';

describe('HistoryService large-row retention control', () => {
  const measureLargeRow = useLargeRowProof(40);
  it('rejects a reader retaining the 40 MiB context with the identical 1 MiB predicate', async () => {
    const result = await measureLargeRow(true);
    expect(result.retained).toHaveLength(1);
    expect(largeRowAccepted(result)).toBe(false);
    expect(Math.min(...result.growth)).toBeGreaterThan(MIB);
  }, 120_000);
});
