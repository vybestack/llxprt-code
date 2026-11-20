/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  assertRemovalRows,
  removalReferences,
  removalRow,
  withRemovalFixture,
} from './history-removals-test-helpers.js';

async function withoutWriterAck(operation: Promise<unknown>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(
        () => 'unexpected completion',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      ),
      new Promise<string>((resolve) => {
        timer = setTimeout(
          () => resolve('waiting for writer acknowledgement'),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe('settled history with a caller-paused writer', () => {
  it('waits for its journal commit before notifying observers and compensates their failure', async () => {
    await withRemovalFixture(
      async (
        { history, pauseWriter, waitForPausedWrite, releaseWriter },
        store,
      ) => {
        const [shared, removed] = await removalReferences(store);
        const input = [removalRow(0, shared), removalRow(1, removed)];
        await history.addBatch(input);
        await history.settleMediaOwnership();
        const rejectPop = (): void => {
          throw new Error('paused pop observer failed');
        };
        history.on('tokensUpdated', rejectPop);
        pauseWriter();
        const popping = history.pop();
        try {
          await waitForPausedWrite;
          expect(await withoutWriterAck(popping)).toBe(
            'waiting for writer acknowledgement',
          );
          expect(await store.hasReservations(removed.contentId)).toBe(true);
        } finally {
          releaseWriter();
          try {
            await expect(popping).rejects.toThrow('paused pop observer failed');
          } finally {
            history.off('tokensUpdated', rejectPop);
          }
          await assertRemovalRows(history.streamRawHistory(), input);
        }
      },
    );
  });
});
