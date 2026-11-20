/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setTimeout } from 'node:timers/promises';
import {
  journalMediaParticipant as mediaParticipant,
  rejectedValue,
} from '../../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from '../../../../../core/src/services/history/detached-rollback-test-helpers.js';
import { withRetainedClient } from './retained-array-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
  recordClientProof,
  seedClientArrayHistory,
  withClientOracle,
} from './client-array-test-helpers.js';
import { boundedOwners, gate } from './conversation-array-test-helpers.js';
import type { IContent } from '../../../../../core/src/services/history/IContent.js';
import { JournalHistoryStore } from '../../../../../core/src/services/history/journalHistoryStore.js';

function candidateMediaRows(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
        },
      ],
    },
  ];
}

async function earliestPendingFailure(size: number): Promise<number> {
  return withDetachedFixture((fixture) =>
    withRetainedClient(fixture, async ({ client, store }) => {
      const { history, owners, session } = fixture;
      await seedClientArrayHistory(fixture, size - 1);
      fixture.pauseWriter();
      history.add(detachedRow(size - 1));
      await fixture.writerPaused;
      const failure = new Error('pending snapshot acquisition failure');
      const snapshot = session.store.snapshot.bind(session.store);
      let pendingTokenSnapshot = true;
      let failNext = true;
      session.store.snapshot = async () => {
        // The pending token ticket captures its immutable row version before
        // the replacement checkpoint. Only the checkpoint acquisition fails.
        if (pendingTokenSnapshot) {
          pendingTokenSnapshot = false;
          return snapshot();
        }
        if (failNext) {
          failNext = false;
          throw failure;
        }
        return snapshot();
      };
      const operation = rejectedValue(
        client.storeHistoryForLaterUse(
          [...clientArrayRows(size), ...candidateMediaRows()],
          { ownership: owners },
        ),
      );
      try {
        fixture.releaseWriter();
        expect(await operation).toBe(failure);
        await history.waitForTokenUpdates();
        expect(await detachedDigest(client.streamHistory())).toStrictEqual(
          await detachedDigest(detachedRows(size)),
        );
        expect(history.getTotalTokens()).toBe(size * 4);
        expect(await store.getStoredByteLength()).toBe(0);
        expect(owners.snapshot().liveRows).toBe(0);
        return owners.snapshot().liveRows;
      } finally {
        session.store.snapshot = snapshot;
        fixture.releaseWriter();
        await operation;
      }
    }),
  );
}
async function pendingWriterFailure(size: number): Promise<number> {
  return withDetachedFixture((fixture) =>
    withRetainedClient(fixture, async ({ client, store }) => {
      const { history, owners } = fixture;
      await seedClientArrayHistory(fixture, size);
      const journal = history.detachedValues.host().journal;
      if (!(journal instanceof JournalHistoryStore))
        throw new Error('Pending writer fixture requires a journal store');
      const failure = new Error('earliest pending writer failure');
      fixture.pauseWriter();
      journal.changeOwnersOf([{ position: 0, origin: 'pending-owner' }]);
      await fixture.writerPaused;
      fixture.io.rejectNextWrite(failure);
      const operation = rejectedValue(
        client.storeHistoryForLaterUse(candidateMediaRows(), {
          ownership: owners,
        }),
      );
      try {
        fixture.releaseWriter();
        expect(await operation).toBe(failure);
        expect(
          await rejectedValue(
            detachedDigest(client.streamHistory()).then(() => undefined),
          ),
        ).toBe(failure);
        expect(await detachedDigest(fixture.primaryRows())).toStrictEqual(
          await detachedDigest(detachedRows(size)),
        );
        expect(history.getTotalTokens()).toBe(size * 4);
        expect(await store.getStoredByteLength()).toBe(0);
        expect(owners.snapshot().liveRows).toBe(0);
        return owners.snapshot().liveRows;
      } finally {
        fixture.releaseWriter();
        await operation;
      }
    }),
  );
}

async function abortPending(size: number): Promise<number> {
  return withDetachedFixture((fixture) =>
    withRetainedClient(fixture, async ({ client }) => {
      await seedClientArrayHistory(fixture, size - 1);
      fixture.history.add(detachedRow(size - 1));
      await fixture.history.waitForTokenUpdates();
      const ready = gate();
      const release = gate();
      await fixture.history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => undefined,
          rollback: () => undefined,
          finalize: async () => {
            ready.resolve();
            await release.promise;
          },
        })),
      );
      forbidClientArrayRollback(fixture);
      const controller = new AbortController();
      const failure = new Error('abort during pending finalization');
      const operation = rejectedValue(
        client.storeHistoryForLaterUse(clientArrayRows(size), {
          ownership: fixture.owners,
          signal: controller.signal,
        }),
      );
      try {
        await Promise.race([
          ready.promise,
          operation.then((error) => {
            throw error;
          }),
        ]);
        expect(boundedOwners(fixture.owners.snapshot())).toBe(true);
        controller.abort(failure);
        // A participant finalizer is not interruptible; the abort is honoured
        // when it settles, and must then roll the whole history back.
        release.resolve();
        expect(
          await Promise.race([operation, setTimeout(1000, 'pinned finalizer')]),
        ).toBe(failure);
        expect(fixture.owners.snapshot().liveRows).toBe(0);
        expect(await detachedDigest(client.streamHistory())).toStrictEqual(
          await detachedDigest(detachedRows(size)),
        );
      } finally {
        release.resolve();
        await operation;
      }
      return fixture.owners.snapshot().liveRows;
    }),
  );
}
function registerParticipant(size: number, retain: boolean): void {
  describe('registerParticipant', () => {
    it(`charges the ${size} copied participant candidate with retain=${retain}`, async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client, store }) => {
          const held: { rows: readonly IContent[] } = { rows: [] };
          let prepared = fixture.owners.snapshot();
          let finalized = fixture.owners.snapshot();
          await fixture.history.registerMediaOwner({
            ...mediaParticipant(() => {
              throw new Error('Participant entered legacy row replacement');
            }),
            prepareReferenceReplacement: async (references) => {
              const rows: IContent[] = [];
              for await (const reference of references) {
                const row: IContent = {
                  speaker: 'human',
                  blocks: [{ ...reference }],
                };
                rows.push(row);
                fixture.owners.retain(row);
              }
              prepared = fixture.owners.snapshot();
              if (retain) held.rows = rows;
              else for (const row of rows) fixture.owners.release(row);
              return {
                publish: () => undefined,
                rollback: () => undefined,
                finalize: () => {
                  finalized = fixture.owners.snapshot();
                  throw new Error('participant checkpoint');
                },
              };
            },
          });
          forbidClientArrayRollback(fixture);
          try {
            expect(
              await withClientOracle(store, candidateMediaRows(), (admitted) =>
                rejectedValue(
                  client.storeHistoryForLaterUse(
                    clientArrayRows(size).map((row) => ({
                      ...row,
                      blocks: [...row.blocks, ...admitted[0].blocks],
                    })),
                    { ownership: fixture.owners },
                  ),
                ),
              ),
            ).toBeInstanceOf(Error);
            expect(prepared.liveRows).toBeGreaterThanOrEqual(size);
            if (retain) expect(finalized.liveRows).toBeGreaterThan(440);
            expect(boundedOwners(finalized)).toBe(
              retain ? process.env.RETAINED_PARTICIPANT_TRAP === '1' : true,
            );
            recordClientProof({
              kind: 'participant',
              size,
              retain,
              prepared,
              finalized,
            });
          } finally {
            for (const row of held.rows) fixture.owners.release(row);
            held.rows = [];
          }
          expect(fixture.owners.snapshot().liveRows).toBe(0);
        }),
      );
    }, 180_000);
  });
}
export function registerRetainedParticipantControl(): void {
  registerParticipant(512, true);
}

export function registerRetainedBoundaryCases(
  sizes: readonly number[],
  phases: readonly string[],
): void {
  describe('retained array pending acquisition and participant boundaries', () => {
    for (const size of sizes) {
      if (phases.includes('pending')) {
        it(`preserves pending snapshot failure and every original value without admitting candidate media at ${size}`, async () => {
          expect(await earliestPendingFailure(size)).toBe(0);
        }, 180_000);
        it(`preserves earliest pending writer failure and every durable value without admitting candidate media at ${size}`, async () => {
          expect(await pendingWriterFailure(size)).toBe(0);
        }, 180_000);
      }
      if (phases.includes('abort')) {
        it(`aborts a ${size}-row stored history during pending finalization`, async () => {
          expect(await abortPending(size)).toBe(0);
        }, 180_000);
      }
      if (phases.includes('participant')) {
        registerParticipant(size, false);
      }
    }
  });
}
