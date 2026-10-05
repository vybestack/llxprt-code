/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildProviderDumpBody,
  buildProviderDumpBodyStream,
} from './providerRequestConversion.js';
import { streamPrettyJson } from './streamPrettyJson.js';

const cases: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
  { speaker: 'human', blocks: [{ type: 'text', text: ' ' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'a' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: '' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'signed',
        sourceField: 'thinking',
        signature: 'sig',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'mixed' },
      { type: 'thinking', thought: 'other', sourceField: 'reasoning_content' },
      { type: 'tool_call', id: 'call_a', name: 'tool', parameters: {} },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'call_a', name: 'tool', parameters: 'oops' },
      { type: 'tool_call', id: 'call_b', name: 'tool', parameters: null },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_a',
        toolName: 'tool',
        result: 'a',
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_b',
        toolName: 'tool',
        result: 'b',
      },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'YQ==',
      },
    ],
  },
  {
    speaker: 'human',
    blocks: [
      { type: 'thinking', thought: 'user thought', sourceField: 'thinking' },
      { type: 'text', text: 'text' },
    ],
  },
  {
    speaker: 'human',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_a',
        toolName: 'tool',
        result: 'human result',
      },
    ],
  },
];
async function streamBytes(
  history: readonly IContent[],
  providerName: string,
  policy: string,
): Promise<string> {
  const source = {
    async *rows(): AsyncIterable<IContent> {
      yield* structuredClone(history);
    },
  };
  const body = buildProviderDumpBodyStream({
    providerName,
    history: source,
    settings: {
      get: (key: string): unknown =>
        key === 'reasoning.stripFromContext' ? policy : true,
    },
  });

  let bytes = '';
  for await (const chunk of streamPrettyJson(body)) bytes += chunk;
  return bytes;
}
function eagerBytes(
  history: readonly IContent[],
  providerName: string,
  policy: string,
): string {
  return JSON.stringify(
    buildProviderDumpBody({
      providerName,
      history: structuredClone([...history]),
      settings: {
        get: (key: string): unknown =>
          key === 'reasoning.stripFromContext' ? policy : true,
      },
    }),
    null,
    2,
  );
}
function generatedHistory(initial: number): {
  history: IContent[];
  state: number;
} {
  let state = initial;
  const history: IContent[] = [];
  for (let index = 0; index < 12; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    history.push(cases[state % cases.length]);
  }
  return { history, state };
}
describe('dump conversation-wide eager oracle parity', () => {
  for (const providerName of ['openai', 'anthropic'])
    for (const policy of ['none', 'allButLast', 'all']) {
      it(`${providerName} ${policy} preserves seeded broken and interrupted tool sequences`, async () => {
        let state = 854;
        for (let seed = 0; seed < 64; seed++) {
          const history: IContent[] = [];
          const generated = generatedHistory(state);
          history.push(...generated.history);
          state = generated.state;
          expect(await streamBytes(history, providerName, policy)).toBe(
            eagerBytes(history, providerName, policy),
          );
        }
      });
    }
});
describe('dump merged thinking-chain parity', () => {
  it('preserves tool results embedded in merged thinking chains', async () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'embedded',
            name: 'read_file',
            parameters: {},
          },
        ],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'gap' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'thought', sourceField: 'thinking' },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'reply' },
          {
            type: 'tool_response',
            callId: 'embedded',
            toolName: 'read_file',
            result: 'result',
          },
        ],
      },
    ];
    expect(await streamBytes(history, 'anthropic', 'none')).toBe(
      eagerBytes(history, 'anthropic', 'none'),
    );
    const media: IContent = {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: String.fromCharCode(10) + '  more "雪"' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'YQ==',
        },
        {
          type: 'media',
          mimeType: 'application/pdf',
          encoding: 'url',
          data: 'https://example.com/a.pdf',
        },
        {
          type: 'tool_response',
          callId: 'embedded',
          toolName: 'read_file',
          result: 'second',
          error: 'tool failed',
        },
      ],
    };
    for (const policy of ['none', 'all', 'allButLast']) {
      const extended = [...history, media];
      expect(await streamBytes(extended, 'anthropic', policy)).toBe(
        eagerBytes(extended, 'anthropic', policy),
      );
    }
  });
});
describe('dump empty assistant parity', () => {
  it('preserves merged empty assistants before the thinking trailing placeholder', async () => {
    const history: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      cases[3],
      cases[3],
    ];
    expect(await streamBytes(history, 'anthropic', 'none')).toBe(
      eagerBytes(history, 'anthropic', 'none'),
    );
  });
});
