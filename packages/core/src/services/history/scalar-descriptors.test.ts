/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { fstatSync, appendFileSync, unlinkSync } from 'node:fs';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { withSynchronousHistoryCursor } from '../../recording/synchronousHistoryCursor.js';
import {
  expectNoScalarOwners,
  scalarFailureMessage,
} from './scalar-test-evidence.js';

describe('scalar cursor pinned descriptor cleanup', () => {
  it.each(['return', 'fault', 'abort', 'unlink'])(
    'closes the real pinned descriptor after %s',
    async (mode) => {
      await withBatchFixture(async ({ recorder, owners, reads }) => {
        await recorder.commit('content', { content: batchRow(0) });
        const journal = new HistoryJournalStore(recorder);
        const captured = journal.capturePendingFold();
        const pinned = captured.pinnedJournal;
        if (pinned === null) throw new Error('Expected pinned fixture journal');
        const controller = new AbortController();
        const run = (): void => {
          withSynchronousHistoryCursor(
            captured,
            (cursor) => {
              if (mode === 'unlink') {
                const path = journal.journalPath();
                if (path === null)
                  throw new Error('Expected fixture journal path');
                unlinkSync(path);
              }
              const iterator = cursor.rows();
              expect(iterator.next().value).toStrictEqual(batchRow(0));
              if (mode === 'fault')
                throw new Error('descriptor callback fault');
              if (mode === 'abort') {
                controller.abort(new Error('descriptor callback abort'));
                iterator.next();
              }
            },
            { ...reads.counters, ownership: owners },
            controller.signal,
          );
        };
        try {
          const failures = new Map([
            ['fault', 'descriptor callback fault'],
            ['abort', 'descriptor callback abort'],
          ]);
          expect(scalarFailureMessage(run)).toBe(failures.get(mode));
          expect(() => fstatSync(pinned.fd)).toThrow(/bad file descriptor/i);
          expectNoScalarOwners(owners);
        } finally {
          captured.release();
          journal.dispose();
        }
      });
    },
  );

  it('closes the pinned descriptor when the durable fold rejects an unsupported recording version', async () => {
    await withBatchFixture(async ({ recorder, owners }) => {
      await recorder.commit('content', { content: batchRow(0) });
      const journal = new HistoryJournalStore(recorder);
      const path = journal.journalPath();
      if (path === null) throw new Error('Expected fixture journal path');
      appendFileSync(path, '{"v":77,"type":"content","payload":{}}\n');
      const captured = journal.capturePendingFold();
      const pinned = captured.pinnedJournal;
      if (pinned === null) throw new Error('Expected pinned fixture journal');
      try {
        expect(() =>
          withSynchronousHistoryCursor(captured, (cursor) => cursor.length),
        ).toThrow('Unsupported recording version 77');
        expect(() => fstatSync(pinned.fd)).toThrow(/bad file descriptor/i);
        expectNoScalarOwners(owners);
      } finally {
        captured.release();
        journal.dispose();
      }
    });
  });
});
