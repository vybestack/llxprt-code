/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { publicAnthropicTailCase } from './support/public-anthropic-tail.js';

const history: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'question 雪' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'old thought',
        sourceField: 'thinking',
        signature: 'old-sig',
      },
      { type: 'text', text: 'old answer' },
    ],
  },
  {
    speaker: 'human',
    metadata: { cacheAnchor: true },
    blocks: [{ type: 'text', text: 'anchored question' }],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'last thought',
        sourceField: 'thinking',
        signature: 'last-sig',
      },
      { type: 'text', text: 'answer' },
    ],
  },
];
const message: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'continue 🐈 雪' }],
};
const caches: ReadonlyArray<'off' | '5m' | '1h'> = ['off', '5m', '1h'];
const policies: ReadonlyArray<'none' | 'all' | 'allButLast'> = [
  'none',
  'all',
  'allButLast',
];

describe('native Anthropic public pending user sends', () => {
  it.each(
    caches.flatMap((cache) => policies.map((strip) => ({ cache, strip }))),
  )(
    'preserves builder bytes, lengths and file-free estimation/send for $cache/$strip',
    async ({ cache, strip }) => {
      const result = await publicAnthropicTailCase(
        history,
        message,
        cache,
        strip,
      );
      expect(result.output).toBe('ok');
      expect(result.changedSources).toStrictEqual([1]);
      expect(result.requests).toHaveLength(2);
      expect(result.requests[0]).toStrictEqual(result.requests[1]);
      expect(result.requests[0].length).toBe(
        String(Buffer.byteLength(result.requests[0].body)),
      );
      expect(result.created).toStrictEqual({ files: [], directories: [] });
    },
  );
  it.each([
    { name: 'empty prefix', history: [] },
    { name: 'merged user run', history: [history[0]] },
    {
      name: 'unterminated tool call',
      history: [
        history[0],
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_unfinished',
              name: 'lookup',
              parameters: {},
            },
          ],
        },
      ],
    },
  ] satisfies Array<{ name: string; history: readonly IContent[] }>)(
    'preserves $name with a cached pending user row',
    async ({ history: prior }) => {
      const result = await publicAnthropicTailCase(prior, message, '1h');
      expect(result.output).toBe('ok');
      expect(result.requests).toHaveLength(2);
      expect(result.requests[0]).toStrictEqual(result.requests[1]);
      expect(result.requests[0].length).toBe(
        String(Buffer.byteLength(result.requests[0].body)),
      );
      expect(result.created).toStrictEqual({ files: [], directories: [] });
    },
  );
});
