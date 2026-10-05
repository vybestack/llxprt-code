/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  withPendingFixture,
  pendingCaller,
} from './pending-window-disk-helpers.js';
const cases = [512, 8192].flatMap((size) =>
  [false, true].map((copy) => ({ size, copy })),
);
describe('pending-window retained owner controls', () => {
  it.each(cases)(
    'detects context retention for $size rows copy=$copy with pending membership',
    async ({ size, copy }) => {
      await withPendingFixture(
        size,
        async ({ history, pauseWriter, releaseWriter, recorder }) => {
          pauseWriter();
          history.add(pendingCaller(0));
          history.add(pendingCaller(1));
          const owners = new RowOwnership();
          const retained: IContent[] = [];
          try {
            await history.withRawHistorySnapshot(async (snapshot) => {
              for (const row of snapshot) {
                const owner = copy ? { ...row } : row;
                retained.push(owner);
                owners.retain(owner);
              }
            });
            expect(owners.snapshot().liveRows).toBeGreaterThan(440);
            expect(owners.snapshot().liveSerializedBytes).toBeGreaterThan(0);
            expect(
              owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(process.env.PENDING_WINDOW_RETAINING_TRAP === '1');
          } finally {
            for (const row of retained) owners.release(row);
            retained.length = 0;
          }
          expect(owners.snapshot().liveRows).toBe(0);
          releaseWriter();
          await recorder.flush();
        },
      );
    },
    180000,
  );
});
