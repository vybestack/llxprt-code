/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from './__tests__/support/token-accounting-stream-test-helpers.js';
import type { IContent } from './IContent.js';
describe('token accounting fixture ownership', () => {
  it('rejects eager fixture ownership at both scales and releases the retaining control', async () => {
    for (const size of [512, 8192]) {
      await withSuffixFixture(
        size,
        async (service, ownership) => {
          const retained: IContent[] = [];
          for await (const row of service.streamRawHistory()) {
            ownership.retain(row);
            retained.push(row);
          }
          try {
            expect(retained).toHaveLength(size);
            expect(
              ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(false);
            expect(ownership.snapshot().peakRows).toBeGreaterThan(440);
            expect(
              ownership.snapshot().peakSerializedBytes > 8 * 1024 * 1024,
            ).toBe(size === 8192);
          } finally {
            for (const row of retained) ownership.release(row);
          }
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(ownership.snapshot().liveSerializedBytes).toBe(0);
        },
        2048,
        accountingRow,
      );
    }
  }, 120_000);
});
