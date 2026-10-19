/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  withNativeFallbackFixture,
  reachesGate,
} from './support/native-fallback-fixture.js';

async function mediaRollback(size: number): Promise<void> {
  await withNativeFallbackFixture(async (fixture) => {
    const { history, owners } = fixture;
    const reference = await fixture.admit();
    const rowAt = (index: number): IContent => ({
      ...suffixRow(index, 2048),
      blocks:
        index === 0 || index === size - 1
          ? [...suffixRow(index, 2048).blocks, reference]
          : suffixRow(index, 2048).blocks,
    });
    await history.detachedValues.replace(
      (async function* () {
        for (let index = 0; index < size; index++) yield rowAt(index);
      })(),
    );
    const before = await compressionValueDigest(
      (async function* () {
        for (let index = 0; index < size; index++) yield rowAt(index);
      })(),
    );
    const failure = new Error('reject fallback media finalization');
    await fixture.pauseFinalization(failure);
    const rows = new DetachedHistoryJournal(owners);
    rows.append(suffixRow(size));
    const operation = rejectedValue(
      publishProviderFallbackCandidate(
        history,
        { rows, start: 0, hasPendingRows: true },
        'test',
      ),
    );
    try {
      await reachesGate(fixture.acknowledged, operation);
      expect(await fixture.reserved(reference.contentId)).toBe(true);
      expect(owners.snapshot().liveRows).toBe(0);
      expect((await fixture.durable(false)).count).toBe(1);
      fixture.releaseFinalization();
      expect(await operation).toBe(failure);
      expect(await fixture.durable()).toStrictEqual(before);
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(before);
      expect(await fixture.reserved(reference.contentId)).toBe(true);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      await publishProviderFallbackCandidate(
        history,
        { rows, start: 0, hasPendingRows: true },
        'test',
      );
      expect(await fixture.reserved(reference.contentId)).toBe(false);
      expect(owners.snapshot().liveRows).toBe(0);
    } finally {
      fixture.releaseFinalization();
      await operation;
      rows.close();
    }
  });
}

async function retainingControl(size: number): Promise<void> {
  await withNativeFallbackFixture(async ({ history, owners }) => {
    await history.detachedValues.replace(
      (async function* () {
        for (let index = 0; index < size; index++) yield suffixRow(index, 2048);
      })(),
    );
    const retained: IContent[] = [];
    try {
      for await (const row of history.streamRawHistory()) {
        owners.retain(row);
        retained.push(row);
      }
      expect(owners.snapshot().liveRows).toBe(size);
      expect(owners.snapshot().liveRows).toBeGreaterThan(440);
      expect(owners.snapshot().liveSerializedBytes).toBeGreaterThan(
        size * 2048,
      );
      expect(owners.snapshot().liveSerializedBytes > 8 * 1024 * 1024).toBe(
        size === 8192,
      );
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(false);
    } finally {
      for (const row of retained) owners.release(row);
    }
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.snapshot().liveSerializedBytes).toBe(0);
  });
}

describe('native fallback retained media and owner controls', () => {
  for (const size of [512, 8192]) {
    it(`keeps actual media through acknowledged rollback and releases it on retry over ${size} rows`, async () => {
      const result = await mediaRollback(size);
      expect(result).toBeUndefined();
    }, 180_000);
    it(`rejects retained native reader values at the original bounds over ${size} rows`, async () => {
      await expect(retainingControl(size)).resolves.toBeUndefined();
    }, 180_000);
  }
});
