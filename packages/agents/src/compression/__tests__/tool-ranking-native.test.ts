/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { truncateToolResponsesInOnePass } from '../toolResponseOnePass.js';
import {
  createTruncationStub,
  rankToolResponses,
} from '../toolResultTruncator.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';

function estimate(block: ContentBlock): Promise<number> {
  return Promise.resolve(
    block.type === 'tool_response' &&
      block.providerMetadata?.contextTruncated !== true
      ? 1000
      : 100,
  );
}

async function scaledProjection(
  assertResult: (
    result: Awaited<ReturnType<typeof truncateToolResponsesInOnePass>>,
  ) => void,
): Promise<void> {
  await withNativeFallbackFixture(async ({ history, seed }) => {
    await seed(Array.from({ length: 3 }, (_, index) => toolRankingRow(index)));
    const result = await truncateToolResponsesInOnePass(
      {
        historyService: history,
        rankingRevision: 'scaled-ranking:1',
        logger: new DebugLogger('test:scaled-ranking'),
        pendingContents: [],
        estimateBlockTokensAsync: estimate,
        computeProjected: async () => {
          let tokens = 0;
          for await (const row of history.streamRawHistory())
            for (const block of row.blocks)
              if (block.type === 'tool_response')
                tokens +=
                  block.providerMetadata?.contextTruncated === true
                    ? 550
                    : 1000;
          return tokens;
        },
        getRuntimeModel: () => 'native-ranking-test',
      },
      2000,
    );
    assertResult(result);
  });
}

describe('native global tool-response ranking', () => {
  it('measures pending candidates once without publishing pending rows', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      const rows = Array.from({ length: 3 }, (_, index) =>
        toolRankingRow(index),
      );
      await seed(rows);
      let measured = 0;
      const result = await truncateToolResponsesInOnePass(
        {
          historyService: history,
          rankingRevision: 'pending-ranking:1',
          logger: new DebugLogger('test:pending-ranking'),
          pendingContents: rows,
          estimateBlockTokensAsync: async (block) => {
            measured++;
            return estimate(block);
          },
          computeProjected: async (working) => {
            let tokens = 3000;
            for (const row of working)
              for (const block of row.blocks)
                if (block.type === 'tool_response')
                  tokens += await estimate(block);
            return tokens;
          },
          getRuntimeModel: () => 'native-ranking-test',
        },
        4500,
      );
      expect(result.replacedCount).toBe(2);
      expect(result.projected).toBe(4200);
      expect(measured).toBe(12);
      const durable = [];
      for await (const row of history.streamRawHistory()) durable.push(row);
      expect(
        durable.every((row) =>
          row.blocks.every(
            (block) =>
              block.type !== 'tool_response' ||
              block.providerMetadata?.contextTruncated !== true,
          ),
        ),
      ).toBe(true);
    });
  }, 180_000);
  it(
    'does not resurrect history changed by projection',
    changedProjection,
    180_000,
  );
  async function changedProjection(): Promise<void> {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      await seed([toolRankingRow(0), toolRankingRow(1), toolRankingRow(2)]);
      const result = await truncateToolResponsesInOnePass(
        {
          historyService: history,
          rankingRevision: 'changed-ranking:1',
          logger: new DebugLogger('test:changed-ranking'),
          pendingContents: [],
          estimateBlockTokensAsync: estimate,
          computeProjected: async () => {
            await history.clear();
            await history.waitForTokenUpdates();
            return 3000;
          },
          getRuntimeModel: () => 'native-ranking-test',
        },
        1500,
      );
      expect(result.replacedCount).toBe(0);
      const remaining = [];
      for await (const row of history.streamRawHistory()) remaining.push(row);
      expect(remaining).toStrictEqual([]);
    });
  }

  it('preserves earlier stubs when exact projection requires another round', async () => {
    await scaledProjection((result) => {
      expect(result).toStrictEqual({
        replacedCount: 3,
        projected: 1650,
        success: true,
        transformedPending: undefined,
      });
    });
  }, 180_000);
  it('publishes the array-ranked stubs without operation files across roots', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      const input = Array.from({ length: 3 }, (_, index) =>
        toolRankingRow(index),
      );
      await seed(input);
      const ranked = await rankToolResponses(input, estimate);
      const expected = ranked
        .slice(0, 2)
        .map((candidate) =>
          createTruncationStub(candidate.block, candidate.estimatedTokens),
        );
      getScratchRoot();
      let replaced = 0;
      const files = await operationFileCreates(async () => {
        const result = await truncateToolResponsesInOnePass(
          {
            historyService: history,
            rankingRevision: 'native-ranking-test:1',
            logger: new DebugLogger('test:native-ranking'),
            pendingContents: [],
            estimateBlockTokensAsync: estimate,
            computeProjected: async () => {
              let tokens = 0;
              for await (const row of history.streamRawHistory())
                for (const block of row.blocks)
                  if (block.type === 'tool_response')
                    tokens += await estimate(block);
              return tokens;
            },
            getRuntimeModel: () => 'native-ranking-test',
          },
          1500,
        );
        replaced = result.replacedCount;
      });
      const stubs = [];
      for await (const row of history.streamRawHistory())
        for (const block of row.blocks)
          if (
            block.type === 'tool_response' &&
            block.providerMetadata?.contextTruncated === true
          )
            stubs.unshift(block);
      expect(replaced).toBe(2);
      expect(stubs).toStrictEqual(expected);
      expect(
        files.directories.filter((path) => /tool-response-ranking-/.test(path)),
      ).toStrictEqual([]);
      expect(
        files.files.filter((path) => /tool-response-ranking-/.test(path)),
      ).toStrictEqual([]);
      expect(files).toStrictEqual({ directories: [], files: [] });
    });
  }, 180_000);
});
