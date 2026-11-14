/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { measure } from './__tests__/support/semantic-purge-memory-test-helpers.js';

describe('semantic purge actual owner census', () => {
  for (const size of [512, 8192]) {
    it(`bounds active ${size}-row owners at 440 and their serialized charge at 8 MiB`, () => {
      const result = measure(size, false);
      expect(result.heldRows).toBeGreaterThan(0);
      expect(result.heldBytes).toBeGreaterThan(0);
      expect(result.peakRows).toBeLessThanOrEqual(440);
      expect(result.peakBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    }, 120_000);
  }
  it('counts every retained row and original marker in the 8192-row trap', () => {
    const result = measure(8192, true);
    expect(result.heldRows).toBeGreaterThanOrEqual(2 * result.size);
    expect(result.heldRows).toBeGreaterThan(440);
    expect(result.heldBytes).toBeGreaterThan(8 * 1024 * 1024);
  }, 120_000);
});
