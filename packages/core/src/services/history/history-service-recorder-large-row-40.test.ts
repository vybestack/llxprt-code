/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { MIB } from './__tests__/support/service-large-row.js';
import {
  largeRowAccepted,
  useLargeRowProof,
} from './__tests__/support/service-large-row-proof.js';

describe('HistoryService real-recorder 40 MiB row (defect 5)', () => {
  const measureLargeRow = useLargeRowProof(40);
  it('persists and freshly resumes the complete row without retained context', async () => {
    const result = await measureLargeRow();
    expect(result.bytes).toBe(40 * MIB);
    expect(result.growth).toHaveLength(3);
    expect(Math.min(result.admissionGrowth, ...result.growth)).toBeGreaterThan(
      -256 * 1024,
    );
    expect({
      admissionGrowth: result.admissionGrowth,
      growth: result.growth,
      accepted: largeRowAccepted(result),
    }).toMatchObject({ accepted: true });
  }, 120_000);
});
