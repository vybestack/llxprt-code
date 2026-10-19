/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { transformFixtureRows } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { batchGate } from '@vybestack/llxprt-code-core/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import {
  applyPendingWindowFallback,
  type PendingFallbackDeps,
} from '../pendingWindowFallback.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  withNativeFallbackFixture,
  reachesGate,
} from './support/native-fallback-fixture.js';

function pendingDeps(
  history: PendingFallbackDeps['historyService'],
  install: PendingFallbackDeps['performFallbackCompression'],
): PendingFallbackDeps {
  return {
    historyService: history,
    getRuntimeModel: () => 'test',
    getLastPromptTokenCount: () => 123,
    resetLastPromptTokenCount: () => {},
    restoreLastPromptTokenCount: () => {},
    performFallbackCompression: install,
  };
}

async function* expectedQueued(
  size: number,
): AsyncGenerator<ReturnType<typeof suffixRow>> {
  yield* transformFixtureRows(size);
  for (let index = size; index < size + 3; index++) yield suffixRow(index);
}

async function partialAdmission(size: number): Promise<void> {
  await withNativeFallbackFixture(
    async ({ history, owners, durable, failAdmissionAfter }) => {
      await history.detachedValues.replace(transformFixtureRows(size));
      const before = await compressionValueDigest(transformFixtureRows(size));
      history.setBaseTokenOffset(37);
      history.setCacheAnchorSeq(1);
      const failure = failAdmissionAfter(1);
      const rows = new DetachedHistoryJournal(owners);
      rows.append(suffixRow(size));
      rows.append(suffixRow(size + 1));
      try {
        expect(
          await rejectedValue(
            publishProviderFallbackCandidate(
              history,
              { rows, start: 0, hasPendingRows: true },
              'test',
            ),
          ),
        ).toBe(failure);
        history.setTokenizerFactory(exactTokenizer());
        expect(await durable()).toStrictEqual(before);
        expect(
          await compressionValueDigest(history.streamRawHistory()),
        ).toStrictEqual(before);
        expect(history.getTotalTokens()).toBe(size * 3 + 37);
        expect(history.getBaseTokenOffset()).toBe(37);
        expect(history.getCacheAnchorSeq()).toBe(1);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        await publishProviderFallbackCandidate(
          history,
          { rows, start: 0, hasPendingRows: true },
          'test',
        );
        const selected = await compressionValueDigest(
          (async function* () {
            yield* rows;
          })(),
        );
        expect(await durable()).toStrictEqual(selected);
        expect(
          await compressionValueDigest(history.streamRawHistory()),
        ).toStrictEqual(selected);
      } finally {
        rows.close();
      }
    },
  );
}

async function pendingQueued(size: number): Promise<void> {
  await withNativeFallbackFixture(async (fixture) => {
    const { history, owners, durable } = fixture;
    await history.detachedValues.replace(transformFixtureRows(size));
    const before = await compressionValueDigest(transformFixtureRows(size));
    fixture.pauseWriter();
    history.add(suffixRow(size));
    history.add(suffixRow(size + 1));
    history.startCompression();
    history.add(suffixRow(size + 2));
    const rows = new DetachedHistoryJournal(owners);
    rows.append(suffixRow(size));
    rows.append(suffixRow(size + 1));
    const ready = batchGate();
    const release = batchGate();
    const failure = new DOMException(
      'pending installed cancellation',
      'AbortError',
    );
    const operation = rejectedValue(
      applyPendingWindowFallback(
        pendingDeps(history, async (_prompt, publish) => {
          await publish({ rows, start: 0, hasPendingRows: true });
          ready.resolve();
          await release.promise;
          throw failure;
        }),
        'native-pending-values-queued',
        0,
      ).then(() => {}),
    );
    try {
      await reachesGate(fixture.writerPaused, operation);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      fixture.releaseWriter();
      await reachesGate(ready.promise, operation);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(history.getTotalTokens()).toBe(2);
      release.resolve();
      expect(await operation).toBe(failure);
      expect(history.getTotalTokens()).toBe(size * 3 + 2);
      history.endCompression();
      await history.waitForCommit();
      const expected = await compressionValueDigest(expectedQueued(size));
      expect(await durable()).toStrictEqual(expected);
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(expected);
      expect(expected).not.toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(size * 3 + 3);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
    } finally {
      release.resolve();
      fixture.releaseWriter();
      await operation;
      history.endCompression();
      rows.close();
    }
  });
}

describe('native fallback partial admission and queued chronology', () => {
  for (const size of [512, 8192]) {
    it(`restores ${size} complete rows after one admitted row fails, then retries`, async () => {
      await expect(partialAdmission(size)).resolves.toBeUndefined();
    }, 180_000);
    it(`preserves pending and queued chronology through cancellation over ${size} rows`, async () => {
      await expect(pendingQueued(size)).resolves.toBeUndefined();
    }, 180_000);
  }
});
