/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import {
  withRollbackFixture,
  rollbackRow,
} from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { collectRawHistory } from '../../../../core/src/test-utils/collect-raw-history.js';
import {
  fallbackHarness,
  enforceFallback,
} from './provider-fallback-disk-helpers.js';
import { middleoutSetup } from './middleout-disk-helpers.js';
import { runDiskProviderFallback } from '../diskProviderFallback.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
const { gcAndSweep }: { gcAndSweep: () => void } = createRequire(
  import.meta.url,
)('bun:jsc');

describe('actual disk provider pending identities', () => {
  it('compensates rejected installed rows with a paused writer after chronology replacement and GC', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const callers = Array.from({ length: 4 }, (_, index) =>
        rollbackRow(index),
      );
      await history.addBatch(callers);
      const markers = callers.map((row) => row.metadata?.chronology);
      history.setCacheAnchorSeq(1);
      const tokens = history.getTotalTokens();
      const { runtime, transport } = middleoutSetup(history);
      const harness = fallbackHarness(
        history,
        async (prompt, install, targetTokenCount) => {
          await runDiskProviderFallback(
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
            new DebugLogger('test:pending-disk-fallback'),
            { targetTokenCount },
          );
          for (const row of callers)
            row.metadata = {
              ...row.metadata,
              chronology: { seq: 999, userTurn: 999, step: 0, recordedAt: 0 },
            };
          gcAndSweep();
          await new Promise<void>((resolve) => setImmediate(resolve));
          throw new Error('provider rejected installed pending candidate');
        },
      );
      await expect(enforceFallback(harness.enforcer)).rejects.toThrow(
        'post-truncation stage',
      );
      const restored = await collectRawHistory(history);
      expect(restored).toHaveLength(callers.length);
      for (let index = 0; index < callers.length; index++) {
        expect(restored[index]).toBe(callers[index]);
        expect(restored[index].metadata?.chronology).toBe(markers[index]);
      }
      expect(history.getTotalTokens() - tokens).toBe(0);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(harness.baseline()).toBe(123);
      releaseWriter();
      await recorder.flush();
      expect(await collectRawHistory(history)).toStrictEqual(callers);
    }, true);
  }, 10000);
});
