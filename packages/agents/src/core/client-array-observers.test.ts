/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRowSource } from '../../../core/src/services/history/batch-event-test-helpers.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import { withDetachedFixture } from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  boundedOwners,
  expectBatchObserverOwners,
} from './__tests__/support/conversation-array-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
  recordClientProof,
  withArrayClient,
} from './__tests__/support/client-array-test-helpers.js';

function registerObserver(size: number, retain: boolean): void {
  describe('client batch observer ownership after admitted restore', () => {
    it(`charges ${size} emitted rows and ${retain ? 'rejects retention' : 'releases them before finalization'}`, async () => {
      await withDetachedFixture((fixture) =>
        withArrayClient(fixture, async ({ client }) => {
          const { history, owners } = fixture;
          const held: { rows: IContent[] } = { rows: [] };
          let emitted = owners.snapshot();
          let finalized = owners.snapshot();
          const failure = new Error('client observer checkpoint');
          const passes: Array<Promise<void>> = [];
          history.on('contentBatchAdded', (rows) => {
            expect(rows.length).toBe(size);
            passes.push(
              (async () => {
                let count = 0;
                for await (const row of batchRowSource(rows).rows()) {
                  if (retain) {
                    held.rows.push(row);
                    owners.retain(row);
                  }
                  emitted = owners.snapshot();
                  count++;
                }
                expect(count).toBe(size);
              })(),
            );
          });
          await history.registerMediaOwner(
            mediaParticipant(() => ({
              publish: () => undefined,
              rollback: () => undefined,
              finalize: () => {
                finalized = owners.snapshot();
                throw failure;
              },
            })),
          );
          forbidClientArrayRollback(fixture);
          try {
            const error = await rejectedValue(
              client.restoreHistory(clientArrayRows(size)),
            );
            expect(error).toBeInstanceOf(Error);
            await Promise.all(passes);
            expectBatchObserverOwners(emitted, size, retain);
            expect(boundedOwners(finalized)).toBe(!retain);
            recordClientProof({
              kind: 'observer',
              size,
              retain,
              emitted,
              finalized,
            });
          } finally {
            for (const row of held.rows) owners.release(row);
            held.rows = [];
          }
          expect(owners.snapshot().liveRows).toBe(0);
        }),
      );
    }, 180_000);
  });
}
for (const size of [512, 8192])
  for (const retain of [false, true]) registerObserver(size, retain);
