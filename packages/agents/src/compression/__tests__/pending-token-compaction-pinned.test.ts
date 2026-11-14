/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { operationFileCreates } from './support/operation-file-creates.js';
import { pendingCompactionParity } from './pending-token-compaction-parity.js';

describe('pending-token parity under request and recording pins', () => {
  const size = 65;
  it('matches all 65 array and disk values while denying every creating API', async () => {
    await pendingCompactionParity(
      size,
      async ({
        history,
        recording,
        operation,
        armCompaction,
        stopCompaction,
      }) => {
        const request = await history.openCompressionInput();
        const reader = await recording.snapshot();
        armCompaction();
        try {
          const files = operationFileCreates(async () => {
            await operation();
            await history.waitForCommit();
            expect(reader.rows).toBe(size);
            expect(request.rows.length).toBe(size);
            expect((await reader.entryAt(size - 1)).label).toBeGreaterThan(0n);
          }, true);
          const outcome = await files.then(
            (created) => ({ created }),
            (error: unknown) => ({ error }),
          );
          expect(outcome).toStrictEqual({
            created: { directories: [], files: [] },
          });
          return await files;
        } finally {
          stopCompaction();
          await reader.close();
          await request.close();
        }
      },
    );
  }, 180_000);
});
