/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import {
  applyPendingWindowFallback,
  type PendingFallbackDeps,
} from '../pendingWindowFallback.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { runDiskProviderFallback } from '../diskProviderFallback.js';
import { middleoutSetup } from './middleout-disk-helpers.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import {
  withValueTransformFixture,
  transformProbes,
  transformPhaseSampler,
  pauseTransformFinalization,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/transform-value-fixtures.js';
import { suffixRow } from '@vybestack/llxprt-code-core/services/history/history-suffix-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

async function* expectedRows(
  size: number,
  start = 0,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = start; index < size; index++) yield suffixRow(index, bytes);
}

async function candidate(size: number, rollback: boolean): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler(
      'provider-candidate',
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
    const before = await detachedDigest(expectedRows(size));
    const rows = new DetachedHistoryJournal(owners);
    try {
      for (let index = 0; index < size; index++)
        rows.append(suffixRow(index, 2048));
      const failure = new Error('candidate finalization rejected');
      const finalization = pauseTransformFinalization(
        history,
        rollback ? failure : undefined,
      );
      fixture.pauseWriter();
      const operation = rejectedValue(
        publishProviderFallbackCandidate(
          history,
          { rows, start: 0, hasPendingRows: true },
          'test',
        ),
      );
      try {
        await Promise.race([
          fixture.writerPaused,
          operation.then((value) => {
            throw new Error(
              `Candidate ended before writer pause: ${String(value)}`,
            );
          }),
        ]);
        await sample('writer-paused');
        expect(owners.snapshot().liveRows).toBeGreaterThan(0);
        fixture.releaseWriter();
        await finalization.acknowledged;
        await sample('acknowledged');
        expect(owners.snapshot().liveRows).toBe(0);
        expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
        finalization.release();
        expect(await operation).toBe(rollback ? failure : undefined);
        await sample(rollback ? 'rollback' : 'complete');
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          before,
        );
        expect(history.getTotalTokens()).toBe(size);
        return before.count;
      } finally {
        fixture.releaseWriter();
        finalization.release();
      }
    } finally {
      rows.close();
    }
  });
}

function pendingDeps(
  history: HistoryService,
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
        history,
        async () => ({
          provider: setup.transport,
          runtime: setup.runtime.providerRuntime,
        }),
        undefined,
        undefined,
        new DebugLogger('test:pending-values'),
        { targetTokenCount },
      );
      if (failure !== undefined) throw failure;
      return result.outcome === 'applied';
    },
  };
}

async function pending(size: number, rollback: boolean): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler(
      'pending-window',
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
    const before = await detachedDigest(expectedRows(size));
    const selected = await detachedDigest(expectedRows(size, size - 2));
    const state: { baseline: number | null } = { baseline: 123 };
    const failure = new Error('fallback rejected after candidate installation');
    const finalization = pauseTransformFinalization(history);
    fixture.pauseWriter();
    const operation = rejectedValue(
      applyPendingWindowFallback(
        pendingDeps(history, state, rollback ? failure : undefined),
        'bounded-pending',
        0,
      ).then((applied) => {
        expect(applied).toBe(true);
      }),
    );
    try {
      await Promise.race([
        fixture.writerPaused,
        operation.then((value) => {
          throw new Error(
            `Fallback ended before writer pause: ${String(value)}`,
          );
        }),
      ]);
      await sample('writer-paused');
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      fixture.releaseWriter();
      await finalization.acknowledged;
      await sample('acknowledged');
      expect(owners.snapshot().liveRows).toBe(0);
      expect(await detachedDurableDigest(recorder)).toStrictEqual(selected);
      finalization.release();
      expect(await operation).toBe(rollback ? failure : undefined);
      await sample(rollback ? 'rollback' : 'complete');
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      const expected = rollback ? before : selected;
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(history.getTotalTokens()).toBe(expected.count);
      expect(history.getCacheAnchorSeq()).toBe(rollback ? 1 : 0);
      expect(state.baseline).toBe(rollback ? 123 : 0);
      return expected.count;
    } finally {
      fixture.releaseWriter();
      finalization.release();
    }
  });
}

describe('fallback disk value callers', () => {
  for (const size of [512, 8192]) {
    for (const rollback of [false, true]) {
      it(`publishes complete candidate at ${size}, rollback=${rollback}`, async () => {
        expect(await candidate(size, rollback)).toBe(size);
      }, 180_000);
      it(`runs actual pending fallback at ${size}, rollback=${rollback}`, async () => {
        expect(await pending(size, rollback)).toBe(rollback ? size : 2);
      }, 180_000);
    }
  }
  it('preserves a complete valid candidate larger than nine MiB', async () => {
    await withValueTransformFixture(async ({ history, recorder }) => {
      const rows = new DetachedHistoryJournal();
      try {
        const bytes = 9 * 1024 * 1024 + 1;
        rows.append(suffixRow(0, bytes));
        await publishProviderFallbackCandidate(
          history,
          { rows, start: 0, hasPendingRows: false },
          'test',
        );
        const expected = await detachedDigest(expectedRows(1, 0, bytes));
        expect(expected.bytes).toBeGreaterThan(9 * 1024 * 1024);
        expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
      } finally {
        rows.close();
      }
    });
  }, 180_000);
});
