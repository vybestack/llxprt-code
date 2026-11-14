/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { installFixtureCandidate } from './provider-fallback-candidate-fixture.js';
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  withFallbackFixture,
  fallbackHarness,
  fallbackCandidate,
  enforceFallback,
} from './provider-fallback-disk-helpers.js';

class FailureReceipt extends DebugLogger {
  readonly failures: Error[] = [];
  override warn(
    _message: string | (() => string),
    ...details: unknown[]
  ): void {
    for (const detail of details)
      if (detail instanceof Error) this.failures.push(detail);
  }
}

describe('provider fallback rejection diagnostics', () => {
  it('reports both provider rejection and failed compensation without resetting the baseline', async () => {
    await withFallbackFixture(
      512,
      async ({ history, recorder, failCompensation, owners, reads }) => {
        const logger = new FailureReceipt('test:fallback-receipt');
        const rejection = new Error('provider bookkeeping rejected');
        const harness = fallbackHarness(
          history,
          async (_prompt, install) => {
            await installFixtureCandidate(install, [fallbackCandidate()]);
            await failCompensation();
            throw rejection;
          },
          { logger },
        );
        const rollback = await enforceFallback(harness).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(rollback).toBeInstanceOf(AggregateError);
        if (!(rollback instanceof AggregateError))
          throw new Error('Missing fallback rollback aggregate');
        expect(rollback.message).toBe(
          'Provider truncation fallback failed and its state rollback also failed',
        );
        expect(rollback.errors).toStrictEqual([rejection, recorder.failure]);
        expect(harness.baseline()).toBeNull();
        const blocks: unknown[] = [];
        for await (const row of history.streamRawHistory())
          blocks.push(row.blocks);
        expect(blocks).toStrictEqual([fallbackCandidate().blocks]);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(owners.snapshot().liveSerializedBytes).toBe(0);
        expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(440);
      },
    );
  });
});
