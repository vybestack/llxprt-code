/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  executeTruncation,
  truncationValues,
} from './truncation-value-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import { getScratchRoot } from '../../../../core/src/storage/scratch-root.js';

describe('native truncation span preparation', () => {
  it.each([64, 65, 5000])(
    'publishes the exact retained tail at %i rows without creating operation files',
    async (size) => {
      await withNativeFallbackFixture(async ({ history, durable }) => {
        await history.detachedValues.replace(truncationValues(size, 0, 64));
        getScratchRoot();
        const expected = await compressionValueDigest(
          truncationValues(size, 11, 64, true),
        );
        const creates = await operationFileCreates(async () => {
          expect((await executeTruncation(history, size)).outcome).toBe(
            'applied',
          );
        });
        expect(creates).toStrictEqual({ directories: [], files: [] });
        expect(
          await compressionValueDigest(history.streamRawHistory()),
        ).toStrictEqual(expected);
        expect(await durable()).toStrictEqual(expected);
      });
    },
    180_000,
  );

  it('denies every creating API across roots during a native compression lock', async () => {
    await withNativeFallbackFixture(async ({ history }) => {
      await history.detachedValues.replace(truncationValues(64, 0, 64));
      getScratchRoot();
      history.startCompression();
      try {
        const creates = await operationFileCreates(async () => {
          expect((await executeTruncation(history, 64)).outcome).toBe(
            'applied',
          );
        }, true);
        expect(creates).toStrictEqual({ directories: [], files: [] });
        expect(history.getStatistics().totalMessages).toBe(53);
      } finally {
        history.endCompression(undefined, 64);
      }
    });
  });
});
