/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
} from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';

function scratch(): string[] {
  return readdirSync(tmpdir()).filter((name) =>
    name.startsWith('history-detached-'),
  );
}

describe('opt-in detached rollback contract', () => {
  it('accepts frozen caller metadata and repeated aliases without stamping caller values', async () => {
    await withDetachedFixture(async ({ history, owners }) => {
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
  'admission-zero',
  'admission-prefix',
  'ack',
  'finalize',
  'cancel',
]) {
  describe('detached failure compensation', () => {
    it(`restores immutable values and scalars after ${stage}`, async () => {
      await withDetachedFixture(async ({ history, recorder, owners }) => {
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
          history.registerMediaOwner(
            mediaParticipant(() => {
              throw failure;
            }),
          );
        if (stage === 'publish' || stage === 'finalize')
          history.registerMediaOwner(
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
        if (stage.startsWith('admission'))
          recorder.failAdmissionAfter(stage === 'admission-zero' ? 0 : 2);
        const result = await rejectedValue(
          history.detachedValues.transform(
            async (source, sink) => {
              for await (const row of source.streamRows()) {
                sink.appendValue({
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
        expect(result).toBe(
          stage.startsWith('admission') ? recorder.failure : failure,
        );
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
        expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
        expect(history.getTotalTokens()).toBe(tokens);
        expect(history.getContextRange()).toStrictEqual(range);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(scratch().filter((name) => !dirs.includes(name))).toStrictEqual(
          [],
        );
      });
    });
  });
}

describe('detached scalar and large-value recovery', () => {
  it('restores chronology counters after rejection and accepts a nine-MiB value', async () => {
    await withDetachedFixture(async ({ history, recorder }) => {
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
      await history.detachedValues.replace([caller]);
      const stored = await rowsOf(history);
      expect(stored[0].metadata?.chronology?.seq).toBe(1);
      expect(stored[0].blocks).toStrictEqual(
        rollbackRow(0, 9 * 1024 * 1024).blocks,
      );
      expect((await detachedDurableDigest(recorder)).bytes).toBeGreaterThan(
        9 * 1024 * 1024,
      );
    });
  }, 180_000);

  it('restores scalars and rolls back participants even when compensation fails', async () => {
    await withDetachedFixture(async ({ history, recorder }) => {
      await history.detachedValues.replace([detachedRow(0)]);
      const tokens = 4;
      const failure = new Error('publication');
      const rollbackFailure = new Error('participant rollback');
      history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => undefined,
          rollback: () => {
            throw rollbackFailure;
          },
        })),
      );
      const result = await rejectedValue(
        history.detachedValues.replace([rollbackRow(1)], undefined, {
          onAcknowledged: () => {
            recorder.failAdmissionAfter(0);
            throw failure;
          },
        }),
      );
      expect(result).toBeInstanceOf(AggregateError);
      if (!(result instanceof AggregateError))
        throw new Error('Expected aggregate');
      expect(result.errors).toStrictEqual([
        failure,
        recorder.failure,
        rollbackFailure,
      ]);
      expect(history.getTotalTokens()).toBe(tokens);
      await history.detachedValues.replace([rollbackRow(2)]);
      expect((await rowsOf(history))[0].metadata?.chronology?.seq).toBe(2);
    });
  });
});
