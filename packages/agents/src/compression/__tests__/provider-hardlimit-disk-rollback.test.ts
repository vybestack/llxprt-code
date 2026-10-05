/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runDiskProviderFallback } from '../diskProviderFallback.js';
import {
  withFallbackFixture,
  fallbackHarness,
  enforceFallback,
} from './provider-fallback-disk-helpers.js';
import { middleoutSetup } from './middleout-disk-helpers.js';
import { digestRows } from './tool-truncation-stream-helpers.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const cases = [512, 8192].flatMap((size) =>
  ['throw', 'false', 'baseline', 'partial', 'cancel'].map((failure) => ({
    size,
    failure,
  })),
);
describe('actual disk provider candidate compensation', () => {
  it.each(cases)(
    'restores $size rows after $failure using the invoked disk runner',
    async ({ size, failure }) => {
      await withFallbackFixture(
        size,
        async ({ history, recorder, before, owners, reads }) => {
          const { runtime, transport } = middleoutSetup(history);
          const tokens = history.getTotalTokens();
          let installed = false;
          const harness = fallbackHarness(
            history,
            async (promptId, install, targetTokenCount) => {
              if (failure === 'partial') recorder.failAdmissionAfter(1);
              const result = await runDiskProviderFallback(
                async (candidate) => {
                  await install(candidate);
                  installed = true;
                },
                promptId,
                runtime,
                history,
                async () => ({
                  provider: transport,
                  runtime: runtime.providerRuntime,
                }),
                undefined,
                undefined,
                new DebugLogger('test:provider-hardlimit-rollback'),
                { targetTokenCount },
              );
              if (failure === 'throw')
                throw new Error('provider rejected installed disk candidate');
              if (failure === 'cancel') {
                const controller = new AbortController();
                controller.abort(
                  new Error('cancelled installed disk candidate'),
                );
                controller.signal.throwIfAborted();
              }
              return failure !== 'false' && result.outcome === 'applied';
            },
            { resetFails: failure === 'baseline' },
          );
          await expect(enforceFallback(harness.enforcer)).rejects.toThrow(
            'post-truncation stage',
          );
          expect(installed).toBe(
            failure !== 'partial' && failure !== 'baseline',
          );
          expect(await digestRows(history.streamRawHistory())).toBe(before);
          expect(history.getTotalTokens() - tokens).toBe(0);
          expect(history.getBaseTokenOffset()).toBe(37);
          expect(history.getCacheAnchorSeq()).toBe(1);
          expect(harness.baseline()).toBe(123);
          expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(440);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    },
    180000,
  );
});
