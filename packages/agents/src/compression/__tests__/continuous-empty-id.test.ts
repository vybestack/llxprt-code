/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import {
  densityConfig,
  densityHandler,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';

function call(id: string, path: string, name = 'read_file'): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters: { path } };
}
function response(callId: string, result: string): ToolResponseBlock {
  return { type: 'tool_response', callId, toolName: 'read_file', result };
}
function input(): IContent[] {
  const repeated = call('', 'changed');
  return [
    { speaker: 'ai', blocks: [repeated, repeated] },
    {
      speaker: 'tool',
      blocks: [response('', 'first'), response('', 'second')],
    },
    {
      speaker: 'ai',
      blocks: [
        call('', 'untouched'),
        call('raw/a', 'untouched'),
        call('raw_a', 'untouched'),
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        response('', 'global raw-ID match'),
        response('raw/a', 'keep slash'),
        response('raw_a', 'keep underscore'),
        { type: 'text', text: 'other block' },
      ],
    },
    { speaker: 'ai', blocks: [call('write', 'changed', 'write_file')] },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: '--- same.ts ---\nold\n--- End of content ---\n',
        },
      ],
    },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: '--- same.ts ---\nnew\n--- End of content ---\n',
        },
      ],
    },
    ...Array.from(
      { length: 4 },
      (_, index): IContent => ({
        speaker: 'tool',
        blocks: [response(`other-${index}`, `result-${index}`)],
      }),
    ),
  ];
}

describe('continuous density duplicate empty raw IDs', () => {
  it('removes an exhausted duplicate-call row rather than emitting an inadmissible empty replacement', () => {
    const result = new HighDensityStrategy().optimize(
      input(),
      densityConfig(1),
    );
    process.stdout.write(
      `EMPTY_ID_ARRAY ${JSON.stringify({ removals: result.removals, replacements: [...result.replacements] })}\n`,
    );
    expect(result.removals).toContain(0);
    expect(result.replacements.has(0)).toBe(false);
    expect(result.removals).toContain(1);
    expect(result.replacements.get(3)?.blocks).toStrictEqual(
      input()[3].blocks.slice(1),
    );
    expect(result.removals).not.toContain(2);
  });

  it.each([1, 3, 5, 7])(
    'publishes exact array values and successful tokens without files for mask %i',
    async (mask) => {
      await withNativeFallbackFixture(
        async ({ history, seed, durable, owners }) => {
          await seed(input());
          const rows: IContent[] = [];
          for await (const row of history.streamRawHistory()) rows.push(row);
          const result = new HighDensityStrategy().optimize(
            rows,
            densityConfig(mask),
          );
          const expected = invalidateResponsesStatefulChain(
            rows.flatMap((row, index) =>
              result.removals.includes(index)
                ? []
                : [result.replacements.get(index) ?? row],
            ),
          );
          const expectedTokens =
            await history.estimateTokensForContents(expected);
          const beforeTokens = history.getTotalTokens();
          await expect(
            operationFileCreates(
              () => densityHandler(history, mask).ensureDensityOptimized(),
              true,
            ),
          ).resolves.toStrictEqual({ directories: [], files: [] });
          expect(await digestStream(history.streamRawHistory())).toBe(
            digestRows(expected),
          );
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(expected),
          );
          expect(history.getTotalTokens()).toBe(expectedTokens);
          expect(history.getTotalTokens() - beforeTokens).toBe(
            expectedTokens - beforeTokens,
          );
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    },
  );
});
