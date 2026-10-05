/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mediaParticipant } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  withFallbackFixture,
  fallbackHarness,
  enforceFallback,
} from './provider-fallback-disk-helpers.js';
import { middleoutSetup } from './middleout-disk-helpers.js';
import { runDiskProviderFallback } from '../diskProviderFallback.js';
import { digestRows } from './tool-truncation-stream-helpers.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve: () => resolve() };
}
async function paused(size: number): Promise<number> {
  let live = 0;
  await withFallbackFixture(
    size,
    async ({ history, owners, reads, before }) => {
      const ready = deferred();
      const gate = deferred();
      let rejecting = true;
      history.registerMediaOwner(
        mediaParticipant((input) => ({
          rollback: () => {},
          publish: async () => {
            if (!rejecting) return;
            for (const _row of input.next) {
              ready.resolve();
              await gate.promise;
              throw new Error('paused provider publication rejected');
            }
          },
        })),
      );
      const { runtime, transport } = middleoutSetup(history);
      const harness = fallbackHarness(
        history,
        async (prompt, install, targetTokenCount) => {
          const result = await runDiskProviderFallback(
            install,
            prompt,
            runtime,
            history,
            async () => ({
              provider: transport,
              runtime: runtime.providerRuntime,
            }),
            undefined,
            undefined,
            new DebugLogger('test:disk-owners'),
            { targetTokenCount },
          );
          return result.outcome === 'applied';
        },
      );
      const operation = enforceFallback(harness.enforcer).catch(
        (error: unknown) => error,
      );
      await ready.promise;
      try {
        live = owners.snapshot().liveRows;
        expect(live).toBeGreaterThan(0);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(440);
      } finally {
        gate.resolve();
      }
      expect(await operation).toBeInstanceOf(Error);
      expect(await digestRows(history.streamRawHistory())).toBe(before);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(harness.baseline()).toBe(123);
      rejecting = false;
    },
  );
  return live;
}
describe('actual provider disk transaction owners', () => {
  it.each([512, 8192])(
    'keeps paused %i-row installation within the original owner gate and compensates',
    async (size) => {
      expect(await paused(size)).toBeGreaterThan(0);
    },
    180000,
  );
});
