/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  detachedRow,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { batchRowSource } from '../../../core/src/services/history/batch-event-test-helpers.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import {
  boundedOwners,
  conversationFor,
  forbidArrayRollback,
  recordArrayProof,
} from './__tests__/support/conversation-array-test-helpers.js';

async function observerOwners(size: number, retain: boolean): Promise<boolean> {
  return withDetachedFixture(async ({ history, owners }) => {
    const subscriber: { rows: IContent[] } = { rows: [] };
    let transient = owners.snapshot();
    let held = owners.snapshot();
    const passes: Array<Promise<void>> = [];
    history.once('contentBatchAdded', (rows) => {
      expect(rows.length).toBe(size);
      passes.push(
        (async () => {
          let count = 0;
          for await (const row of batchRowSource(rows).rows()) {
            if (retain) {
              subscriber.rows.push(row);
              owners.retain(row);
            }
            transient = owners.snapshot();
            count++;
          }
          expect(count).toBe(size);
        })(),
      );
    });
    const failure = new Error('observer owner checkpoint');
    await history.registerMediaOwner(
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
        await rejectedValue(
          conversationFor(history).setHistory(
            Array.from({ length: size }, (_, index) => detachedRow(index)),
          ),
        ),
      ).toBe(failure);
      await Promise.all(passes);
      if (retain) {
        expect(transient.liveRows).toBeGreaterThanOrEqual(size);
        expect(transient.liveSerializedBytes).toBeGreaterThan(size * 2048);
      } else {
        expect(transient.liveRows).toBeLessThanOrEqual(3);
        expect(boundedOwners(transient)).toBe(true);
      }
      expect(held.liveRows).toBe(retain ? size : 0);
      recordArrayProof({
        kind: 'observer-owners',
        size,
        retain,
        transient,
        held,
        subscriberRows: subscriber.rows.length,
        returnedRows: 0,
      });
      return boundedOwners(held);
    } finally {
      for (const row of subscriber.rows) owners.release(row);
      subscriber.rows = [];
      expect(owners.snapshot().liveRows).toBe(0);
    }
  });
}

describe('conversation batch publication owner census', () => {
  for (const size of [512, 8192]) {
    it(`charges the transient ${size}-row event payload without keeping it at the post-ack checkpoint`, async () => {
      expect(await observerOwners(size, false)).toBe(true);
    }, 180_000);
    it(`rejects the real event subscriber retaining ${size} returned batch values`, async () => {
      expect(await observerOwners(size, true)).toBe(false);
    }, 180_000);
  }
});
