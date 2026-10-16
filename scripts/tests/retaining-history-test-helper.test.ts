/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import {
  suffixRow,
  withSuffixFixture,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { retainHistoryForMemoryTrap } from './retaining-history-test-helper.js';

function sweep(): void {
  gcAndSweep();
  gcAndSweep();
}

describe('test-only eager memory trap source', () => {
  for (const size of [512, 8192]) {
    for (const compressed of [false, true]) {
      it(`retains every ${size} row across source replacement and GC with compression=${compressed}`, async () => {
        const retained = await withSuffixFixture(
          size,
          async (service, ownership, counters) => {
            if (compressed) {
              await service.replaceAll(
                Array.from({ length: size }, (_, index) =>
                  suffixRow(index, 2048),
                ),
                'test',
              );
              await service.waitForTokenUpdates();
              await service.waitForCommit();
              await service.waitForOwnershipSettlement();
            }
            const owners = ownership.snapshot();
            const reads = counters.snapshot();
            const rows = retainHistoryForMemoryTrap(service);
            expect(rows).toHaveLength(size);
            expect(ownership.snapshot()).toStrictEqual({ ...owners });
            expect(counters.snapshot()).toStrictEqual({ ...reads });
            const first = new WeakRef(rows[0]);
            const last = new WeakRef(rows[size - 1]);
            await service.replaceAll([suffixRow(size)], 'test');
            await service.waitForCommit();
            sweep();
            expect(first.deref()).toBe(rows[0]);
            expect(last.deref()).toBe(rows[size - 1]);
            return rows;
          },
          2048,
        );
        sweep();
        expect(retained).toHaveLength(size);
        for (let index = 0; index < size; index++)
          expect(retained[index]).toStrictEqual(suffixRow(index, 2048));
      }, 120_000);
    }
  }
});
