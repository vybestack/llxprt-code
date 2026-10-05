/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { withRetainedClient } from './retained-array-test-helpers.js';
import type { AgentClient } from './client.js';
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
  type DetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { RowOwnership } from '../../../core/src/recording/rowOwnership.js';
import { boundedOwners, gate } from './conversation-array-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
  recordClientProof,
} from './client-array-test-helpers.js';

async function assertPendingRollback(
  fixture: DetachedFixture,
  size: number,
  operation: Promise<unknown>,
  failure: Error,
): Promise<void> {
  const { history, recorder, owners } = fixture;
  const error = await operation;
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error('Missing pending failure');
  expect(error.message).toContain(failure.message);
  const expected = await detachedDigest(detachedRows(size));
  expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
    expected,
  );
  expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
  expect(history.getTotalTokens()).toBe(
    size * 4 + history.getBaseTokenOffset(),
  );
  expect(history.getCacheAnchorSeq()).toBe(1);
  expect(owners.snapshot().liveRows).toBe(0);
}
async function pendingCheckpoint(
  fixture: DetachedFixture,
  clientFixture: { client: AgentClient },
  size: number,
  cancel: boolean,
): Promise<number> {
  const { history, owners, releaseWriter } = fixture;
  const { client } = clientFixture;
  for (let index = 0; index < size; index++) history.add(detachedRow(index));
  await history.waitForTokenUpdates();
  history.setCacheAnchorSeq(1);
  const ready = gate();
  const release = gate();
  const controller = new AbortController();
  const failure = new Error('client pending finalization');
  const replace = history.detachedValues.replace;
  history.detachedValues.replace = (rows, model, options) =>
    replace(rows, model, { ...options, signal: controller.signal });
  history.registerMediaOwner(
    mediaParticipant(() => ({
      publish: () => undefined,
      rollback: () => undefined,
      finalize: async () => {
        ready.resolve();
        await release.promise;
        if (!cancel) throw failure;
      },
    })),
  );
  forbidClientArrayRollback(fixture);
  const operation = rejectedValue(
    client.storeHistoryForLaterUse(clientArrayRows(size), {
      ownership: owners,
    }),
  );
  try {
    const captured = async (): Promise<void> => {
      while (owners.snapshot().liveRows < size * 2) await setImmediate();
    };
    await Promise.race([
      captured(),
      operation.then((error) => {
        throw error;
      }),
    ]);
    const pre = owners.snapshot();
    expect(pre.liveRows).toBeGreaterThanOrEqual(size * 2);
    expect(pre.liveSerializedBytes).toBeGreaterThan(size * 2048);
    releaseWriter();
    await Promise.race([
      ready.promise,
      operation.then((error) => {
        throw error;
      }),
    ]);
    const held = owners.snapshot();
    expect(boundedOwners(held)).toBe(true);
    if (cancel) controller.abort(failure);
    release.resolve();
    await assertPendingRollback(fixture, size, operation, failure);
    recordClientProof({
      kind: 'pending',
      size,
      cancel,
      pre,
      held,
      callerRows: 0,
      returnedRows: 0,
    });
    return owners.snapshot().liveRows;
  } finally {
    releaseWriter();
    release.resolve();
    await operation;
  }
}
function registerPending(size: number, cancel: boolean): void {
  describe('registerPending', () => {
    it(`charges the full ${size} pending prefix before acknowledgement and compensates ${cancel ? 'cancellation' : 'finalization'}`, async () => {
      expect(
        await withDetachedFixture(
          (fixture) =>
            withRetainedClient(fixture, (clientFixture) =>
              pendingCheckpoint(fixture, clientFixture, size, cancel),
            ),
          true,
        ),
      ).toBe(0);
    }, 180_000);
  });
}
function registerConsumer(): void {
  describe('registerConsumer', () => {
    it('aborts a paused outward consumer without losing or duplicating restored history', async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client }) => {
          forbidClientArrayRollback(fixture);
          await client.storeHistoryForLaterUse(clientArrayRows(512));
          const expected = await detachedDigest(
            fixture.history.streamRawHistory(),
          );
          const controller = new AbortController();
          const cursor = client.getHistory(false, controller.signal);
          expect((await cursor.next()).done).toBe(false);
          controller.abort(new Error('client consumer abort'));
          await expect(cursor.next()).rejects.toThrow('client consumer abort');
          await cursor.return();
          expect(
            await detachedDigest(fixture.history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(fixture.owners.snapshot().liveRows).toBe(0);
        }),
      );
    });
  });
}
function registerTrap(count: number, bytes: number): void {
  describe('registerTrap', () => {
    it(`rejects the actual retaining caller at ${count} rows/${bytes} payload bytes`, async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client }) => {
          const rows = clientArrayRows(count, bytes);
          const caller = new RowOwnership();
          for (const row of rows) {
            caller.retain(row);
            fixture.owners.retain(row);
          }
          const failure = new Error('client retaining caller');
          let held = fixture.owners.snapshot();
          fixture.history.registerMediaOwner(
            mediaParticipant(() => ({
              publish: () => undefined,
              rollback: () => undefined,
              finalize: () => {
                held = fixture.owners.snapshot();
                throw failure;
              },
            })),
          );
          forbidClientArrayRollback(fixture);
          try {
            expect(
              await rejectedValue(client.storeHistoryForLaterUse(rows)),
            ).toBeInstanceOf(Error);
            expect(boundedOwners(held)).toBe(false);
            expect(caller.snapshot().liveRows).toBe(count);
            recordClientProof({
              kind: 'caller-trap',
              count,
              bytes,
              held,
              caller: caller.snapshot(),
            });
          } finally {
            for (const row of rows) {
              caller.release(row);
              fixture.owners.release(row);
            }
          }
          expect(fixture.owners.snapshot().liveRows).toBe(0);
        }),
      );
    });
  });
}
describe('AgentClient original pending prefix and acknowledged ownership', () => {
  for (const size of [512, 8192])
    for (const cancel of [false, true]) registerPending(size, cancel);
});
describe('client restored consumer and negative ownership controls', () => {
  registerConsumer();
  for (const [count, bytes] of [
    [441, 0],
    [439, Math.floor((8 * 1024 * 1024) / 439) + 1],
  ])
    registerTrap(count, bytes);
});
