/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildMessagesWithReasoning } from '../openai/OpenAIRequestBuilder.js';
import { buildResponsesInputFromContent } from '../openai-responses/buildResponsesInputFromContent.js';
import { buildResponsesRequest } from '../openai/buildResponsesRequest.js';
import { convertToAnthropicMessages } from '../anthropic/AnthropicMessageNormalizer.js';
import { convertToVercelMessages } from '../openai-vercel/messageConversion.js';
import { buildProviderDumpBody } from './providerRequestConversion.js';

/**
 * Issue #1721 constraint C1.
 *
 * `metadata.chronology` / `metadata.chronologyReplaced` are client-side
 * debugging markers stamped on EVERY history item. Providers reject unknown
 * fields on message objects with HTTP 400 (z.ai already does this for empty
 * human turns, issue #2410), so a leak here would break every request for the
 * affected provider.
 *
 * `deepCloneWithoutCircularRefs` copies metadata, so chronology genuinely
 * travels with IContent right up to each converter. These tests are the
 * regression guard that it stops there.
 *
 * When a new provider wire converter is added, add it to CONVERTERS below.
 */

const SENTINEL_SEQ = 987_654;
const SENTINEL_USER_TURN = 4_242;
const SENTINEL_STEP = 3_131;
const SENTINEL_RECORDED_AT = 1_759_123_456_789;
const SENTINEL_FROM_SEQ = 111_222;
const SENTINEL_TO_SEQ = 333_444;
const SENTINEL_ITEM_COUNT = 555_666;

const CHRONOLOGY_SENTINELS = [
  String(SENTINEL_SEQ),
  String(SENTINEL_USER_TURN),
  String(SENTINEL_STEP),
  String(SENTINEL_RECORDED_AT),
  String(SENTINEL_FROM_SEQ),
  String(SENTINEL_TO_SEQ),
  String(SENTINEL_ITEM_COUNT),
];

function chronologyMetadata(): IContent['metadata'] {
  return {
    chronology: {
      seq: SENTINEL_SEQ,
      userTurn: SENTINEL_USER_TURN,
      step: SENTINEL_STEP,
      recordedAt: SENTINEL_RECORDED_AT,
    },
    chronologyReplaced: {
      fromSeq: SENTINEL_FROM_SEQ,
      toSeq: SENTINEL_TO_SEQ,
      itemCount: SENTINEL_ITEM_COUNT,
    },
  };
}

/**
 * A representative conversation covering every speaker and block type that can
 * reach a provider, with chronology markers on every entry.
 */
function chronologyBearingHistory(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'list the files' }],
      metadata: chronologyMetadata(),
    },
    {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'I will list them.' },
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'list_directory',
          parameters: { path: '.' },
        },
      ],
      metadata: chronologyMetadata(),
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'list_directory',
          result: 'README.md',
        },
      ],
      metadata: chronologyMetadata(),
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'There is one file.' }],
      metadata: { ...chronologyMetadata(), isSummary: true },
    },
  ];
}

function settingsStub(): SettingsService {
  return { get: () => undefined } as unknown as SettingsService;
}

const CONVERTERS: ReadonlyArray<{
  readonly name: string;
  readonly convert: (history: IContent[]) => unknown;
}> = [
  {
    name: 'OpenAI chat (buildMessagesWithReasoning)',
    convert: (history) =>
      buildMessagesWithReasoning(
        history,
        { settings: settingsStub() },
        'openai',
        undefined,
      ),
  },
  {
    name: 'OpenAI Responses (buildResponsesInputFromContent)',
    convert: (history) => buildResponsesInputFromContent(history),
  },
  {
    name: 'OpenAI Responses legacy (buildResponsesRequest)',
    convert: (history) =>
      buildResponsesRequest({ model: 'gpt-5', messages: history }),
  },
  {
    name: 'Anthropic (convertToAnthropicMessages)',
    convert: (history) =>
      convertToAnthropicMessages(history, {
        isOAuth: false,
        reasoningEnabled: false,
        config: undefined,
        unprefixToolName: (name: string) => name,
        logger: new DebugLogger('llxprt:test:chronology-isolation'),
      }),
  },
  {
    name: 'Vercel (convertToVercelMessages)',
    convert: (history) => convertToVercelMessages(history),
  },
  {
    name: 'dump body: openai',
    convert: (history) =>
      buildProviderDumpBody({ providerName: 'openai', history }),
  },
  {
    name: 'dump body: anthropic',
    convert: (history) =>
      buildProviderDumpBody({ providerName: 'anthropic', history }),
  },
  {
    // Also the Gemini wire-converter guard: buildProviderDumpBody delegates to
    // the real convertHistoryToGeminiFormat. It is reached through the
    // provider-neutral entry point so this file does not import a
    // Gemini-prefixed symbol outside its architectural boundary.
    name: 'dump body: gemini',
    convert: (history) =>
      buildProviderDumpBody({ providerName: 'gemini', history }),
  },
];

describe('chronology markers never reach a provider wire payload (#1721 C1)', () => {
  it.each(CONVERTERS)('$name emits no chronology key', ({ convert }) => {
    const serialized = JSON.stringify(convert(chronologyBearingHistory()));

    expect(serialized).not.toContain('chronology');
  });

  it.each(CONVERTERS)('$name emits no chronology values', ({ convert }) => {
    const serialized = JSON.stringify(convert(chronologyBearingHistory()));

    for (const sentinel of CHRONOLOGY_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it.each(CONVERTERS)(
    '$name still emits the conversation content',
    ({ convert }) => {
      const serialized = JSON.stringify(convert(chronologyBearingHistory()));

      expect(serialized).toContain('list the files');
    },
  );
});
