/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { truncateSourceToolResponses } from '../source-tool-truncation.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  candidateOver,
  newStageWork,
  stageInput,
  totalRequestTokens,
} from './support/source-tool-truncation-fixture.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

describe('native public last-resort source truncation', () => {
  it('uses native ranking from the source-stage callsite and returns transformed pending without operation files', async () => {
    await withNativeFallbackFixture(async ({ history, seed, durable }) => {
      history.setTokenizerFactory({
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: (text: string) => text.length,
        }),
      });
      await seed(
        Array.from({ length: 65 }, (_, index) => toolRankingRow(index)),
      );
      const pending = [toolRankingRow(65, 4096), toolRankingRow(66, 4096)];
      const originalPending = JSON.stringify(pending);
      const work = newStageWork();
      const candidate = candidateOver(history, pending, work);
      const limit = Math.floor(
        (await totalRequestTokens(history, pending)) * 0.85,
      );
      getScratchRoot();
      const files = await operationFileCreates(async () => {
        const result = await truncateSourceToolResponses(
          stageInput(history, candidate, limit),
        );
        expect(result.replacedCount).toBeGreaterThan(0);
      }, true);
      const actualPending = await candidate.pending.read();
      expect(
        await totalRequestTokens(history, actualPending),
      ).toBeLessThanOrEqual(limit);
      expect(
        actualPending.some((row) =>
          row.blocks.some(
            (block) =>
              block.type === 'tool_response' &&
              block.providerMetadata?.contextTruncated === true,
          ),
        ),
      ).toBe(true);
      expect(JSON.stringify(pending)).toBe(originalPending);
      expect(files).toStrictEqual({ directories: [], files: [] });
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(history.streamRawHistory()),
      );
    });
  }, 180_000);
});
