/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { unlinkSync } from 'node:fs';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import {
  checkpointRows,
  type HistoryCheckpoint,
} from './historyCheckpointRows.js';

describe('scalar checkpoint pin cleanup', () => {
  for (const mode of ['return', 'fault', 'abort', 'unlink']) {
    it(`closes the pinned reader after ${mode}`, async () => {
      await withNativeDetachedFixture(async ({ history, session, owners }) => {
        await history.addBatch([batchRow(0)]);
        const controller = new AbortController();
        const failure = new Error(`checkpoint ${mode}`);
        let escaped: HistoryCheckpoint | undefined;
        const operation = rejectedValue(
          history.detachedValues.withCheckpoint(async (snapshot) => {
            escaped = snapshot;
            if (mode === 'unlink') unlinkSync(session.path);
            const iterator = checkpointRows(snapshot);
            try {
              expect((await iterator.next()).value).toStrictEqual(batchRow(0));
              if (mode === 'fault') throw failure;
              if (mode === 'abort') {
                controller.abort(failure);
                await history
                  .streamRawHistory(controller.signal)
                  [Symbol.asyncIterator]()
                  .next();
              }
            } finally {
              await iterator.return();
            }
          }, controller.signal),
        );
        expect(await operation).toBe(
          mode === 'fault' || mode === 'abort' ? failure : undefined,
        );
        if (escaped === undefined) throw new Error('Missing pinned reader');
        await expect(checkpointRows(escaped).next()).rejects.toThrow(
          /closed|pin was released/,
        );
        expect(owners.snapshot().liveRows).toBe(0);
      });
    });
  }
});
