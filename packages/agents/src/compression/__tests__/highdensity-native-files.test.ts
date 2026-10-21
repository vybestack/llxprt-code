/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { getScratchRoot } from '../../../../core/src/storage/scratch-root.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  highdensityOracle,
  highdensityRow,
  highdensitySetup,
} from './highdensity-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

describe('native high-density compression allocations', () => {
  it('uses pinned input instead of a second history-density rows/index pair', async () => {
    await withNativeFallbackFixture(async ({ history, seed, durable }) => {
      await seed(
        (function* () {
          for (let index = 0; index < 512; index++)
            yield highdensityRow(index, 64);
        })(),
      );
      const expected = await highdensityOracle(history, 512, 64);
      const { handler, transport } = highdensitySetup(history);
      getScratchRoot();
      const receipt = await operationFileCreates(async () => {
        expect(await handler.performCompression('native-density-input')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
      });
      expect(await collectRows(history)).toStrictEqual([...expected]);
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(history.streamRawHistory()),
      );
      expect(transport.requests).toHaveLength(0);
      expect(
        receipt.directories.filter((path) => path.includes('history-density-')),
      ).toHaveLength(1);
      expect(
        receipt.files.filter((path) => path.includes('history-density-')),
      ).toHaveLength(2);
      expect(
        receipt.directories.filter(
          (path) =>
            !path.includes('history-density-') &&
            !path.includes('density-decision-index-') &&
            !path.includes('compression-span-'),
        ),
      ).toStrictEqual([]);
      expect(
        receipt.files.filter(
          (path) =>
            !path.includes('history-density-') &&
            !path.includes('density-decision-index-') &&
            !path.includes('compression-span-'),
        ),
      ).toStrictEqual([]);
    });
  }, 180_000);
});
