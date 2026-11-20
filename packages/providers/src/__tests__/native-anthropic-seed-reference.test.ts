/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { formatById } from './support/frozenWire/frozenCases.js';
import { referenceSeedBody } from './support/native-seed-reference.js';
import { checkNativeSeed } from './support/native-seed-cases.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';

const rows: readonly IContent[] = [
  {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'dup', name: 'tool', parameters: {} },
      { type: 'tool_call', id: 'dup', name: 'tool', parameters: {} },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'between' }] },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'dup',
        toolName: 'tool',
        result: 'result',
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
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id: 'kept', name: 'tool', parameters: {} }],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'tail' }] },
];

const expectedMessages = [
  { role: 'user', content: 'Continue the conversation' },
  {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'toolu_dup', name: 'tool', input: {} },
      { type: 'tool_use', id: 'toolu_dup', name: 'tool', input: {} },
    ],
  },
  {
    role: 'user',
    content: [
      ...[0, 1].map(() => ({
        type: 'tool_result',
        tool_use_id: 'toolu_dup',
        content: [
          { type: 'text', text: 'result' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'YQ==',
            },
          },
        ],
      })),
      { type: 'text', text: 'between' },
    ],
  },
  {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_kept', name: 'tool', input: {} }],
  },
  {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_kept',
        content: '[tool execution interrupted]',
        is_error: true,
      },
      { type: 'text', text: 'tail' },
    ],
  },
];

describe('independent Anthropic seed reference duplicate result movement', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(() => setSystemTime());

  it('moves a result for both duplicate calls without deleting the following assistant row', () => {
    const body = referenceSeedBody(
      formatById('anthropic-cache-off'),
      {
        form: 'raw',
        model: 'claude-sonnet-4',
        ephemerals: {},
        providerSettings: { 'prompt-caching': 'off' },
        systemInstruction: 'test system prompt',
      },
      rows,
    );
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('messages' in parsed)
    )
      throw new Error('Expected a request body containing messages');
    expect(parsed.messages).toStrictEqual(expectedMessages);
  });

  for (const id of [
    'anthropic-cache-off',
    'anthropic-cache-5m',
    'anthropic-cache-1h',
    'anthropic-purge-boundary',
  ]) {
    for (const seed of [
      20, 25, 79, 80, 81, 101, 106, 139, 169, 216, 235, 237, 238, 239, 2049,
    ]) {
      it(`${id} seed ${seed} preserves frozen provider and independently curated service bytes`, async () => {
        await expect(
          checkNativeSeed(formatById(id), seed),
        ).resolves.toBeUndefined();
      });
    }
  }
});
