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
import { compressionValueDigest } from './compression-value-fixture.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';

function call(id: string, name: string, parameters: unknown): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters };
}
function response(
  callId: string,
  toolName = 'read_file',
  error?: string,
): ToolResponseBlock {
  return {
    type: 'tool_response',
    callId,
    toolName,
    result: `full result ${callId}`,
    ...(error === undefined ? {} : { error }),
  };
}
function fixture(): readonly IContent[] {
  return [
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
      speaker: 'ai',
      blocks: [
        call('partial', 'read_file', {
          file_path: './x/../same.ts',
          offset: 3,
          limit: 5,
        }),
        call('keep', 'read_file', { path: 'other.ts' }),
        { type: 'text', text: 'preserve text' },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        response('partial'),
        response('keep'),
        { type: 'text', text: 'preserve response text' },
      ],
    },
    {
      speaker: 'ai',
      blocks: [call('repeat', 'read_file', { absolute_path: 'same.ts' })],
    },
    { speaker: 'tool', blocks: [response('repeat')] },
    {
      speaker: 'ai',
      blocks: [
        call('many', 'read_many_files', {
          paths: ['same.ts', 42, 'other.ts', 'same.ts'],
        }),
      ],
    },
    { speaker: 'tool', blocks: [response('many', 'read_many_files')] },
    {
      speaker: 'ai',
      blocks: [
        call('glob', 'read_many_files', { paths: ['*.ts'] }),
        call('nonstring', 'read_file', { file_path: 3, path: 'same.ts' }),
        call('unicode', 'ast_read_file', { path: 'é.ts' }),
        call('different', 'read_file', { path: 'é.ts' }),
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        response('glob'),
        response('nonstring'),
        response('unicode'),
        response('different'),
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        call('raw/a', 'read_line_range', {
          path: 'same.ts',
          start_line: 2,
          end_line: 4,
        }),
        call('raw_a', 'read_file', { path: 'untouched.ts' }),
      ],
    },
    { speaker: 'tool', blocks: [response('raw/a'), response('raw_a')] },
    {
      speaker: 'ai',
      blocks: [
        call('dup', 'read_file', { path: 'same.ts' }),
        call('dup', 'other_tool', {}),
        { type: 'text', text: 'duplicate call group' },
      ],
    },
    { speaker: 'tool', blocks: [response('dup'), response('dup')] },
    {
      speaker: 'ai',
      blocks: [
        call('write', 'write_file', { absolute_path: 'same.ts' }),
        call('uwrite', 'replace', { path: 'é.ts' }),
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        response('write', 'write_file', 'denied'),
        response('uwrite', 'replace'),
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        call('after', 'read_file', { path: 'same.ts' }),
        call('same-row', 'read_file', { path: 'same.ts' }),
        call('same-row-write', 'write_file', { path: 'same.ts' }),
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        response('after'),
        response('same-row'),
        response('same-row-write', 'write_file'),
      ],
    },
    {
      speaker: 'human',
      blocks: [
        call('humanwrite', 'write_file', { path: 'untouched.ts' }),
        {
          type: 'text',
          text: '--- same.ts ---\nnew\n--- End of content ---\n',
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [call('other-write', 'ast_edit', { path: 'other.ts' })],
    },
    { speaker: 'tool', blocks: [response('other-write', 'ast_edit')] },
    { speaker: 'ai', blocks: [{ type: 'text', text: '' }] },
  ];
}
describe('native read/write policy contract', () => {
  it.each([1, 3, 5, 7])(
    'matches the array policy including raw IDs, failed writes, ranges and grouped blocks with mask %i',
    async (mask) => {
      await withNativeFallbackFixture(async ({ history, seed, durable }) => {
        await seed(fixture());
        const rows: IContent[] = [];
        for await (const row of history.streamRawHistory()) rows.push(row);
        const result = new HighDensityStrategy().optimize(
          rows,
          densityConfig(mask),
        );
        const expected = digestRows(
          invalidateResponsesStatefulChain(
            rows.flatMap((row, index) =>
              result.removals.includes(index)
                ? []
                : [result.replacements.get(index) ?? row],
            ),
          ),
        );
        await expect(
          operationFileCreates(
            () => densityHandler(history, mask).ensureDensityOptimized(),
            true,
          ),
        ).resolves.toStrictEqual({ directories: [], files: [] });
        expect(await digestStream(history.streamRawHistory())).toBe(expected);
        expect(await durable()).toStrictEqual(
          await compressionValueDigest(history.streamRawHistory()),
        );
        expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
      });
    },
  );

  it('counts only surviving responses when a raw ID appears before and after its read call', async () => {
    await withNativeFallbackFixture(async ({ history, seed, durable }) => {
      const keep = (id: string): IContent => ({
        speaker: 'ai',
        blocks: [call(id, 'read_file', { path: `keep-${id}` })],
      });
      const tool = (id: string): IContent => ({
        speaker: 'tool',
        blocks: [response(id)],
      });
      await seed([
        keep('k0'),
        tool('k0'),
        tool('late'),
        keep('k1'),
        tool('k1'),
        {
          speaker: 'ai',
          blocks: [call('late', 'read_file', { path: 'changed' })],
        },
        tool('late'),
        keep('k2'),
        tool('k2'),
        keep('k3'),
        tool('k3'),
        {
          speaker: 'ai',
          blocks: [call('w', 'write_file', { path: 'changed' })],
        },
      ]);
      const rows: IContent[] = [];
      for await (const row of history.streamRawHistory()) rows.push(row);
      const result = new HighDensityStrategy().optimize(rows, densityConfig(5));
      expect(result.metadata.readWritePairsPruned).toBe(2);
      expect(result.metadata.recencyPruned).toBe(1);
      const expected = digestRows(
        invalidateResponsesStatefulChain(
          rows.flatMap((row, index) =>
            result.removals.includes(index)
              ? []
              : [result.replacements.get(index) ?? row],
          ),
        ),
      );
      await densityHandler(history, 5).ensureDensityOptimized();
      expect(await digestStream(history.streamRawHistory())).toBe(expected);
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(history.streamRawHistory()),
      );
    });
  });
});
