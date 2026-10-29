/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RETAINED_ALLOWANCE_BYTES } from './support/journal-retained-growth-predicate.js';
import { evaluateRetainedSizes } from './support/journal-retained-size-predicate.js';
import {
  WORKER_TEST_TIMEOUT_MS,
  expectRealWorkload,
  report,
  runWorker,
} from './support/journal-retained-growth-harness.js';

describe('retained growth trap: a request-row-keeping observer', () => {
  it(
    'a test-installed observer keeping every request row fails the same predicate',
    async () => {
      const result = await runWorker('trap');
      process.stdout.write(`${report(result)}\n`);
      expectRealWorkload(result);
      expect(result.retainedRows).toBeGreaterThan(400);
      const verdict = evaluateRetainedSizes(
        result.baseline,
        result.checkpoints,
      );
      expect(verdict.pass).toBe(false);
      // Fails both the per-checkpoint allowance and the two-size growth gate.
      expect(
        verdict.failures.some((failure) =>
          failure.includes('exceeds allowance'),
        ),
      ).toBe(true);
      expect(verdict.growthBytes).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
      expect(
        verdict.failures.some((failure) => failure.includes('heap grew')),
      ).toBe(true);
      expect(verdict.retainedBytes).toBeGreaterThanOrEqual(
        RETAINED_ALLOWANCE_BYTES,
      );
    },
    WORKER_TEST_TIMEOUT_MS,
  );
});
