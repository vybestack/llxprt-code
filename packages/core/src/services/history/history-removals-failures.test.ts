/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { expectedRange, rowsOf } from './chronology-rollback-test-helpers.js';
import {
  assertRemovalRows,
  removalReferences,
  removalRow,
  withRemovalFixture,
} from './history-removals-test-helpers.js';

function registerRemovalFailure(
  operation: 'pop' | 'remove' | 'clear',
  failure: 'journal' | 'observer',
): void {
  describe('injected removal failure', () => {
    it(`restores pending membership, markers, tokens and media after ${operation} ${failure} rejection`, async () => {
      await withRemovalFixture(
        async (
          { history, io, pauseWriter, waitForPausedWrite, releaseWriter },
          store,
        ) => {
          const [shared, removed] = await removalReferences(store);
          const input = [removalRow(0, shared), removalRow(1, removed)];
          pauseWriter();
          history.addAll(input);
          await waitForPausedWrite;
          releaseWriter();
          await history.waitForTokenUpdates();
          await history.settleMediaOwnership();
          const tokens = input.length * 4;
          const range = expectedRange(input.length);
          const stored = await rowsOf(history);
          const primary = new Error(
            failure === 'journal'
              ? 'removal journal write failed'
              : 'removal observer failed',
          );
          if (failure === 'journal') io.rejectNextWrite(primary, 'trailer');
          const listener = (): void => {
            throw primary;
          };
          if (failure === 'observer') history.on('tokensUpdated', listener);
          const execute = async (): Promise<void> => {
            if (operation === 'clear') await history.clear();
            else if (operation === 'pop') await history.pop();
            else await history.removeLastIfMatches(stored[1]);
          };
          try {
            await expect(execute()).rejects.toBe(primary);
          } finally {
            history.off('tokensUpdated', listener);
          }
          const expected = input;
          await assertRemovalRows(history.streamRawHistory(), expected);
          expect(history.getTotalTokens()).toBe(tokens);
          expect(history.getContextRange()).toStrictEqual(range);
          expect(await store.hasReservations(shared.contentId)).toBe(true);
          expect(await store.hasReservations(removed.contentId)).toBe(true);
          releaseWriter();
          await history.waitForCommit();
          await assertRemovalRows(history.streamRawHistory(), expected);
        },
      );
    });
  });
}

describe('history removal rollback', () => {
  const operations: ReadonlyArray<'pop' | 'clear'> = ['pop', 'clear'];
  const failures: ReadonlyArray<'journal' | 'observer'> = [
    'journal',
    'observer',
  ];
  for (const operation of operations)
    for (const failure of failures) registerRemovalFailure(operation, failure);
  for (const failure of failures) registerRemovalFailure('remove', failure);

  it('removes only the final occurrence of a repeated row and marker identity', async () => {
    await withRemovalFixture(
      async ({ history, pauseWriter, waitForPausedWrite, releaseWriter }) => {
        const repeated = batchRow(0);
        pauseWriter();
        history.add(repeated);
        history.add(batchRow(1));
        history.add(repeated);
        await waitForPausedWrite;
        releaseWriter();
        await history.waitForTokenUpdates();
        expect(await history.pop()).toStrictEqual(repeated);
        expect(history.length()).toBe(2);
        expect(await rowsOf(history)).toStrictEqual([repeated, batchRow(1)]);
      },
    );
  });
});
