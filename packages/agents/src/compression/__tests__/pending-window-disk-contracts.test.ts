/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import {
  applyPendingWindowFallback,
  type PendingFallbackDeps,
} from '../pendingWindowFallback.js';
import { runDiskProviderFallback } from '../diskProviderFallback.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { collectRawHistory } from '../../../../core/src/test-utils/collect-raw-history.js';
import {
  withPendingFixture,
  pendingCaller,
  pendingGate,
  type PendingFixture,
} from './pending-window-disk-helpers.js';
import { digestRows } from './tool-truncation-stream-helpers.js';
const { gcAndSweep }: { gcAndSweep: () => void } = createRequire(
  import.meta.url,
)('bun:jsc');

export function pendingFallbackDeps(
  fixture: PendingFixture,
): PendingFallbackDeps {
  const { history, setup } = fixture;
  let baseline: number | null = 123;
  return {
    historyService: history,
    getRuntimeModel: () => 'test-model',
    getLastPromptTokenCount: () => baseline,
    resetLastPromptTokenCount: () => {
      baseline = null;
    },
    restoreLastPromptTokenCount: (value) => {
      baseline = value;
    },
    performFallbackCompression: async (prompt, install, targetTokenCount) => {
      const result = await runDiskProviderFallback(
        install,
        prompt,
        setup.runtime,
        history,
        async () => ({
          provider: setup.transport,
          runtime: setup.runtime.providerRuntime,
        }),
        undefined,
        undefined,
        new DebugLogger('test:pending-contract'),
        { targetTokenCount },
      );
      return result.outcome === 'applied';
    },
  };
}
async function digestDifference(
  history: PendingFixture['history'],
  before: string,
): Promise<number> {
  return Buffer.compare(
    Buffer.from(await digestRows(history.streamRawHistory())),
    Buffer.from(before),
  );
}
const failures = [
  'reject',
  'false',
  'cancel',
  'partial-admission',
  'duplicate',
  'missing',
] as const;
type Failure = (typeof failures)[number];
async function rollback(size: number, failure: Failure): Promise<number> {
  return withPendingFixture(size, async (fixture) => {
    const { history, recorder, owners, pauseWriter, releaseWriter } = fixture;
    pauseWriter();
    const callers = [pendingCaller(0), pendingCaller(1)];
    history.add(callers[0]);
    history.add(callers[1]);
    const markers = callers.map((row) => row.metadata?.chronology);
    const before = await digestRows(history.streamRawHistory());
    const tokens = history.getTotalTokens();
    const deps = pendingFallbackDeps(fixture);
    const fallback = deps.performFallbackCompression;
    const ready = pendingGate();
    const gate = pendingGate();
    deps.performFallbackCompression = async (prompt, install, target) => {
      if (failure === 'missing') return true;
      if (failure === 'partial-admission') recorder.failAdmissionAfter(1);
      const applied = await fallback(
        prompt,
        async (candidate) => {
          await install(candidate);
          ready.resolve();
          await gate.promise;
          if (failure === 'duplicate') await install(candidate);
        },
        target,
      );
      if (failure === 'false') return false;
      if (failure === 'reject' || failure === 'cancel') {
        for (const row of callers)
          row.metadata = {
            ...row.metadata,
            chronology: { seq: 999, userTurn: 999, step: 0, recordedAt: 0 },
          };
        gcAndSweep();
        if (failure === 'cancel')
          throw new DOMException('cancelled after installation', 'AbortError');
        throw new Error('pending candidate rejected');
      }
      return applied;
    };
    const operation = applyPendingWindowFallback(
      deps,
      'pending-contract',
      0,
    ).catch((error: unknown) => error);
    if (!['missing', 'partial-admission'].includes(failure)) {
      await ready.promise;
      expect(await collectRawHistory(history)).toStrictEqual(callers);
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      gate.resolve();
    }
    expect(await operation).toBeInstanceOf(Error);
    expect(await digestDifference(history, before)).toBe(0);
    const restored = await collectRawHistory(history);
    for (let index = 0; index < callers.length; index++) {
      expect(restored[restored.length + index - 2]).toBe(callers[index]);
      expect(restored[restored.length + index - 2]?.metadata?.chronology).toBe(
        markers[index],
      );
    }
    expect(history.getTotalTokens() - tokens).toBe(0);
    expect(history.getCacheAnchorSeq()).toBe(1);
    expect(deps.getLastPromptTokenCount()).toBe(123);
    releaseWriter();
    await recorder.flush();
    expect(owners.snapshot().liveRows).toBe(0);
    expect(await digestDifference(history, before)).toBe(0);
    return restored.length;
  });
}
describe('pending-window disk candidate contracts', () => {
  for (const failure of failures)
    it.each([512, 8192])(
      `compensates %i-row ${failure} with caller writer paused`,
      async (size) => {
        expect(await rollback(size, failure)).toBeGreaterThan(0);
      },
      180000,
    );
});
