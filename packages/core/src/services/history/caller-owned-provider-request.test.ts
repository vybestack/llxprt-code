/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withCoreSuffixFixture } from './__tests__/support/core-suffix-fixture-test-helpers.js';
import {
  frozenUnits,
  digest,
} from './__tests__/support/normalization-oracle.js';
import { unitCase } from './__tests__/support/normalization-cases.js';
import { withoutFileCreation } from './__tests__/support/without-file-creation.js';
import type { IContent } from './IContent.js';
import { callerOwnedProviderRequest } from './caller-owned-provider-request.js';

describe('caller-owned provider overrides', () => {
  it('refuses to open a reader after its snapshot closes', async () => {
    const snapshot = await callerOwnedProviderRequest([
      { speaker: 'human', blocks: [{ type: 'text', text: 'closed request' }] },
    ]);
    await snapshot.close();
    expect(() => snapshot.openReader()).toThrow('snapshot is closed');
  });
  it('rejects an override that lost its indexed snapshot opener without staging it', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const override = {
        async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
          yield await Promise.reject<IContent>(
            new Error('Unindexed override was consumed'),
          );
        },
      };
      await withoutFileCreation(async () => {
        await expect(
          history.prepareCuratedForProviderSnapshot([], {}, override),
        ).rejects.toThrow(
          'Non-array history overrides require a provider snapshot opener',
        );
      });
    });
  });
  it('preserves normalized conversion units and pending membership without creating files', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      for (let seed = 0; seed < 84; seed++) {
        const input = unitCase(seed);
        const expected = frozenUnits(input);
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
