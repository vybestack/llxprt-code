/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withCoreSuffixFixture } from './__tests__/support/core-suffix-fixture-test-helpers.js';
import { oldUnits, digest } from './__tests__/support/normalization-oracle.js';
import { unitCase } from './__tests__/support/normalization-cases.js';
import { withoutFileCreation } from './__tests__/support/without-file-creation.js';
import type { IContent } from './IContent.js';

describe('caller-owned provider overrides', () => {
  it('preserves normalized conversion units and pending membership without creating files', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      for (let seed = 0; seed < 84; seed++) {
        const input = unitCase(seed);
        const expected = await oldUnits(input);
        await withoutFileCreation(async () => {
          const snapshot = await history.prepareCuratedForProviderSnapshot(
            [...input.tail],
            {},
            input.rows,
          );
          try {
            const actual: IContent[] = [];
            for await (const row of snapshot.openReader()) actual.push(row);
            expect(digest(actual)).toBe(expected.outputHash);
            expect(snapshot.count).toBe(expected.count);
            expect(actual.map((_, at) => snapshot.isPending(at))).toStrictEqual(
              [...expected.pending],
            );
            expect(snapshot.pending.firstOutputIndex).toBe(
              expected.firstOutputIndex,
            );
            for (let at = 0; at < actual.length; at++)
              expect(await snapshot.readAt(at)).toStrictEqual(actual[at]);
          } finally {
            await snapshot.close();
          }
        });
      }
    });
  });
});
