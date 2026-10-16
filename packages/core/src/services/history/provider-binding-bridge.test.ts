/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHistoryProviderFileBindingStore } from './provider-file-binding.js';
import {
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
  type DetachedFixture,
} from './detached-rollback-test-helpers.js';
import {
  bindingBridgeRow,
  bindingBridgeRows,
  bindingContentId,
  bindingFile,
  forbidLegacyBindingTransform,
} from './provider-binding-bridge-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
  expectedRange,
} from './chronology-rollback-test-helpers.js';

async function seed(fixture: DetachedFixture, size: number): Promise<void> {
  for await (const row of bindingBridgeRows(size))
    await fixture.recorder.commit('content', { content: row });
  await fixture.history.recalculateTotalTokens();
}
async function bindingFault(size: number, stage: string): Promise<number> {
  return withDetachedFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    await seed(fixture, size);
    const expected = await detachedDigest(bindingBridgeRows(size));
    const primary = new Error(`binding ${stage} failure`);
    if (stage === 'zero' || stage === 'prefix')
      recorder.failAdmissionAfter(stage === 'zero' ? 0 : 2);
    if (stage === 'prepare')
      history.registerMediaOwner(
        mediaParticipant(() => {
          throw primary;
        }),
      );
    if (stage === 'publish' || stage === 'finalize')
      history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => {
            if (stage === 'publish') throw primary;
          },
          rollback: () => undefined,
          finalize: () => {
            if (stage === 'finalize') throw primary;
          },
        })),
      );
    if (stage === 'observer')
      history.once('tokensUpdated', () => {
        throw primary;
      });
    forbidLegacyBindingTransform(history);
    expect(
      await rejectedValue(
        createHistoryProviderFileBindingStore(history).bind(
          bindingContentId,
          bindingFile,
        ),
      ),
    ).toBe(stage === 'zero' || stage === 'prefix' ? recorder.failure : primary);
    expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
      expected,
    );
    expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
    expect(history.getTotalTokens()).toBe(size * 4);
    expect(history.getContextRange().totalEntries).toBe(size);
    expect(owners.snapshot().liveRows).toBe(0);
    return expected.count;
  });
}

describe('provider binding detached production bridge', () => {
  for (const size of [512, 8192]) {
    it(`binds ${size} real mixed rows through the value engine and durably publishes before returning`, async () => {
      await withDetachedFixture(async (fixture) => {
        const { history, recorder, owners } = fixture;
        await seed(fixture, size);
        const range = expectedRange(size);
        history.setBaseTokenOffset(73);
        forbidLegacyBindingTransform(history);
        await createHistoryProviderFileBindingStore(history).bind(
          bindingContentId,
          bindingFile,
        );
        const expected = await detachedDigest(
          bindingBridgeRows(size, 2048, true),
        );
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
        expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
        expect(history.getTotalTokens()).toBe(size * 4 + 73);
        expect(history.getContextRange()).toStrictEqual(range);
        expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
        expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
          8 * 1024 * 1024,
        );
        expect(owners.snapshot().liveRows).toBe(0);
      });
    }, 180_000);
    for (const stage of [
      'zero',
      'prefix',
      'prepare',
      'publish',
      'finalize',
      'observer',
    ])
      it(`restores ${size} rows after ${stage} failure without hiding the primary error`, async () => {
        expect(await bindingFault(size, stage)).toBe(size);
      }, 180_000);
  }
});

describe('provider binding value edge cases', () => {
  it('accepts and restores a nine-MiB source value without changing caller metadata', async () => {
    await withDetachedFixture(async ({ history, recorder, owners }) => {
      const row = bindingBridgeRow(0, 9 * 1024 * 1024);
      const expected = await detachedDigest(
        bindingBridgeRows(1, 9 * 1024 * 1024),
      );
      Object.freeze(row.metadata?.chronology);
      Object.freeze(row.metadata);
      await recorder.commit('content', { content: row });
      await history.recalculateTotalTokens();
      const failure = new Error('large binding rollback');
      history.once('tokensUpdated', () => {
        throw failure;
      });
      forbidLegacyBindingTransform(history);
      expect(
        await rejectedValue(
          createHistoryProviderFileBindingStore(history).bind(
            bindingContentId,
            bindingFile,
          ),
        ),
      ).toBe(failure);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(row).toStrictEqual(bindingBridgeRow(0, 9 * 1024 * 1024));
      expect(history.getTotalTokens()).toBe(4);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  }, 180_000);
  it('rejects missing media before publishing and leaves duplicate public ids intact', async () => {
    await withDetachedFixture(async (fixture) => {
      await seed(fixture, 512);
      const expected = await detachedDigest(bindingBridgeRows(512));
      forbidLegacyBindingTransform(fixture.history);
      await expect(
        createHistoryProviderFileBindingStore(fixture.history).bind(
          'missing',
          bindingFile,
        ),
      ).rejects.toThrow(
        'Cannot bind provider file to missing media content missing',
      );
      expect(
        await detachedDigest(fixture.history.streamRawHistory()),
      ).toStrictEqual(expected);
      expect(await detachedDurableDigest(fixture.recorder)).toStrictEqual(
        expected,
      );
      expect(fixture.owners.snapshot().liveRows).toBe(0);
    });
  }, 180_000);
});
