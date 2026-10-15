/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
  type Mock,
} from 'bun:test';
import { FanoutHarness, textRow } from './__tests__/support/fanout-harness.js';
import type { HistoryService } from './HistoryService.js';
import { HistoryJournalStore } from './historyJournalStore.js';

const harness = new FanoutHarness();

/**
 * A cursor over the journal folds every byte of it, so a mutation that opens
 * one on each send pays a cost that grows with the length of the journal. The
 * capture that backs a rollback must take row origins from the fold the
 * mutation already runs, which resumes from a checkpoint.
 */
describe('a detached mutation does not fold the whole journal to capture row origins', () => {
  let cursorFold: Mock<typeof HistoryJournalStore.prototype.withReadRowsOf>;

  beforeEach(async () => {
    await harness.setup();
    cursorFold = spyOn(HistoryJournalStore.prototype, 'withReadRowsOf');
  });
  afterEach(async () => {
    cursorFold.mockRestore();
    await harness.teardown();
  });

  async function seeded(): Promise<HistoryService> {
    const service = harness.history();
    await service.attachJournal(harness.recorder('a'), true);
    service.add(textRow('first'));
    service.add(textRow('second', 'ai'));
    await service.waitForCommit();
    return service;
  }

  it('for an appended batch', async () => {
    const service = await seeded();

    await service.addBatch([textRow('third')]);
    await service.waitForCommit();

    expect(cursorFold).not.toHaveBeenCalled();
  });

  it('for a mutation that fails and is rolled back', async () => {
    const service = await seeded();

    await expect(
      service.replaceBatch([], undefined, {
        afterPublication: () => {
          throw new Error('observer rejected the mutation');
        },
      }),
    ).rejects.toThrow('observer rejected the mutation');
    await service.waitForCommit();

    expect(cursorFold).not.toHaveBeenCalled();
  });

  it('and a rollback after earlier mutations restores the origin of every row', async () => {
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
