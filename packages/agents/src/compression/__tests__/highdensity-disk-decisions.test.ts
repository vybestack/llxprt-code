/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  highdensitySetup,
  highdensityOracle,
  highdensityRow,
  HighdensityDiskHistory,
} from './highdensity-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';

function decisionRow(index: number, bytes: number): IContent {
  const base = highdensityRow(index, bytes);
  const callId = `reused-${Math.floor(index / 8) % 17}`;
  const parameter = ['absolute_path', 'path', 'file_path'][
    Math.floor(index / 8) % 3
  ];
  return {
    ...base,
    metadata: {
      ...base.metadata,
      ...(index === 0
        ? {
            isSummary: true,
            synthetic: true,
            reason: 'compression-state-snapshot',
          }
        : {}),
    },
    blocks: base.blocks.map((block) => {
      if (block.type === 'tool_call' && base.speaker === 'ai')
        return {
          ...block,
          id: callId,
          parameters: {
            [parameter]: `/fixture/first-${index}.ts`,
          },
        };
      if (block.type === 'tool_response' && block.toolName === 'inspect')
        return {
          ...block,
          callId,
          result: index % 16 === 4 ? 'COMMAND FAILED: fixture' : block.result,
        };
      return block;
    }),
  };
}

async function decisions(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const expected = await highdensityOracle(
        history,
        size,
        256,
        decisionRow,
        { contextLimit: 1e9 },
      );
      const { handler } = highdensitySetup(history, undefined, undefined, {
        contextLimit: 1e9,
      });
      expect(await handler.performCompression('decisions')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const actual = await collectRows(history);
      expect(actual).toStrictEqual([...expected]);
      const summaries = actual.flatMap((row) =>
        row.blocks.flatMap((block) =>
          block.type === 'tool_response' && typeof block.result === 'string'
            ? [block.result]
            : [],
        ),
      );
      expect(summaries).toContain(
        '[inspect /fixture/first-2.ts: error — re-run to view]',
      );
      expect(summaries).toContain(
        '[inspect /fixture/first-2.ts: success — re-run to view]',
      );
      expect(await history.estimateTokensForContents(actual)).toBe(
        await history.estimateTokensForContents(expected),
      );
      return actual.length;
    },
    256,
    decisionRow,
    undefined,
    (options) => new HighdensityDiskHistory(options),
  );
}

describe('high-density disk addressed decisions', () => {
  it.each([512, 8192])(
    'preserves first duplicate call lookup, parameter aliases, error status and old summary spans for %i rows',
    async (size) => {
      expect(await decisions(size)).toBeGreaterThan(0);
    },
    180_000,
  );
  it('returns a truthful nonempty tail-covers-all no-op without changing stored metadata or cache anchor', async () => {
    await withSuffixFixture(
      1,
      async (history) => {
        const { handler } = highdensitySetup(history);
        const before = [highdensityRow(0, 256)];
        history.setCacheAnchorSeq(1);
        expect(await handler.performCompression('noop')).toBe(
          PerformCompressionResult.NOOP,
        );
        expect(await collectRows(history)).toStrictEqual(before);
        expect(history.getCacheAnchorSeq()).toBe(1);
        expect(handler.wasRecentlyCompressed()).toBe(false);
      },
      256,
      highdensityRow,
      undefined,
      (options) => new HighdensityDiskHistory(options),
    );
  });
});
