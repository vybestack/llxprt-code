/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  fallbackHarness,
  enforceFallback,
  fallbackCandidate,
} from './provider-fallback-disk-helpers.js';
import { withValueTransformFixture } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { transformFixtureRows } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers-fixtures.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import {
  applyPendingWindowFallback,
  type PendingFallbackDeps,
} from '../pendingWindowFallback.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { batchGate } from '@vybestack/llxprt-code-core/services/history/addbatch-stream-test-helpers.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { ProviderFallbackCandidate } from '../providerFallbackCandidate.js';

const failures = [
  'reject',
  'false',
  'cancel',
  'partial',
  'baseline',
  'duplicate',
  'missing',
] as const;
type Failure = (typeof failures)[number];

async function enforceRollback(
  size: number,
  failure: Failure,
): Promise<number> {
  return withValueTransformFixture(async ({ history, recorder, owners }) => {
    await history.detachedValues.replace(transformFixtureRows(size));
    const before = await detachedDigest(transformFixtureRows(size));
    history.setBaseTokenOffset(37);
    history.setCacheAnchorSeq(1);
    const rows = new DetachedHistoryJournal(owners);
    try {
      rows.append(fallbackCandidate());
      const harness = fallbackHarness(
        history,
        async (_prompt, install) => {
          if (failure === 'missing') return true;
          if (failure === 'partial') recorder.failAdmissionAfter(1);
          await install({ rows, start: 0, hasPendingRows: true });
          if (failure === 'duplicate')
            await install({ rows, start: 0, hasPendingRows: true });
          if (failure === 'reject') throw new Error('fallback rejected');
          if (failure === 'cancel')
            throw new DOMException(
              'cancelled after installation',
              'AbortError',
            );
          return failure !== 'false';
        },
        { resetFails: failure === 'baseline' },
      );
      let message = 'post-truncation stage';
      if (failure === 'missing')
        message = 'without providing candidate history';
      if (failure === 'duplicate') message = 'only be installed once';
      await expect(enforceFallback(harness.enforcer)).rejects.toThrow(message);
      expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        before,
      );
      expect(history.getTotalTokens()).toBe(size * 3 + 37);
      expect(history.getBaseTokenOffset()).toBe(37);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(harness.baseline()).toBe(123);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      return before.count;
    } finally {
      rows.close();
    }
  });
}

function deps(
  history: HistoryService,
  install: (
    publish: (candidate: ProviderFallbackCandidate) => Promise<void>,
  ) => Promise<boolean>,
): PendingFallbackDeps {
  return {
    historyService: history,
    getRuntimeModel: () => 'test',
    getLastPromptTokenCount: () => 123,
    resetLastPromptTokenCount: () => {},
    restoreLastPromptTokenCount: () => {},
    performFallbackCompression: async (_prompt, publish) => install(publish),
  };
}

async function* queuedExpected(
  size: number,
): AsyncGenerator<ReturnType<typeof suffixRow>, void, unknown> {
  yield* transformFixtureRows(size);
  for (let index = size; index < size + 3; index++) yield suffixRow(index);
}

async function pendingQueued(size: number): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, owners, recorder } = fixture;
    await history.detachedValues.replace(transformFixtureRows(size));
    const before = await detachedDigest(transformFixtureRows(size));
    fixture.pauseWriter();
    history.add(suffixRow(size));
    history.add(suffixRow(size + 1));
    history.startCompression();
    const queued = suffixRow(size + 2);
    history.add(queued);
    const rows = new DetachedHistoryJournal(owners);
    const ready = batchGate();
    const release = batchGate();
    const failure = new DOMException(
      'pending installed cancellation',
      'AbortError',
    );
    rows.append(suffixRow(size));
    rows.append(suffixRow(size + 1));
    const operation = rejectedValue(
      applyPendingWindowFallback(
        deps(history, async (publish) => {
          await publish({ rows, start: 0, hasPendingRows: true });
          ready.resolve();
          await release.promise;
          throw failure;
        }),
        'pending-values-queued',
        0,
      ).then(() => {}),
    );
    try {
      await fixture.writerPaused;
      expect(owners.snapshot().liveRows).toBeGreaterThan(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      fixture.releaseWriter();
      await ready.promise;
      expect(owners.snapshot().liveRows).toBe(0);
      expect(history.getTotalTokens()).toBe(2);
      release.resolve();
      expect(await operation).toBe(failure);
      expect(history.getTotalTokens()).toBe(size * 3 + 2);
      history.endCompression();
      await history.waitForCommit();
      const expected = await detachedDigest(queuedExpected(size));
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(expected).not.toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(size * 3 + 3);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      return size + 3;
    } finally {
      release.resolve();
      fixture.releaseWriter();
      rows.close();
    }
  });
}

describe('fallback value compensation and pending chronology', () => {
  for (const size of [512, 8192]) {
    for (const failure of failures)
      it(`restores ${size} complete media/tool/provider rows after ${failure}`, async () => {
        expect(await enforceRollback(size, failure)).toBe(size);
      }, 180_000);
    it(`preserves pending and queued chronology through cancellation over ${size} rows`, async () => {
      expect(await pendingQueued(size)).toBe(size + 3);
    }, 180_000);
  }
});
