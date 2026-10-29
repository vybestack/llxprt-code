/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import {
  transformProbes,
  transformPhaseSampler,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { runDiskProviderFallback } from '../../diskProviderFallback.js';
import {
  applyPendingWindowFallback,
  type PendingFallbackDeps,
} from '../../pendingWindowFallback.js';
import { publishProviderFallbackCandidate } from '../../providerFallbackCandidate.js';
import { middleoutSetup } from '../middleout-disk-helpers.js';
import { compressionValueDigest } from '../compression-value-fixture.js';
import {
  withNativeFallbackFixture,
  reachesGate,
  type NativeFallbackFixture,
} from './native-fallback-fixture.js';

async function* expectedRows(
  size: number,
  start = 0,
): AsyncGenerator<ReturnType<typeof suffixRow>> {
  for (let index = start; index < size; index++) yield suffixRow(index, 2048);
}

function pendingDeps(
  history: PendingFallbackDeps['historyService'],
  state: { baseline: number | null },
  failure?: Error,
): PendingFallbackDeps {
  const setup = middleoutSetup(history);
  return {
    historyService: history,
    getRuntimeModel: () => 'test',
    getLastPromptTokenCount: () => state.baseline,
    resetLastPromptTokenCount: () => {
      state.baseline = 0;
    },
    restoreLastPromptTokenCount: (value) => {
      state.baseline = value;
    },
    performFallbackCompression: async (prompt, install, targetTokenCount) => {
      const result = await runDiskProviderFallback(
        install,
        prompt,
        setup.runtime,
        undefined,
        history,
        async () => ({
          provider: setup.transport,
          runtime: setup.runtime.providerRuntime,
        }),
        undefined,
        undefined,
        new DebugLogger('test:native-pending-values'),
        { targetTokenCount },
      );
      if (failure !== undefined) throw failure;
      return result.outcome === 'applied';
    },
  };
}

async function observePhases(
  fixture: NativeFallbackFixture,
  operation: Promise<unknown>,
  sample: (phase: string) => Promise<void>,
  selected: Awaited<ReturnType<typeof compressionValueDigest>>,
  prior: ReturnType<NativeFallbackFixture['history']['streamRawHistory']>,
  paused: { readonly gate: Promise<void>; readonly phase: string },
): Promise<void> {
  const { owners } = fixture;
  try {
    await reachesGate(paused.gate, operation);
    await sample(paused.phase);
    expect(owners.snapshot().liveRows).toBeGreaterThan(0);
    await prior.return();
    fixture.releaseWriter();
    await reachesGate(fixture.acknowledged, operation);
    await sample('acknowledged');
    expect(owners.snapshot().liveRows).toBe(0);
    expect(await fixture.durable(false)).toStrictEqual(selected);
  } finally {
    await prior.return();
    fixture.releaseWriter();
    fixture.releaseFinalization();
  }
}

function startFallback(
  history: NativeFallbackFixture['history'],
  state: { baseline: number | null },
  rows: DetachedHistoryJournal,
  pending: boolean,
  failure: Error | undefined,
): Promise<unknown> {
  if (!pending)
    return rejectedValue(
      publishProviderFallbackCandidate(
        history,
        { rows, start: 0, hasPendingRows: true },
        'test',
      ),
    );
  return rejectedValue(
    applyPendingWindowFallback(
      pendingDeps(history, state, failure),
      'native-bounded-pending',
      0,
    ).then((applied) => {
      expect(applied).toBe(true);
    }),
  );
}

export async function nativeFallbackPhases(
  size: number,
  rollback: boolean,
  pending: boolean,
): Promise<void> {
  await withNativeFallbackFixture(async (fixture) => {
    const { history, owners, durable } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler(
      pending ? 'native-pending-window' : 'native-provider-candidate',
      size,
      owners,
      probes,
    );
    await history.detachedValues.replace(
      probedTransformInput(
        size,
        (index) => suffixRow(index, 2048),
        owners,
        probes,
      ),
    );
    history.setCacheAnchorSeq(1);
    const before = await compressionValueDigest(expectedRows(size));
    const selected = pending
      ? await compressionValueDigest(expectedRows(size, size - 2))
      : before;
    const state: { baseline: number | null } = { baseline: 123 };
    const failure = new Error('native fallback rejected after installation');
    const finalizationFailure = !pending && rollback ? failure : undefined;
    await fixture.pauseFinalization(finalizationFailure);
    const rows = new DetachedHistoryJournal(owners);
    try {
      for (let index = 0; index < size; index++)
        rows.append(suffixRow(index, 2048));
      const prior = history.streamRawHistory();
      expect((await prior.next()).done).toBe(false);
      if (pending) fixture.pauseWriter();
      const operation = startFallback(
        history,
        state,
        rows,
        pending,
        rollback ? failure : undefined,
      );
      await observePhases(fixture, operation, sample, selected, prior, {
        gate: pending ? fixture.writerPaused : Promise.resolve(),
        phase: pending ? 'writer-paused' : 'prior-reader-owned',
      });
      expect(await operation).toBe(rollback ? failure : undefined);
      await sample(rollback ? 'rollback' : 'complete');
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      const expected = rollback ? before : selected;
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(expected);
      expect(await durable()).toStrictEqual(expected);
      expect(history.getTotalTokens()).toBe(expected.count);
      expect(history.getCacheAnchorSeq()).toBe(pending && !rollback ? 0 : 1);
      expect(state.baseline).toBe(pending && !rollback ? 0 : 123);
    } finally {
      rows.close();
    }
  });
}
