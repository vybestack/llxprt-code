/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { getScratchRoot } from '../../../../core/src/storage/scratch-root.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  densityHandler,
  densityOracle,
  densityRow,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';

const legacyOwners = /history-density-|density-decision-index-/;

describe('native continuous recency decision', () => {
  it.each([65])(
    'matches the independent array policy across %i rows without input, replacement or decision files',
    async (size) => {
      await withNativeFallbackFixture(async ({ history, seed, durable }) => {
        await seed(
          (function* () {
            for (let index = 0; index < size; index++)
              yield densityRow(index, 2048);
          })(),
        );
        const expected = digestRows(densityOracle(size, 4));
        const handler = densityHandler(history, 4);
        getScratchRoot();
        const files = await operationFileCreates(
          () => handler.ensureDensityOptimized(),
          true,
        );
        expect(await digestStream(history.streamRawHistory())).toBe(expected);
        expect(await durable()).toStrictEqual(
          await import('./compression-value-fixture.js').then(
            ({ compressionValueDigest }) =>
              compressionValueDigest(history.streamRawHistory()),
          ),
        );
        expect(
          files.directories.filter((path) => legacyOwners.test(path)),
        ).toStrictEqual([]);
        expect(
          files.files.filter((path) => legacyOwners.test(path)),
        ).toStrictEqual([]);
        expect(files).toStrictEqual({ directories: [], files: [] });
      });
    },
    180_000,
  );

  it('creates no operation files across all roots when recency selects nothing', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      await seed(
        (function* () {
          for (let index = 0; index < 3; index++) yield densityRow(index, 64);
        })(),
      );
      const handler = densityHandler(history, 4);
      getScratchRoot();
      const files = await operationFileCreates(
        () => handler.ensureDensityOptimized(),
        true,
      );
      expect(files).toStrictEqual({ directories: [], files: [] });
      expect(await digestStream(history.streamRawHistory())).toBe(
        digestRows(
          Array.from({ length: 3 }, (_, index) => densityRow(index, 64)),
        ),
      );
    });
  });
});
