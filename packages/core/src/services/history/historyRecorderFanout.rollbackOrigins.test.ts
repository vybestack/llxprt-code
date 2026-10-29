/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { JournalOwners } from './journalOwners.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  FanoutHarness,
  rowText,
  textRow,
} from './__tests__/support/fanout-harness.js';
import type { HistoryService } from './HistoryService.js';
import { historyOriginId } from './historyOriginId.js';

const harness = new FanoutHarness();

const OBSERVER_FAILURE = 'observer rejected the mutation';

/** Runs `mutation` with a token observer that rejects it, then removes the observer. */
async function withRejectingObserver(
  service: HistoryService,
  mutation: () => unknown,
): Promise<void> {
  const reject = (): never => {
    throw new Error(OBSERVER_FAILURE);
  };
  let failure: unknown;
  service.on('tokensUpdated', reject);
  try {
    await mutation();
  } catch (error) {
    failure = error;
  } finally {
    service.off('tokensUpdated', reject);
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure instanceof Error ? failure.message : '').toContain(
    OBSERVER_FAILURE,
  );
  await service.waitForCommit();
}

async function ownedRows(
  recording: JournalRecordingService,
): Promise<Array<{ text: string; origin?: string }>> {
  const session = await recording.session();
  const owners = new JournalOwners(session.store);
  const rows: Array<{ text: string; origin?: string }> = [];
  for await (const { entry, content } of session.rows()) {
    const origin = await owners.originOf(entry.owner);
    rows.push({
      text: rowText(content),
      ...(origin === undefined ? {} : { origin }),
    });
  }
  return rows;
}

describe('a failed /clear keeps the origin of every restored row', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  it('leaves a later recorder without foreign rows when nothing failed (control)', async () => {
    const service = harness.history();
    const ownerA = {};
    await service.attachJournal(harness.recorder('a'), true, undefined, ownerA);
    service.add(textRow('private to A'), undefined, ownerA);
    await service.waitForCommit();

    const b = harness.recorder('b');
    await service.attachJournal(b, true, undefined, {});
    await service.waitForCommit();

    expect(await harness.replayed(b)).toStrictEqual([]);
  });

  it('keeps an owned row out of a recorder attached after the rollback', async () => {
    const service = harness.history();
    const ownerA = {};
    const a = harness.recorder('a');
    await service.attachJournal(a, true, undefined, ownerA);
    service.add(textRow('private to A'), undefined, ownerA);
    await service.waitForCommit();

    await withRejectingObserver(service, () => service.clear());

    const b = harness.recorder('b');
    await service.attachJournal(b, true, undefined, {});
    await service.waitForCommit();

    expect(await harness.replayed(b)).toStrictEqual([]);
    expect(await harness.replayed(a)).toStrictEqual(['private to A']);
  });

  it('keeps the origin of rows that were not yet durable when the clear failed', async () => {
    const service = harness.history();
    const ownerA = {};
    const a = harness.recorder('a');
    await service.attachJournal(a, true, undefined, ownerA);
    service.add(textRow('private to A'), undefined, ownerA);

    await withRejectingObserver(service, () => service.clear());

    const b = harness.recorder('b');
    await service.attachJournal(b, true, undefined, {});
    await service.waitForCommit();

    expect(await harness.replayed(b)).toStrictEqual([]);
    expect(await harness.replayed(a)).toStrictEqual(['private to A']);
  });

  it('restores a mix of owned and unowned rows, each under its own origin', async () => {
    const service = harness.history();
    const ownerA = {};
    service.add(textRow('shared before'));
    const a = harness.recorder('a');
    await service.attachJournal(a, true, undefined, ownerA);
    service.add(textRow('private to A'), undefined, ownerA);
    service.add(textRow('shared after'));
    service.add(textRow('also private to A'), undefined, ownerA);
    await service.waitForCommit();

    await withRejectingObserver(service, () => service.clear());

    const b = harness.recorder('b');
    await service.attachJournal(b, true, undefined, {});
    await service.waitForCommit();

    expect(await harness.replayed(b)).toStrictEqual([
      'shared before',
      'shared after',
    ]);
    expect(await harness.replayed(a)).toStrictEqual([
      'shared before',
      'private to A',
      'shared after',
      'also private to A',
    ]);
  });

  it('writes the restored rows to disk under their original origins', async () => {
    const service = harness.history();
    const ownerA = {};
    service.add(textRow('shared'));
    const a = harness.recorder('a');
    await service.attachJournal(a, true, undefined, ownerA);
    service.add(textRow('private to A'), undefined, ownerA);
    await service.waitForCommit();

    await withRejectingObserver(service, () => service.clear());
    await a.flush();

    const path = a.getFilePath();
    if (path === null) throw new Error('The recording has no journal file');
    const restored = (await ownedRows(a)).slice(-2);
    expect(restored).toStrictEqual([
      { text: 'shared' },
      { text: 'private to A', origin: historyOriginId(ownerA) },
    ]);
  });

  it('keeps every origin separate when the rollback happens with fan-out active', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    service.add(textRow('private to A'), undefined, ownerA);
    service.add(textRow('private to B'), undefined, ownerB);
    await service.waitForCommit();

    await withRejectingObserver(service, () => service.clear());

    const c = harness.recorder('c');
    await service.attachJournal(c, true, undefined, {});
    await service.waitForCommit();
    service.add(textRow('later A'), undefined, ownerA);
    await service.waitForCommit();

    expect(await harness.replayed(c)).toStrictEqual(['seed']);
    expect(await harness.replayed(a)).toStrictEqual([
      'seed',
      'private to A',
      'later A',
    ]);
    expect(await harness.replayed(b)).toStrictEqual(['seed', 'private to B']);
    expect((await harness.shared(service)).map(rowText)).toStrictEqual([
      'seed',
      'private to A',
      'private to B',
      'later A',
    ]);
  });
});

describe('a failed tail removal keeps the origin of the restored row', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  it('keeps the popped row owned when its removal is rolled back', async () => {
    const service = harness.history();
    const ownerA = {};
    service.add(textRow('shared'));
    const a = harness.recorder('a');
    await service.attachJournal(a, true, undefined, ownerA);
    service.add(textRow('private to A'), undefined, ownerA);
    await service.waitForCommit();

    await withRejectingObserver(service, () => service.pop());

    const b = harness.recorder('b');
    await service.attachJournal(b, true, undefined, {});
    await service.waitForCommit();

    expect(await harness.replayed(b)).toStrictEqual(['shared']);
    expect(await harness.replayed(a)).toStrictEqual(['shared', 'private to A']);
  });

  it('keeps the popped row owned when fan-out is active', async () => {
    const { service, ownerA, ownerB, a, b } = await harness.twoOrigins();
    service.add(textRow('private to B'), undefined, ownerB);
    service.add(textRow('private to A'), undefined, ownerA);
    await service.waitForCommit();

    await withRejectingObserver(service, () => service.pop());

    const c = harness.recorder('c');
    await service.attachJournal(c, true, undefined, {});
    await service.waitForCommit();

    expect(await harness.replayed(c)).toStrictEqual(['seed']);
    expect(await harness.replayed(a)).toStrictEqual(['seed', 'private to A']);
    expect(await harness.replayed(b)).toStrictEqual(['seed', 'private to B']);
  });
});
