/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { nativeFileDedupe } from '../native-file-dedupe.js';
import {
  densityConfig,
  densityHandler,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';

function inclusion(path: string, value: string): string {
  return `--- ${path} ---\n${value}\n--- End of content ---\n`;
}
function fixture(): readonly IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: inclusion('./a/../same.ts', 'old') }],
      metadata: {},
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: inclusion('same.ts', 'AI must survive') }],
    },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: inclusion(resolve('same.ts'), 'first tie winner'),
        },
        { type: 'text', text: inclusion('same.ts', 'second tie loser') },
        { type: 'text', text: inclusion('Case.ts', 'case upper stays') },
        { type: 'text', text: inclusion('case.ts', 'case lower stays') },
      ],
    },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: `prefix\n${inclusion('offset.ts', 'higher offset wins')}`,
        },
        {
          type: 'text',
          text: inclusion('offset.ts', 'later block lower offset loses'),
        },
        {
          type: 'text',
          text:
            inclusion('other.ts', 'different text') +
            '\n\n\n' +
            inclusion('other.ts', 'same row last'),
        },
        { type: 'text', text: '--- unclosed.ts ---\nleave intact' },
      ],
    },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'tool_response',
          callId: '',
          toolName: 'read_file',
          result: inclusion('same.ts', 'human result stays'),
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'multi1',
          name: 'read_file',
          parameters: { path: 'same.ts' },
        },
        {
          type: 'tool_call',
          id: 'multi2',
          name: 'functions.write_file',
          parameters: {
            absolute_path: resolve('same.ts'),
            content: 'text',
            minor: true,
          },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'multi2',
          toolName: 'write_file',
          result: 'failure',
          error: 'denied',
        },
        {
          type: 'tool_response',
          callId: 'multi1',
          toolName: 'read_file',
          result: inclusion('same.ts', 'tool result stays'),
        },
      ],
    },
    { speaker: 'ai', blocks: [{ type: 'text', text: '' }] },
  ];
}

describe('native file inclusion policy contract', () => {
  it('preserves old-array path, case, multi-block offset ties, nonhuman blocks and failed operations', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      await seed(fixture());
      const rows: IContent[] = [];
      for await (const row of history.streamRawHistory()) rows.push(row);
      const result = new HighDensityStrategy().optimize(rows, densityConfig(2));
      const expected = digestRows(
        invalidateResponsesStatefulChain(
          rows.map((row, index) => result.replacements.get(index) ?? row),
        ),
      );
      const files = await operationFileCreates(
        () => densityHandler(history, 2).ensureDensityOptimized(),
        true,
      );
      expect(await digestStream(history.streamRawHistory())).toBe(expected);
      expect(files).toStrictEqual({ directories: [], files: [] });
      expect(result.metadata.fileDeduplicationsPruned).toBeGreaterThan(0);
    });
  });

  it('captures path normalization settings in a value-stable typed revision', () => {
    const a = nativeFileDedupe('/workspace/a').facts.revision;
    expect(nativeFileDedupe('/workspace/a/../a').facts.revision).toBe(a);
    expect(nativeFileDedupe('/workspace/b').facts.revision).not.toBe(a);
    expect(JSON.parse(a)).toStrictEqual([
      'file-inclusions:1',
      '/workspace/a',
      'row-desc-offset-desc-stable:1',
    ]);
  });
});
