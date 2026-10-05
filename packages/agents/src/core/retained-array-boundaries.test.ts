/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '../../../core/src/services/history/HistoryService.js';
import { RowOwnership } from '../../../core/src/recording/rowOwnership.js';
import {
  AdmissionFailureRecorder,
  exactTokenizer,
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import { withRetainedClient } from './retained-array-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
  recordClientProof,
} from './client-array-test-helpers.js';
import { boundedOwners, gate } from './conversation-array-test-helpers.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';

async function earliestPendingFailure(size: number): Promise<number> {
  const root = await mkdtemp(join(tmpdir(), 'retained-failure-'));
  const release = gate();
  const failure = new Error('earliest pending writer failure');
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'retained',
    projectHash: 'retained',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (): Promise<void> => {
        await release.promise;
        throw failure;
      },
    },
  });
  const owners = new RowOwnership();
  const history = new HistoryService({
    recording: recorder,
    mutationOwnership: owners,
  });
  history.setTokenizerFactory(exactTokenizer());
  try {
    return await withRetainedClient(
      { history, recorder, owners, releaseWriter: release.resolve },
      async ({ client, store }) => {
        for (let index = 0; index < size; index++)
          history.add(detachedRow(index));
        await history.waitForTokenUpdates();
        const controller = new AbortController();
        const operation = rejectedValue(
          client.storeHistoryForLaterUse(clientArrayRows(size), {
            ownership: owners,
            signal: controller.signal,
          }),
        );
        release.resolve();
        expect(await operation).toBe(failure);
        expect(await detachedDigest(client.streamHistory())).toStrictEqual(
          await detachedDigest(detachedRows(size)),
        );
        expect(history.getTotalTokens()).toBe(size * 4);
        expect(await store.getStoredByteLength()).toBe(0);
        expect(owners.snapshot().liveRows).toBe(0);
        return owners.snapshot().liveRows;
      },
    );
  } finally {
    release.resolve();
    history.dispose();
    await recorder.dispose();
    await rm(root, { recursive: true, force: true });
  }
}
async function abortPending(size: number): Promise<number> {
  return withDetachedFixture(
    (fixture) =>
      withRetainedClient(fixture, async ({ client }) => {
        for (let index = 0; index < size; index++)
          fixture.history.add(detachedRow(index));
        await fixture.history.waitForTokenUpdates();
        const controller = new AbortController();
        const failure = new Error('abort before pending ack');
        const operation = rejectedValue(
          client.storeHistoryForLaterUse(clientArrayRows(size), {
            ownership: fixture.owners,
            signal: controller.signal,
          }),
        );
        try {
          while (fixture.owners.snapshot().liveRows < size * 2)
            await setImmediate();
          controller.abort(failure);
          expect(
            await Promise.race([operation, setTimeout(1000, 'pinned writer')]),
          ).toBe(failure);
          expect(fixture.owners.snapshot().liveRows).toBe(0);
          expect(await detachedDigest(client.streamHistory())).toStrictEqual(
            await detachedDigest(detachedRows(size)),
          );
        } finally {
          fixture.releaseWriter();
          await operation;
        }
        return fixture.owners.snapshot().liveRows;
      }),
    true,
  );
}
function registerParticipant(size: number, retain: boolean): void {
  describe('registerParticipant', () => {
    it(`charges the ${size} copied participant candidate with retain=${retain}`, async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client }) => {
          const held: { rows: readonly IContent[] } = { rows: [] };
          let prepared = fixture.owners.snapshot();
          let finalized = fixture.owners.snapshot();
          fixture.history.registerMediaOwner(
            mediaParticipant(({ next }) => {
              const rows = [...next];
              for (const row of rows) fixture.owners.retain(row);
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
            }),
          );
          forbidClientArrayRollback(fixture);
          try {
            expect(
              await rejectedValue(
                client.storeHistoryForLaterUse(clientArrayRows(size), {
                  ownership: fixture.owners,
                }),
              ),
            ).toBeInstanceOf(Error);
            expect(prepared.liveRows).toBeGreaterThanOrEqual(size);
            expect(boundedOwners(finalized)).toBe(!retain);
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
describe('retained array pending acquisition and participant boundaries', () => {
  for (const size of [512, 8192]) {
    it(`preserves earliest pending failure and does not admit candidate media at ${size}`, async () => {
      expect(await earliestPendingFailure(size)).toBe(0);
    }, 180_000);
    it(`aborts ${size} pending owners before writer acknowledgement`, async () => {
      expect(await abortPending(size)).toBe(0);
    }, 180_000);
    for (const retain of [false, true]) registerParticipant(size, retain);
  }
});
