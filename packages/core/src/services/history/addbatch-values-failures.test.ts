/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  exactTokenizer,
  journalMediaParticipant as mediaParticipant,
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
    await history.registerMediaOwner(
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
