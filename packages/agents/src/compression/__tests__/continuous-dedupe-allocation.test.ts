/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { operationFileCreates } from './support/operation-file-creates.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { densityHandler, densityRow } from './density-disk-helpers.js';

describe('native file dedupe allocation boundary', () => {
  it('fulfills the public policy request while all file creating APIs are denied across roots', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      await seed([densityRow(0), densityRow(6)]);
      await expect(
        operationFileCreates(
          () => densityHandler(history, 2).ensureDensityOptimized(),
          true,
        ),
      ).resolves.toStrictEqual({ directories: [], files: [] });
    });
  });
});
