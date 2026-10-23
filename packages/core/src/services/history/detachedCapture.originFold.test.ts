/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { FanoutHarness, textRow } from './__tests__/support/fanout-harness.js';

const harness = new FanoutHarness();

describe('detached rollback row ownership', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());
  it('restores the origin of every row on rollback after earlier mutations', async () => {
    const service = harness.history();
    const ownerA = {};
    const ownerB = {};
    await service.attachJournal(harness.recorder('a'), true, undefined, ownerA);
    await service.attachJournal(harness.recorder('b'), true, undefined, ownerB);
    service.add(textRow('A-only'), undefined, ownerA);
    service.add(textRow('shared'));
    service.add(textRow('B-only'), undefined, ownerB);
    await service.waitForCommit();
    // Each earlier mutation folds from the checkpoint the one before it saved.
    await service.addBatch([textRow('A-tail')], undefined, { origin: ownerA });
    await service.addBatch([textRow('B-tail')], undefined, { origin: ownerB });
    await service.waitForCommit();

    await expect(
      service.replaceBatch([], undefined, {
        afterPublication: () => {
          throw new Error('observer rejected the mutation');
        },
      }),
    ).rejects.toThrow('observer rejected the mutation');
    await service.waitForCommit();

    const third = harness.recorder('third');
    const laterB = harness.recorder('later-b');
    await service.attachJournal(third, true, undefined, {});
    await service.attachJournal(laterB, true, undefined, ownerB);
    await service.waitForCommit();
    expect(await harness.replayed(third)).toStrictEqual(['shared']);
    expect(await harness.replayed(laterB)).toStrictEqual([
      'shared',
      'B-only',
      'B-tail',
    ]);
  });
});
