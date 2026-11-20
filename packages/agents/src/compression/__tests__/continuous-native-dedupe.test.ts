/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  densityHandler,
  densityOracle,
  densityRow,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

describe('native continuous file inclusion deduplication', () => {
  it.each([
    [65, 2],
    [65, 6],
  ])(
    'matches the independent array policy over %i rows with mask %i without operation files',
    async (size, mask) => {
      await withNativeFallbackFixture(async ({ history, seed, durable }) => {
        await seed(
          (function* () {
            for (let index = 0; index < size; index++) yield densityRow(index);
          })(),
        );
        const expected = digestRows(densityOracle(size, mask));
        const handler = densityHandler(history, mask);
        const files = await operationFileCreates(
          () => handler.ensureDensityOptimized(),
          true,
        );
        expect(await digestStream(history.streamRawHistory())).toBe(expected);
        expect(await durable()).toStrictEqual(
          await compressionValueDigest(history.streamRawHistory()),
        );
        expect(files).toStrictEqual({ directories: [], files: [] });
      });
    },
    180_000,
  );
});
