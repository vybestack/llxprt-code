/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { createJournal } from './journalWriterOpen.js';
import { TRAILER_RECORD_BYTES } from './trailerRecord.js';
import { RECORD_KIND } from './recordKinds.js';
import { JournalInputError } from './errors.js';
import {
  standardGroup,
  plainRecord,
  testJournalSeams,
} from './__tests__/support/journalFixtures.js';
import { draftRow } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('journal synchronous admission allocation', () => {
  const directory = useTempDir('journal-admission-');

  it('keeps a fixed group and an admission disjoint while a record write is paused', async () => {
    const seams = testJournalSeams({ gateWriteAt: 1 });
    const writer = await createJournal(
      join(directory(), 'fixed.llxj'),
      seams.dependencies,
    );
    const committing = writer.commitGroup(standardGroup(1));
    try {
      for (let spin = 0; spin < 500; spin++) {
        if (seams.events.filter((event) => event.type === 'write').length >= 2)
          break;
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
      }
      expect(
        seams.events.filter((event) => event.type === 'write'),
      ).toHaveLength(2);
      const draft = draftRow({ text: 'admitted during fixed write' });
      const admission = writer.admitRow(draft);
      seams.release();
      const ack = await committing;
      const rows = [];
      for await (const row of writer.admittedRows(
        admission.start,
        admission.end,
      ))
        rows.push(row);
      expect(rows).toHaveLength(1);
      expect(rows[0].blocks).toStrictEqual(draft.blocks);
      expect(
        admission.start >= ack.durableEnd ||
          admission.end <= ack.durableEnd - TRAILER_RECORD_BYTES,
      ).toBe(true);
    } finally {
      seams.release();
      await committing.catch(() => undefined);
      await writer.close();
    }
  });

  it('poisons rather than truncating a later accepted admission on input rollback', async () => {
    const file = join(directory(), 'rollback.llxj');
    const writer = await createJournal(file, testJournalSeams().dependencies);
    const entered = gate();
    const held = gate();
    const committing = writer.commitStreamedGroup(async (appender) => {
      await appender.append(plainRecord(RECORD_KIND.VALUE, 1, 16));
      entered.release();
      await held.promise;
      throw new JournalInputError(new Error('invalid input'));
    });
    try {
      await entered.promise;
      const draft = draftRow({ text: 'accepted after group began' });
      const admission = writer.admitRow(draft);
      held.release();
      await expect(committing).rejects.toThrow('Journal input rollback failed');
      expect((await stat(file)).size).toBeGreaterThanOrEqual(admission.end);
      const rows = [];
      for await (const row of writer.admittedRows(
        admission.start,
        admission.end,
      ))
        rows.push(row);
      expect(rows).toHaveLength(1);
      expect(rows[0].blocks).toStrictEqual(draft.blocks);
      await expect(writer.commitGroup(standardGroup(2))).rejects.toThrow(
        'The journal writer failed earlier and accepts no more writes',
      );
    } finally {
      held.release();
      await committing.catch(() => undefined);
      await writer.close();
    }
  });
});
