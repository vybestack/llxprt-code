/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  fallbackHarness,
  enforceFallback,
  withFallbackFixture,
  fallbackCandidate,
} from './provider-fallback-disk-helpers.js';
import { installFixtureCandidate } from './provider-fallback-candidate-fixture.js';
import { digestRows } from './tool-truncation-stream-helpers.js';

class InvariantReceipt extends DebugLogger {
  readonly failures: Error[] = [];
  override warn(
    _message: string | (() => string),
    ...details: unknown[]
  ): void {
    for (const detail of details)
      if (detail instanceof Error) this.failures.push(detail);
  }
}
describe('provider disk callback invariants', () => {
  it.each(['missing', 'duplicate'])(
    'reports %s publication as failure and retains the original state',
    async (failure) => {
      await withFallbackFixture(512, async ({ history, before }) => {
        const logger = new InvariantReceipt('test:disk-invariant');
        const harness = fallbackHarness(
          history,
          async (_prompt, install) => {
            if (failure === 'duplicate') {
              await installFixtureCandidate(install, [fallbackCandidate()]);
              await installFixtureCandidate(install, [fallbackCandidate()]);
            }
            return true;
          },
          { logger },
        );
        await expect(enforceFallback(harness)).rejects.toThrow(
          failure === 'missing'
            ? 'Fallback compression succeeded without providing candidate history'
            : 'Fallback candidate may only be installed once',
        );
        expect(logger.failures.map((error) => error.message)).toContain(
          failure === 'missing'
            ? 'Fallback compression succeeded without providing candidate history'
            : 'Fallback candidate may only be installed once',
        );
        expect(await digestRows(history.streamRawHistory())).toBe(before);
        expect(harness.baseline()).toBe(123);
        expect(history.getCacheAnchorSeq()).toBe(1);
      });
    },
  );
});
