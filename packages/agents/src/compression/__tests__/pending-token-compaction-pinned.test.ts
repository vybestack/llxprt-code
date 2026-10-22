/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { operationFileCreates } from './support/operation-file-creates.js';
import { pendingCompactionParity } from './pending-token-compaction-parity.js';

describe('pending-token parity under request and recording pins', () => {
  it('matches all 8192 array and disk values while denying every creating API', async () => {
    await pendingCompactionParity(async ({ history, recording, operation }) => {
      const request = await history.openCompressionInput();
      const reader = await recording.snapshot();
      try {
        const files = operationFileCreates(async () => {
          await operation();
          await history.waitForCommit();
          expect(reader.rows).toBe(8192);
          expect(request.rows.length).toBe(8192);
          expect((await reader.entryAt(8191)).label).toBeGreaterThan(0n);
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
        await reader.close();
        await request.close();
      }
    });
  }, 180_000);
});
