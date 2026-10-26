/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { truncateSourceToolResponses } from '../source-tool-truncation.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  candidateOver,
  newStageWork,
  stageInput,
  totalRequestTokens,
  pendingToolRow,
} from './support/source-tool-truncation-fixture.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import { lengthTokenizer, freezeRows } from './pending-token-native-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

const cases = [
  { size: 65, pendingCount: 2 },
  { size: 40, pendingCount: 64 },
  { size: 40, pendingCount: 65 },
  { size: 40, pendingCount: 5000 },
];

describe('native source pending overlay measurement', () => {
  for (const { size, pendingCount } of cases) {
    it(`ranks ${pendingCount} current-turn units beside ${size} persisted rows without publishing them or creating files`, async () => {
      await withNativeFallbackFixture(async ({ history, seed, durable }) => {
        lengthTokenizer(history);
        await seed(
          Array.from({ length: size }, (_, index) => toolRankingRow(index, 16)),
        );
        const pending = Array.from({ length: pendingCount }, (_, index) =>
          pendingToolRow(index, 4096),
        );
        freezeRows(pending);
        const original = JSON.stringify(pending);
        const before = await compressionValueDigest(history.streamRawHistory());
        const work = newStageWork();
        const candidate = candidateOver(history, pending, work);
        const limit = (await totalRequestTokens(history, pending)) - 1;
        const files = await operationFileCreates(async () => {
          expect(
            await truncateSourceToolResponses(
              stageInput(history, candidate, limit),
            ),
          ).toStrictEqual({ replacedCount: 1 });
        }, true);
        const transformed = await candidate.pending.read();
        const stubs = transformed.flatMap((row, ordinal) =>
          row.blocks
            .filter(
              (block) =>
                block.type === 'tool_response' &&
                block.providerMetadata?.contextTruncated === true,
            )
            .map(() => ordinal),
        );
        expect(stubs).toStrictEqual([pendingCount - 1]);
        expect(
          await totalRequestTokens(history, transformed),
        ).toBeLessThanOrEqual(limit);
        expect(
          await compressionValueDigest(history.streamRawHistory()),
        ).toStrictEqual(before);
        expect(await durable()).toStrictEqual(before);
        expect(JSON.stringify(pending)).toBe(original);
        expect(files).toStrictEqual({ directories: [], files: [] });
        process.stdout.write(
          `PENDING_TAIL ${JSON.stringify({ size, pendingCount, pendingBytes: Buffer.byteLength(original), projections: work.projections, projectedRows: work.projectedRows, copies: work.copies })}\n`,
        );
      });
    }, 180_000);
  }
  it('remeasures a changed tail on warm history without decoding persisted response blocks', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      lengthTokenizer(history);
      await seed(
        Array.from({ length: 40 }, (_, index) => toolRankingRow(index, 16)),
      );
      const readBlock = VersionSnapshot.prototype.readBlock;
      let reads = 0;
      const probe = spyOn(
        VersionSnapshot.prototype,
        'readBlock',
      ).mockImplementation(function (this: VersionSnapshot, ...args) {
        reads++;
        return readBlock.call(this, ...args);
      });
      try {
        for (const largest of [1, 0]) {
          const pending = [
            pendingToolRow(0, largest === 0 ? 8192 : 4096),
            pendingToolRow(1, largest === 1 ? 8192 : 4096),
          ];
          const candidate = candidateOver(history, pending, newStageWork());
          const limit = (await totalRequestTokens(history, pending)) - 1;
          reads = 0;
          expect(
            await truncateSourceToolResponses(
              stageInput(history, candidate, limit),
            ),
          ).toStrictEqual({ replacedCount: 1 });
          const actual = await candidate.pending.read();
          expect(
            actual[largest].blocks.some(
              (block) =>
                block.type === 'tool_response' &&
                block.providerMetadata?.contextTruncated === true,
            ),
          ).toBe(true);
          expect(reads).toBe(largest === 1 ? 40 : 0);
        }
      } finally {
        probe.mockRestore();
      }
    });
  }, 180_000);
});
