/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { getScratchRoot } from '../../storage/scratch-root.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  rejectedValue,
  rollbackRow,
  rowsOf,
} from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedRows,
} from './detached-rollback-test-helpers.js';
import type {
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';

function mediaParticipant(
  prepare: () => PreparedHistoryBatchEffect,
): HistoryMediaOwner {
  return {
    prepareReferenceAddition: prepare,
    prepareReferenceReplacement: prepare,
    prepareReplacement: prepare,
    adopt: () => undefined,
    reconcile: async () => undefined,
    releaseAll: async () => undefined,
  };
}

function scratch(): string[] {
  return readdirSync(getScratchRoot()).filter((name) =>
    name.startsWith('history-detached-'),
  );
}

const backends = ['journal'];

describe.each([...backends])('opt-in detached rollback contract on %s', () => {
  it('accepts frozen caller metadata and repeated aliases without stamping caller values', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      const caller = {
        ...rollbackRow(0),
        metadata: Object.freeze({ id: 'alias' }),
      };
      await history.detachedValues.replace([caller, caller]);
      const stored = await rowsOf(history);
      expect(caller.metadata).toStrictEqual({ id: 'alias' });
      expect(stored.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
        1, 2,
      ]);
      expect(stored.map((row) => row.blocks)).toStrictEqual([
        rollbackRow(0).blocks,
        rollbackRow(0).blocks,
      ]);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});

for (const stage of [
  'capture',
  'prepare',
  'publish',
  'ack',
  'finalize',
  'cancel',
]) {
  describe('detached failure compensation', () => {
    it(`restores immutable values and scalars after ${stage}`, async () => {
      await withNativeDetachedFixture(
        async ({ history, primaryRows, owners }) => {
          await history.detachedValues.replace(detachedRows(6));
          const expected = await detachedDigest(detachedRows(6));
          const tokens = 6 * 4;
          const range = {
            firstSeq: 1,
            lastSeq: 6,
            totalEntries: 6,
            removedInterior: [],
            approximate: false,
          };
          const dirs = scratch();
          const failure = new Error(stage);
          const controller = new AbortController();
          if (stage === 'prepare')
            await history.registerMediaOwner(
              mediaParticipant(() => {
                throw failure;
              }),
            );
          if (stage === 'publish' || stage === 'finalize')
            await history.registerMediaOwner(
              mediaParticipant(() => ({
                publish: () => {
                  if (stage === 'publish') throw failure;
                },
                finalize: () => {
                  if (stage === 'finalize') throw failure;
                },
                rollback: () => undefined,
              })),
            );
          const result = await rejectedValue(
            history.detachedValues.transform(
              async (source, sink) => {
                for await (const row of source.streamRows()) {
                  await sink.appendValue({
                    ...row,
                    blocks: [{ type: 'text', text: 'candidate' }],
                  });
                  if (stage === 'capture') throw failure;
                }
              },
              undefined,
              {
                signal: controller.signal,
                onAcknowledged: () => {
                  if (stage === 'ack') throw failure;
                  if (stage === 'cancel') controller.abort(failure);
                },
              },
            ),
          );
          expect(result).toBe(failure);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await detachedDigest(primaryRows())).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(tokens);
          expect(history.getContextRange()).toStrictEqual(range);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(
            scratch().filter((name) => !dirs.includes(name)),
          ).toStrictEqual([]);
        },
      );
    });
  });
}

describe('detached scalar and large-value recovery', () => {
  it.each([...backends])(
    'restores chronology counters after rejection and accepts a nine-MiB value on %s',
    async () => {
      await withNativeDetachedFixture(async ({ history, durable }) => {
        const caller = rollbackRow(0, 9 * 1024 * 1024);
        const failure = new Error('large rejection');
        expect(
          await rejectedValue(
            history.detachedValues.replace([caller], undefined, {
              onAcknowledged: () => {
                throw failure;
              },
            }),
          ),
        ).toBe(failure);
        expect(caller.metadata).toBeUndefined();
        expect(history.getContextRange().totalEntries).toBe(0);
        expect((await durable()).count).toBe(0);
        await history.detachedValues.replace([caller]);
        const stored = await rowsOf(history);
        expect(stored[0].metadata?.chronology?.seq).toBe(1);
        expect(stored[0].blocks).toStrictEqual(
          rollbackRow(0, 9 * 1024 * 1024).blocks,
        );
        expect((await durable()).bytes).toBeGreaterThan(9 * 1024 * 1024);
      });
    },
    180_000,
  );
});
