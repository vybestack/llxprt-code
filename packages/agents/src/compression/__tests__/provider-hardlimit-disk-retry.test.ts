/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ProviderContentEnforcer } from '../providerContentEnforcement.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  withFallbackFixture,
  enforceFallback,
} from './provider-fallback-disk-helpers.js';
import { middleoutSetup } from './middleout-disk-helpers.js';
import { runDiskProviderFallback } from '../diskProviderFallback.js';
import { digestRows } from './tool-truncation-stream-helpers.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
interface State {
  accepted: boolean;
  rejectNext: boolean;
  stop: boolean;
  baseline: number | null;
  events: string[];
}
function enforcerFor(
  history: HistoryService,
  state: State,
): ProviderContentEnforcer {
  const { runtime, transport } = middleoutSetup(history, undefined, undefined, {
    contextLimit: 200000,
  });
  const logger = new DebugLogger('test:disk-provider-retry');
  return new ProviderContentEnforcer({
    historyService: history,
    runtimeContext: runtime,
    generationConfig: {},
    providerRuntimeNullable: undefined,
    logger,
    ensureDensityOptimized: async () => {
      state.events.push('optimize');
    },
    performCompression: async () => {
      state.events.push('primary');
      return PerformCompressionResult.COMPRESSED;
    },
    performFallbackCompression: async (prompt, install, targetTokenCount) => {
      state.events.push('fallback');
      const result = await runDiskProviderFallback(
        install,
        prompt,
        runtime,
        history,
        async () => ({ provider: transport, runtime: runtime.providerRuntime }),
        undefined,
        undefined,
        logger,
        { targetTokenCount },
      );
      if (state.rejectNext) {
        state.rejectNext = false;
        state.stop = true;
        state.events.push('reject');
        throw new Error('provider rejected first installed candidate');
      }
      state.accepted = result.outcome === 'applied';
      state.events.push('accept');
      return state.accepted;
    },
    getPromptTokenBaseline: () => state.baseline,
    resetPromptTokenBaseline: () => {
      state.baseline = 0;
    },
    restorePromptTokenBaseline: (value) => {
      state.baseline = value;
    },
    estimateFinalizedPromptTokens: async () => {
      if (state.stop) throw new Error('stop after restored first rejection');
      return state.accepted ? 1 : 190000;
    },
  });
}
async function retry(size: number): Promise<number> {
  let remaining = 0;
  await withFallbackFixture(size, async ({ history, before }) => {
    const state: State = {
      accepted: false,
      rejectNext: true,
      stop: false,
      baseline: 123,
      events: [],
    };
    const enforcer = enforcerFor(history, state);
    const tokens = history.getTotalTokens();
    await expect(enforceFallback(enforcer)).rejects.toThrow(
      'post-truncation stage',
    );
    expect(await digestRows(history.streamRawHistory())).toBe(before);
    expect(history.getTotalTokens() - tokens).toBe(0);
    expect(state.baseline).toBe(123);
    state.stop = false;
    expect(await enforceFallback(enforcer)).not.toHaveLength(0);
    expect(state.events).toStrictEqual([
      'optimize',
      'primary',
      'primary',
      'fallback',
      'reject',
      'optimize',
      'primary',
      'primary',
      'fallback',
      'accept',
    ]);
    expect(state.baseline).toBe(0);
    expect(history.getTotalTokens() - history.getBaseTokenOffset()).toBe(
      await history.estimateTokensForContents(history.streamRawHistory()),
    );
    remaining = history.getTotalTokens();
  });
  return remaining;
}
describe('provider hard-limit disk retry ordering', () => {
  it.each([512, 8192])(
    'restores accounting after installed rejection before the next %i-row request retries the primary ladder',
    async (size) => {
      expect(await retry(size)).toBeGreaterThan(0);
    },
    180000,
  );
});
