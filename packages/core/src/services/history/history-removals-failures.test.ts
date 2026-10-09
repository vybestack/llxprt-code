/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRemovalFixture,
  removalReferences,
  removalRow,
  assertRemovalRows,
} from './history-removals-test-helpers.js';
import { batchRow } from './addbatch-stream-test-helpers.js';
import { expectedRange } from './chronology-rollback-test-helpers.js';

function registerRemovalFailure(
  operation: 'pop' | 'remove' | 'clear',
  failure: 'journal' | 'observer',
): void {
  describe('injected removal failure', () => {
    it(`restores pending membership, markers, tokens and media after ${operation} ${failure} rejection`, async () => {
      await withRemovalFixture(
        async (
          { history, recorder, pauseWriter, waitForPausedWrite, releaseWriter },
          store,
        ) => {
          const [shared, removed] = await removalReferences(store);
          const input = [removalRow(0, shared), removalRow(1, removed)];
          pauseWriter();
          history.addAll(input);
          await waitForPausedWrite;
          await history.waitForTokenUpdates();
          await history.settleMediaOwnership();
          const tokens = input.length * 4;
          const range = expectedRange(input.length);
          if (failure === 'journal') recorder.failAdmissionAfter(0);
          const listener = (): void => {
            throw new Error('removal observer failed');
          };
          if (failure === 'observer') history.on('tokensUpdated', listener);
          const execute = async (): Promise<void> => {
            if (operation === 'clear') history.clear();
            else if (operation === 'pop') await history.pop();
            else await history.removeLastIfMatches(input[1]);
          };
          try {
            await expect(execute()).rejects.toThrow(
              failure === 'journal'
                ? 'injected journal admission failure'
                : 'removal observer failed',
            );
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
  registerRemovalFailure('remove', 'journal');

  it('keeps the original cut-sequence behavior for repeated row and marker identities', async () => {
    await withRemovalFixture(
      async ({ history, pauseWriter, waitForPausedWrite }) => {
        const repeated = batchRow(0);
        pauseWriter();
        history.add(repeated);
        history.add(batchRow(1));
        history.add(repeated);
        await waitForPausedWrite;
        await history.waitForTokenUpdates();
        expect(await history.pop()).toStrictEqual(repeated);
        expect(history.length()).toBe(0);
      },
    );
  });
});
