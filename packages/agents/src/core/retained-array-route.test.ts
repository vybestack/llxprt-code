/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  clientArrayRows,
  clientRows,
  forbidClientArrayRollback,
  withClientOracle,
} from './client-array-test-helpers.js';
import { withRetainedClient } from './retained-array-test-helpers.js';

function registerRoute(size: number, set: boolean): void {
  describe('registerRoute', () => {
    it(`admits ${size} full rows through actual inactive ${set ? 'setHistory' : 'storeHistoryForLaterUse'} without legacy rollback`, async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client, store }) => {
          const rows = clientArrayRows(size);
          const expected = await withClientOracle(store, rows, (admitted) =>
            detachedDigest(clientRows(admitted)),
          );
          forbidClientArrayRollback(fixture);
          if (set) await client.setHistory(rows);
          else await client.storeHistoryForLaterUse(rows);
          expect(await detachedDigest(client.streamHistory())).toStrictEqual(
            expected,
          );
          expect(await detachedDurableDigest(fixture.recorder)).toStrictEqual(
            expected,
          );
          expect(rows).toStrictEqual(clientArrayRows(size));
          expect(client.hasChatInitialized()).toBe(false);
          expect(fixture.owners.snapshot().liveRows).toBe(0);
        }),
      );
    }, 180_000);
  });
}
function registerLarge(): void {
  describe('registerLarge', () => {
    it('keeps every byte of a valid nine MiB admitted row', async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client, store }) => {
          const rows = clientArrayRows(1, 9 * 1024 * 1024);
          const expected = await withClientOracle(store, rows, (admitted) =>
            detachedDigest(clientRows(admitted)),
          );
          forbidClientArrayRollback(fixture);
          await client.storeHistoryForLaterUse(rows);
          expect(await detachedDigest(client.streamHistory())).toStrictEqual(
            expected,
          );
          expect(await detachedDurableDigest(fixture.recorder)).toStrictEqual(
            expected,
          );
          expect(expected.bytes).toBeGreaterThan(9 * 1024 * 1024);
        }),
      );
    }, 180_000);
  });
}
describe('real retained array entry detached values', () => {
  for (const size of [512, 8192])
    for (const set of [false, true]) registerRoute(size, set);
  registerLarge();
});
