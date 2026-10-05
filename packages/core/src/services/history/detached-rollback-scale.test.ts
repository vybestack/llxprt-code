/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { appendFileSync } from 'node:fs';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
} from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import type { RowOwnershipStats } from '../../recording/rowOwnership.js';

const limits = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
function record(value: object): void {
  const path = process.env.DETACHED_ROLLBACK_OUTPUT;
  if (path !== undefined) appendFileSync(path, JSON.stringify(value) + '\n');
}
function bounded(stats: RowOwnershipStats): boolean {
  return (
    stats.liveRows <= limits.rows &&
    stats.liveSerializedBytes <= limits.serializedBytes
  );
}

async function arraySubmission(size: number): Promise<number> {
  return withDetachedFixture(async ({ history, recorder, owners }) => {
    const submitted = {
      rows: Array.from({ length: size }, (_, index) => detachedRow(index)),
    };
    let acknowledged: RowOwnershipStats | undefined;
    const failure = new Error('post ack rejection');
    const operation = history.detachedValues.replace(
      submitted.rows,
      undefined,
      {
        onAcknowledged: () => {
          acknowledged = owners.snapshot();
          throw failure;
        },
      },
    );
    const pre = owners.snapshot();
    expect(pre.liveRows).toBe(size);
    expect(pre.liveSerializedBytes).toBeGreaterThan(size * 2048);
    submitted.rows = [];
    expect(await rejectedValue(operation)).toBe(failure);
    if (acknowledged === undefined) throw new Error('Missing acknowledgement');
    expect(bounded(acknowledged)).toBe(true);
    expect(history.getContextRange().totalEntries).toBe(0);
    expect((await detachedDurableDigest(recorder)).count).toBe(0);
    expect(owners.snapshot().liveRows).toBe(0);
    record({ kind: 'array', size, pre, acknowledged });
    return pre.liveRows;
  });
}

async function rollbackScale(size: number, stage: string): Promise<number> {
  return withDetachedFixture(async ({ history, recorder, owners }) => {
    await history.detachedValues.replace(detachedRows(size));
    const expected = await detachedDigest(detachedRows(size));
    const failure = new Error('post ack');
    let held: RowOwnershipStats | undefined;
    if (stage !== 'ack') recorder.failAdmissionAfter(stage === 'zero' ? 0 : 2);
    const result = await rejectedValue(
      history.detachedValues.transform(
        async (source, sink) => {
          for await (const row of source.streamRows())
            sink.appendValue({
              ...row,
              metadata: { ...row.metadata, turnId: 'changed' },
            });
        },
        undefined,
        {
          onAcknowledged: () => {
            held = owners.snapshot();
            throw failure;
          },
        },
      ),
    );
    expect(result).toBe(stage === 'ack' ? failure : recorder.failure);
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      expected,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
    expect(history.getTotalTokens()).toBe(size * 4);
    expect(owners.snapshot().liveRows).toBe(0);
    if (stage === 'ack' && held === undefined)
      throw new Error('Missing ack census');
    expect(bounded(held ?? owners.snapshot())).toBe(true);
    record({
      kind: 'rollback',
      size,
      stage,
      held,
      expected,
      cleanup: owners.snapshot(),
    });
    return expected.count;
  });
}

async function pendingScale(size: number): Promise<number> {
  return withDetachedFixture(
    async ({ history, recorder, owners, releaseWriter }) => {
      for (let index = 0; index < size; index++)
        history.add(detachedRow(index));
      await history.waitForTokenUpdates();
      let ack: RowOwnershipStats | undefined;
      const failure = new Error('pending source rollback');
      const operation = rejectedValue(
        history.detachedValues.transform(
          async (source, sink) => {
            for await (const row of source.streamRows()) sink.appendValue(row);
          },
          undefined,
          {
            onAcknowledged: () => {
              ack = owners.snapshot();
              throw failure;
            },
          },
        ),
      );
      try {
        while (owners.snapshot().liveRows < size) await setImmediate();
        const pre = owners.snapshot();
        expect(pre.liveRows).toBeGreaterThanOrEqual(size);
        expect(pre.liveSerializedBytes).toBeGreaterThan(size * 2048);
        releaseWriter();
        expect(await operation).toBe(failure);
        if (ack === undefined) throw new Error('Missing ack census');
        expect(bounded(ack)).toBe(true);
        const expected = await detachedDigest(detachedRows(size));
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
        expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
        expect(owners.snapshot().liveRows).toBe(0);
        record({ kind: 'pending', size, pre, ack, expected });
        return expected.count;
      } finally {
        releaseWriter();
        await operation;
      }
    },
    true,
  );
}

for (const size of [512, 8192]) {
  describe('detached acknowledged live ownership', () => {
    it(`charges ${size} accepted borrowed array inputs before capture and releases them before acknowledgement`, async () => {
      expect(await arraySubmission(size)).toBe(size);
    }, 180_000);
    for (const stage of ['zero', 'prefix', 'ack']) {
      it(`restores all ${size} mixed source values after ${stage} admission failure`, async () => {
        expect(await rollbackScale(size, stage)).toBe(size);
      }, 180_000);
    }
    it(`charges a ${size}-row pending original source before its recording ack without retaining it after ack`, async () => {
      expect(await pendingScale(size)).toBe(size);
    }, 180_000);
  });
}

describe('live near-limit retained participant controls', () => {
  const traps: ReadonlyArray<readonly [string, number, number]> = [
    ['objects', 441, 0],
    ['bytes', 439, Math.floor((8 * 1024 * 1024) / 439) + 1],
  ];
  for (const [kind, count, bytes] of traps) {
    it(`counts a participant's near-limit ${kind} retention at the live acknowledgement gate`, async () => {
      await withDetachedFixture(async ({ history, owners }) => {
        const retained: IContent[] = [];
        const failure = new Error('trap rollback');
        let held: RowOwnershipStats | undefined;
        history.registerMediaOwner(
          mediaParticipant(() => {
            for (let index = 0; index < count; index++) {
              const row = detachedRow(index, bytes);
              retained.push(row);
              owners.retain(row);
            }
            return {
              publish: () => undefined,
              rollback: () => {
                for (const row of retained) owners.release(row);
                retained.length = 0;
              },
            };
          }),
        );
        expect(
          await rejectedValue(
            history.detachedValues.replace(detachedRows(1), undefined, {
              onAcknowledged: () => {
                held = owners.snapshot();
                throw failure;
              },
            }),
          ),
        ).toBe(failure);
        if (held === undefined) throw new Error('Missing trap census');
        expect(bounded(held)).toBe(false);
        const ratio =
          kind === 'objects'
            ? held.liveRows / limits.rows
            : held.liveSerializedBytes / limits.serializedBytes;
        expect(ratio).toBeGreaterThan(1);
        expect(owners.snapshot().liveRows).toBe(0);
        record({ kind: 'trap', dimension: kind, held });
      });
    });
  }
});
