/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
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

function tiedRow(index: number): IContent {
  const row = highdensityRow(index, 64);
  if (index === 3) return { ...row, speaker: 'ai', blocks: [] };
  if (index % 4 === 1)
    return {
      ...row,
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'repeat',
          name: 'read_file',
          parameters: { file_path: `/path-${index}` },
        },
      ],
    };
  if (index % 4 === 2)
    return {
      ...row,
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'repeat',
          toolName: 'read_file',
          result: index % 8 === 2 ? 'command failed' : { value: 'ok' },
        },
        { type: 'text', text: `non-response-${index}` },
      ],
    };
  return {
    ...row,
    speaker: 'human',
    blocks: [{ type: 'text', text: `row-${index}` }],
  };
}

describe('native high-density compression allocations', () => {
  it.each([
    [65, 30000],
    [65, 1e9],
  ])(
    'streams %i rows at limit %i without history-density or chronology files',
    async (size, limit) => {
      await withNativeFallbackFixture(async ({ history, seed, durable }) => {
        await seed(
          (function* () {
            for (let index = 0; index < size; index++)
              yield highdensityRow(index, 64);
          })(),
        );
        const expected = await highdensityOracle(
          history,
          size,
          64,
          highdensityRow,
          { contextLimit: limit },
        );
        const { handler, transport } = highdensitySetup(
          history,
          undefined,
          undefined,
          { contextLimit: limit },
        );
        getScratchRoot();
        const receipt = await operationFileCreates(async () => {
          expect(await handler.performCompression('native-density-input')).toBe(
            PerformCompressionResult.COMPRESSED,
          );
        }, true);
        const actual = await collectRows(history);
        expect(actual).toStrictEqual([...expected]);
        expect(await history.estimateTokensForContents(actual)).toBe(
          await history.estimateTokensForContents(expected),
        );
        expect(
          receipt.directories.filter((path) =>
            path.includes('density-decision-index-'),
          ),
        ).toHaveLength(0);
        expect(
          receipt.files.filter((path) =>
            path.includes('density-decision-index-'),
          ),
        ).toHaveLength(0);
        expect(await durable()).toStrictEqual(
          await compressionValueDigest(history.streamRawHistory()),
        );
        expect(transport.requests).toHaveLength(0);
        expect(
          receipt.directories.filter((path) =>
            path.includes('history-density-'),
          ),
        ).toHaveLength(0);
        expect(
          receipt.files.filter((path) => path.includes('history-density-')),
        ).toHaveLength(0);
        expect(
          receipt.directories.filter(
            (path) => !path.includes('density-decision-index-'),
          ),
        ).toStrictEqual([]);
        expect(
          receipt.files.filter(
            (path) => !path.includes('density-decision-index-'),
          ),
        ).toStrictEqual([]);
      });
    },
    180_000,
  );
  it.each([65])(
    'keeps first-call source order and every response block across %i rows with uncurated holes',
    async (size) => {
      await withNativeFallbackFixture(async ({ history, seed, durable }) => {
        await seed(
          (function* () {
            for (let index = 0; index < size; index++) yield tiedRow(index);
          })(),
        );
        const overrides = { contextLimit: 1e9 };
        const expected = await highdensityOracle(
          history,
          size,
          64,
          tiedRow,
          overrides,
        );
        const { handler } = highdensitySetup(
          history,
          undefined,
          undefined,
          overrides,
        );
        expect(await handler.performCompression('first-call-order')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        expect(await collectRows(history)).toStrictEqual([...expected]);
        expect(await durable()).toStrictEqual(
          await compressionValueDigest(history.streamRawHistory()),
        );
      });
    },
    180_000,
  );
});
