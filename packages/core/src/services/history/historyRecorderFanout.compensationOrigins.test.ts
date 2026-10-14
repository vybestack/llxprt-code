/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  FanoutHarness,
  rowText,
  textRow,
} from './__tests__/support/fanout-harness.js';
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import type { HistoryRowTransform } from './historyRowTransform.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { HistoryValidationRepair } from './historyValidationRepair.js';

const harness = new FanoutHarness();

const OBSERVER_FAILURE = 'observer rejected the mutation';

interface MixedOwners {
  readonly service: HistoryService;
  readonly ownerA: object;
  readonly ownerB: object;
}

/**
 * [A-only, shared, B-only, A-tail]. With `fanout` the second origin is already
 * attached when the rows are written, so a mirror holds its rows live.
 */
async function seedMixedRows(
  fanout: boolean,
  pending: boolean,
): Promise<MixedOwners> {
  const service = harness.history();
  const ownerA = {};
  const ownerB = {};
  await service.attachJournal(harness.recorder('a'), true, undefined, ownerA);
  if (fanout)
    await service.attachJournal(harness.recorder('b'), true, undefined, ownerB);
  service.add(textRow('A-only'), undefined, ownerA);
  service.add(textRow('shared'));
  service.add(textRow('B-only'), undefined, ownerB);
  service.add(textRow('A-tail'), undefined, ownerA);
  if (!pending) await service.waitForCommit();
  return { service, ownerA, ownerB };
}

/** What a recorder attached after the failure replays for each origin. */
async function laterReplays(
  service: HistoryService,
  ownerB: object,
): Promise<{ readonly thirdOrigin: string[]; readonly originalB: string[] }> {
  const third = harness.recorder('third');
  const laterB = harness.recorder('later-b');
  await service.attachJournal(third, true, undefined, {});
  await service.attachJournal(laterB, true, undefined, ownerB);
  await service.waitForCommit();
  return {
    thirdOrigin: await harness.replayed(third),
    originalB: await harness.replayed(laterB),
  };
}

describe('a failed batch clear keeps the origin of every restored row', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  const cases = [false, true].flatMap((fanout) =>
    [false, true].flatMap((pending) =>
      [false, true].map((named) => ({ fanout, pending, named })),
    ),
  );

  for (const { fanout, pending, named } of cases) {
    const label = `fanout=${fanout}, pending=${pending}, origin ${named ? 'named' : 'absent'}`;
    it(`restores each row under its own origin (${label})`, async () => {
      const { service, ownerA, ownerB } = await seedMixedRows(fanout, pending);

      await expect(
        service.replaceBatch([], undefined, {
          ...(named ? { origin: ownerA } : {}),
          afterPublication: () => {
            throw new Error(OBSERVER_FAILURE);
          },
        }),
      ).rejects.toThrow(OBSERVER_FAILURE);
      await service.waitForCommit();

      expect(await laterReplays(service, ownerB)).toStrictEqual({
        thirdOrigin: ['shared'],
        originalB: ['shared', 'B-only'],
      });
    });
  }
});

/** Rewrites every row's text, so the mutation replaces all of the history. */
const rewriteEveryRow: HistoryRowTransform = async (source, sink) => {
  for await (const entry of source.streamRows())
    sink.appendDetached(textRow(`rewritten ${rowText(entry.row)}`));
};

describe('a failed row transform keeps the origin of every restored row', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  const cases = [false, true].flatMap((fanout) =>
    [false, true].flatMap((pending) =>
      [false, true].map((named) => ({ fanout, pending, named })),
    ),
  );

  for (const { fanout, pending, named } of cases) {
    const label = `fanout=${fanout}, pending=${pending}, origin ${named ? 'named' : 'absent'}`;
    it(`restores each row under its own origin (${label})`, async () => {
      const { service, ownerA, ownerB } = await seedMixedRows(fanout, pending);

      await expect(
        service.transformRows(rewriteEveryRow, undefined, {
          ...(named ? { origin: ownerA } : {}),
          afterPublication: () => {
            throw new Error(OBSERVER_FAILURE);
          },
        }),
      ).rejects.toThrow(OBSERVER_FAILURE);
      await service.waitForCommit();

      expect(await laterReplays(service, ownerB)).toStrictEqual({
        thirdOrigin: ['shared'],
        originalB: ['shared', 'B-only'],
      });
    });
  }
});

describe('a restored rollback checkpoint keeps the origin of every row', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  for (const fanout of [false, true]) {
    it(`puts rows back under their own origins (fanout=${fanout})`, async () => {
      const { service, ownerB } = await seedMixedRows(fanout, false);

      await service.detachedValues.withRollbackCheckpoint(async (restore) => {
        await service.replaceBatch([textRow('replacement')]);
        await restore();
      });
      await service.waitForCommit();

      expect(await laterReplays(service, ownerB)).toStrictEqual({
        thirdOrigin: ['shared'],
        originalB: ['shared', 'B-only'],
      });
    });
  }
});

/** An AI tool call whose response is missing, so a repair inserts one. */
function orphanedToolCall(seq: number): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'call', name: 'read_file', parameters: {} },
    ],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

function chronologicalRow(text: string, seq: number): IContent {
  return {
    ...textRow(text),
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

describe('a rolled back validation repair keeps the origin of every restored row', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  it('restores rows under the origins they had before the repair', async () => {
    const recorder = harness.recorder('repair');
    const journal = new HistoryJournalStore(recorder);
    const repair = new HistoryValidationRepair();
    try {
      journal.apply({
        kind: 'content',
        content: chronologicalRow('A-only', 1),
        origin: 'A',
      });
      journal.apply({
        kind: 'content',
        content: chronologicalRow('shared', 2),
      });
      journal.apply({
        kind: 'content',
        content: orphanedToolCall(3),
        origin: 'B',
      });
      await journal.waitForDurable();
      let nextSeq = 4;
      journal.withReadRows((cursor) =>
        repair.capture(cursor, (row) => ({
          ...row,
          metadata: {
            ...row.metadata,
            chronology: row.metadata?.chronology ?? {
              seq: nextSeq++,
              userTurn: 1,
              step: 4,
              recordedAt: 1,
            },
          },
        })),
      );
      repair.publish(journal);
      repair.rollback(journal);
      await journal.waitForDurable();

      expect(
        journal.withReadRows((cursor) =>
          Array.from({ length: cursor.length }, (_, index) =>
            cursor.originAt(index),
          ),
        ),
      ).toStrictEqual(['A', undefined, 'B']);
    } finally {
      repair.close();
      await journal.dispose();
    }
  });
});
