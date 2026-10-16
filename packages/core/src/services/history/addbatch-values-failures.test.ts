/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { setImmediate } from 'node:timers/promises';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';
import {
  exactTokenizer,
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
} from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

async function collectedRows(
  probes: ReadonlyArray<WeakRef<IContent>>,
): Promise<number> {
  for (let index = 0; index < 8; index++) {
    await setImmediate();
    gcAndSweep();
  }
  await setImmediate();
  return probes.filter((probe) => probe.deref() !== undefined).length;
}

async function admissionFailure(
  size: number,
  prefix: number,
): Promise<number | undefined> {
  return withDetachedFixture(async ({ history, recorder, owners }) => {
    await history.replaceBatch([
      detachedRow(0),
      detachedRow(1),
      detachedRow(2),
    ]);
    const before = await detachedDigest(detachedRows(3));
    let input = Array.from({ length: size }, (_, index) =>
      detachedRow(index + 3),
    );
    const weak = input.map((row) => new WeakRef(row));
    recorder.failAdmissionAfter(prefix);
    const operation = history.addBatch(input);
    input = [];
    expect(await rejectedValue(operation)).toBe(recorder.failure);
    expect(await collectedRows(weak)).toBe(0);
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.snapshot().liveSerializedBytes).toBe(0);
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      before,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
    expect(history.getTotalTokens()).toBe(12);
    const following = rollbackRow(3);
    await history.addBatch([following]);
    const stored = await rowsOf(history);
    expect(following.metadata).toBeUndefined();
    return stored[3]?.metadata?.chronology?.seq;
  });
}

describe('value append admission prefix failures', () => {
  for (const size of [512, 8192]) {
    for (const prefix of [0, 1, 2]) {
      it(`recovers durable prefix and counters after ${prefix} of ${size} append admissions`, async () => {
        expect(await admissionFailure(size, prefix)).toBe(4);
      }, 180_000);
    }
  }
});

async function stageFailure(stage: string): Promise<number | undefined> {
  return withDetachedFixture(async ({ history, recorder, owners }) => {
    await history.addBatch([detachedRow(0)]);
    const before = await detachedDigest(detachedRows(1));
    const failure = new Error('value append ' + stage);
    let failed = false;
    const fail = (): void => {
      if (failed) return;
      failed = true;
      throw failure;
    };
    if (stage === 'tokenizer')
      history.setTokenizerFactory(exactTokenizer(fail));
    history.registerMediaOwner(
      mediaParticipant(() => {
        if (stage === 'prepare') fail();
        return {
          publish: () => {
            if (stage === 'publish') fail();
          },
          rollback: () => undefined,
          finalize: () => {
            if (stage === 'finalize') fail();
          },
        };
      }),
    );
    if (
      stage === 'contentBatchAdded' ||
      stage === 'tokensUpdated' ||
      stage === 'contextRangeChanged'
    )
      history.once(stage, fail);
    const caller = rollbackRow(1);
    expect(
      await rejectedValue(
        history.addBatch([caller], undefined, {
          afterPublication: () => {
            if (stage === 'afterPublication') fail();
          },
        }),
      ),
    ).toBe(failure);
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      before,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(before);
    expect(history.getTotalTokens()).toBe(4);
    expect(caller.metadata).toBeUndefined();
    expect(owners.snapshot().liveRows).toBe(0);
    history.setTokenizerFactory(exactTokenizer());
    await history.addBatch([caller]);
    expect(caller.metadata).toBeUndefined();
    return (await rowsOf(history))[1]?.metadata?.chronology?.seq;
  });
}

describe('value append failure stages', () => {
  for (const stage of [
    'tokenizer',
    'prepare',
    'publish',
    'contentBatchAdded',
    'tokensUpdated',
    'afterPublication',
    'finalize',
    'contextRangeChanged',
  ]) {
    it(`restores durable values after ${stage} failure without caller rollback`, async () => {
      expect(await stageFailure(stage)).toBe(2);
    });
  }
});
