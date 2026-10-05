/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
import {
  RowOwnership,
  type RowOwnershipStats,
} from '../../../core/src/recording/rowOwnership.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import {
  boundedOwners,
  conversationFor,
  forbidArrayRollback,
  gate,
  recordArrayProof,
} from './conversation-array-test-helpers.js';

async function seedPending(
  fixture: DetachedFixture,
  size: number,
): Promise<void> {
  for (let index = 0; index < size; index++)
    fixture.history.add(detachedRow(index));
  await fixture.history.waitForTokenUpdates();
  fixture.history.setCacheAnchorSeq(1);
}
async function pendingCheckpoint(
  fixture: DetachedFixture,
  size: number,
  cancel: boolean,
): Promise<number> {
  const { history, recorder, owners, releaseWriter } = fixture;
  await seedPending(fixture, size);
  const ready = gate();
  const release = gate();
  const controller = new AbortController();
  const failure = new Error('pending restore finalization');
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
  forbidArrayRollback(history);
  const operation = rejectedValue(
    conversationFor(history).setHistory(
      Array.from({ length: size }, (_, index) => detachedRow(index)),
    ),
  );
  try {
    while (owners.snapshot().liveRows < size * 2) await setImmediate();
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
    expect(await operation).toBe(failure);
    const expected = await detachedDigest(detachedRows(size));
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      expected,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
    expect(history.getCacheAnchorSeq()).toBe(1);
    expect(history.getTotalTokens()).toBe(size * 4);
    expect(owners.snapshot().liveRows).toBe(0);
    recordArrayProof({
      kind: 'pending',
      size,
      cancel,
      pre,
      held,
      callerRows: 0,
      returnedRows: 0,
      expected,
    });
    return expected.count;
  } finally {
    releaseWriter();
    release.resolve();
    await operation;
  }
}

async function retainingControl(
  count: number,
  bytes: number,
): Promise<RowOwnershipStats> {
  return withDetachedFixture(async ({ history, owners }) => {
    const caller = new RowOwnership();
    const submitted: IContent[] = Array.from({ length: count }, (_, index) =>
      detachedRow(index, bytes),
    );
    for (const row of submitted) {
      owners.retain(row);
      caller.retain(row);
    }
    let held = owners.snapshot();
    const failure = new Error('retaining caller');
    history.registerMediaOwner(
      mediaParticipant(() => ({
        publish: () => undefined,
        rollback: () => undefined,
        finalize: () => {
          held = owners.snapshot();
          throw failure;
        },
      })),
    );
    forbidArrayRollback(history);
    try {
      expect(
        await rejectedValue(conversationFor(history).setHistory(submitted)),
      ).toBe(failure);
      expect(boundedOwners(held)).toBe(false);
      expect(caller.snapshot().liveRows).toBe(count);
      expect(owners.snapshot().liveRows).toBe(count);
      recordArrayProof({
        kind: 'caller-trap',
        count,
        bytes,
        held,
        caller: caller.snapshot(),
        returnedRows: 0,
      });
    } finally {
      for (const row of submitted) {
        caller.release(row);
        owners.release(row);
      }
    }
    expect(owners.snapshot().liveRows).toBe(0);
    return held;
  });
}

describe('conversation restore pending writer ownership', () => {
  for (const size of [512, 8192])
    for (const cancel of [false, true]) {
      it(`charges ${size} original rows before ack and ${cancel ? 'cancels' : 'rolls back finalize'} without retaining them after ack`, async () => {
        expect(
          await withDetachedFixture(
            (fixture) => pendingCheckpoint(fixture, size, cancel),
            true,
          ),
        ).toBe(size);
      }, 180_000);
    }
});
describe('actual caller retention negative controls', () => {
  it('rejects 441 live caller row owners at the post-ack checkpoint', async () => {
    expect((await retainingControl(441, 0)).liveRows).toBeGreaterThan(440);
  });
  it('rejects 439 caller rows whose bytes exceed eight MiB', async () => {
    expect(
      (await retainingControl(439, Math.floor((8 * 1024 * 1024) / 439) + 1))
        .liveSerializedBytes,
    ).toBeGreaterThan(8 * 1024 * 1024);
  });
});
