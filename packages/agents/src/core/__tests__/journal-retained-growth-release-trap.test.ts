/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RETAINED_ALLOWANCE_BYTES } from './support/journal-retained-growth-predicate.js';
import { evaluateRetainedSizes } from './support/journal-retained-size-predicate.js';
import { RELEASE_AFTER_CHECKPOINTS } from './support/journal-retained-growth-plan.js';
import {
  WORKER_TEST_TIMEOUT_MS,
  expectRealWorkload,
  report,
  runWorker,
} from './support/journal-retained-growth-harness.js';

describe('retained growth trap: context held between compressions then released', () => {
  it(
    'context retained between compressions and released before the last checkpoint fails',
    async () => {
      const result = await runWorker('release-trap');
      process.stdout.write(`${report(result)}\n`);
      expectRealWorkload(result);
      // Retention was switched off and its rows dropped after
      // RELEASE_AFTER_CHECKPOINTS checkpoints, so nothing is held when the run
      // ends.
      expect(result.retainedRows).toBe(0);
      const verdict = evaluateRetainedSizes(
        result.baseline,
        result.checkpoints,
      );
      // The rows really were let go: the last checkpoint holds under 5% of the
      // peak. It is not zero because the settled heap keeps a little bounded
      // state the baseline did not have. The trap's warm-up (see
      // TRAP_WARMUP_TURNS in the worker) runs past the measurement cache fill
      // so that residue stays far under the allowance; the final delta is
      // checked against the allowance below. A gate that looked only at the
      // final heap would see none of the rows held up to checkpoint 3; only the
      // per-checkpoint gate catches them.
      const peak = Math.max(...verdict.checkpointDeltas);
      expect(peak).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES * 10);
      expect(verdict.retainedBytes).toBeLessThan(peak * 0.05);
      expect(verdict.retainedBytes).toBeLessThan(RETAINED_ALLOWANCE_BYTES / 2);
      expect(
        verdict.checkpointDeltas
          .slice(0, RELEASE_AFTER_CHECKPOINTS)
          .some((delta) => delta >= RETAINED_ALLOWANCE_BYTES),
      ).toBe(true);
      expect(
        verdict.failures.some((failure) =>
          failure.includes('exceeds allowance'),
        ),
      ).toBe(true);
      expect(verdict.pass).toBe(false);
    },
    WORKER_TEST_TIMEOUT_MS,
  );
});
