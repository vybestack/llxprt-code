/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import { withDetachedFixture } from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  boundedOwners,
  expectBatchObserverOwners,
} from './conversation-array-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
  recordClientProof,
  withArrayClient,
} from './client-array-test-helpers.js';

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
          history.on('contentBatchAdded', (rows) => {
            expect(rows.length).toBe(size);
            rows.withRows((cursor) => {
              let count = 0;
              for (
                let item = cursor.next();
                item.done !== true;
                item = cursor.next()
              ) {
                if (retain) {
                  held.rows.push(item.value);
                  owners.retain(item.value);
                }
                emitted = owners.snapshot();
                count++;
              }
              expect(count).toBe(size);
            });
          });
          history.registerMediaOwner(
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
