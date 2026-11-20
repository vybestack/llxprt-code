/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { publicAnthropicTailCase } from './support/public-anthropic-tail.js';

const question: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'question 雪' }],
};
const call: IContent = {
  speaker: 'ai',
  blocks: [
    {
      type: 'tool_call',
      id: 'hist_tool_lookup',
      name: 'lookup',
      parameters: {},
    },
  ],
};
const result: IContent = {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: 'hist_tool_lookup',
      toolName: 'lookup',
      result: 'found 🐈',
    },
  ],
};
const scenarios: ReadonlyArray<{
  name: string;
  history: readonly IContent[];
  message: IContent;
}> = [
  {
    name: 'pending results paired with historical calls',
    history: [question, call],
    message: result,
  },
  {
    name: 'pending orphan and repeated tool IDs',
    history: [question, call, result, question, call],
    message: {
      ...result,
      blocks: [
        ...result.blocks,
        {
          type: 'tool_response',
          callId: 'hist_tool_orphan',
          toolName: 'lookup',
          result: 'orphan result',
        },
      ],
    },
  },
];

const caches: ReadonlyArray<'off' | '5m' | '1h'> = ['off', '5m', '1h'];
const policies: ReadonlyArray<'none' | 'all' | 'allButLast'> = [
  'none',
  'all',
  'allButLast',
];

describe('native Anthropic changed-source public session HTTP', () => {
  it.each(
    scenarios.flatMap((scenario) =>
      caches.flatMap((cache) =>
        policies.map((strip) => ({ ...scenario, cache, strip })),
      ),
    ),
  )(
    'sends $name, $cache/$strip with the spooled builder bytes and no request files',
    async ({ history, message, cache, strip }) => {
      const result = await publicAnthropicTailCase(
        history,
        message,
        cache,
        strip,
      );
      expect(result.output).toBe('ok');
      expect(result.changedSources).toHaveLength(1);
      expect(result.changedSources[0]).toBeGreaterThan(0);
      expect(result.requests).toHaveLength(2);
      expect(result.requests[0]).toStrictEqual(result.requests[1]);
      expect(result.requests[0].length).toBe(
        String(Buffer.byteLength(result.requests[0].body)),
      );
      expect(result.created).toStrictEqual({ files: [], directories: [] });
    },
  );
});
