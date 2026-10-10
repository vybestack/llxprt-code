/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import type { FallbackTransactionDeps } from '../providerFallbackTransaction.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  withFallbackFixture,
  enforceFallback,
  type FallbackHarness,
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
interface RetryHandlerInternals {
  lastPromptTokenCount: number | null;
  performProviderDiskFallback: FallbackTransactionDeps['performFallbackCompression'];
}
function harnessFor(history: HistoryService, state: State): FallbackHarness {
  const { runtime, transport, handler } = middleoutSetup(
    history,
    undefined,
    undefined,
    { contextLimit: 200000 },
  );
  const logger = new DebugLogger('test:disk-provider-retry');
  const internals = handler as unknown as RetryHandlerInternals;
  internals.lastPromptTokenCount = state.baseline;
  vi.spyOn(handler, 'ensureDensityOptimized').mockImplementation(async () => {
    state.events.push('optimize');
  });
  vi.spyOn(handler, 'performCompression').mockImplementation(async () => {
    state.events.push('primary');
    return PerformCompressionResult.COMPRESSED;
  });
  internals.performProviderDiskFallback = async (
    prompt,
    install,
    targetTokenCount,
  ) => {
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
  };
  return {
    handler,
    history,
    estimate: async () => {
      if (state.stop) throw new Error('stop after restored first rejection');
      return state.accepted ? 1 : 190000;
    },
    openSelection: (realOpen) => realOpen(),
    baseline: () => internals.lastPromptTokenCount,
  };
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
    const harness = harnessFor(history, state);
    const tokens = history.getTotalTokens();
    await expect(enforceFallback(harness)).rejects.toThrow(
      'post-truncation stage',
    );
    expect(await digestRows(history.streamRawHistory())).toBe(before);
    expect(history.getTotalTokens() - tokens).toBe(0);
    expect(harness.baseline()).toBe(123);
    state.stop = false;
    expect(await enforceFallback(harness)).not.toHaveLength(0);
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
    expect(harness.baseline()).toBe(null);
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
