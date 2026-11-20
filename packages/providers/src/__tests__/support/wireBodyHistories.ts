/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A1: the fixed histories of the golden wire-body corpus.
 *
 * Every history is plain data built from literals so the same inputs produce
 * the same request bytes on every run. Changing any value here changes the
 * golden bytes and needs an intentional fixture regeneration (see
 * wireBodyFixtures.ts).
 */

import type {
  IContent,
  MediaReferenceBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderToolset } from '../../IProvider.js';

/** What a history needs from the test run that cannot be a literal. */
export interface CorpusMedia {
  /** An admitted local-store image, sent as a media reference. */
  readonly imageReference: MediaReferenceBlock;
}

export interface HistoryCase {
  readonly id: string;
  readonly description: string;
  readonly rows: readonly IContent[];
  readonly systemInstruction?: string;
  readonly tools?: ProviderToolset;
  /** Whether the case needs the request media resolver bound. */
  readonly usesMediaReferences?: boolean;
  /** Invocation ephemeral settings the case turns on for its request. */
  readonly ephemerals?: Readonly<Record<string, unknown>>;
  /** Global settings the case turns on for its request. */
  readonly globalSettings?: Readonly<Record<string, unknown>>;
}

const PNG_DATA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const WEATHER_TOOLS = [
  {
    name: 'get_weather',
    description: 'Weather lookup',
    parametersJsonSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file',
    parametersJsonSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
  },
] as ProviderToolset;

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function ai(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function call(id: string, name: string, parameters: unknown): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters };
}

function response(
  callId: string,
  toolName: string,
  result: unknown,
): ToolResponseBlock {
  return { type: 'tool_response', callId, toolName, result };
}

function aiCalls(...calls: ToolCallBlock[]): IContent {
  return { speaker: 'ai', blocks: calls };
}

function toolResults(...responses: ToolResponseBlock[]): IContent {
  return { speaker: 'tool', blocks: responses };
}

function textOnly(): HistoryCase {
  return {
    id: 'text-only',
    description: 'plain alternating text turns',
    rows: [
      human('hello'),
      ai('hi there'),
      human('what is 2+2?'),
      ai('4'),
      human('thanks'),
    ],
  };
}

function systemAndTools(): HistoryCase {
  return {
    id: 'system-and-tools',
    description: 'system instruction and two declared tools, text history',
    rows: [human('weather in Paris?')],
    systemInstruction: 'You are a terse assistant.',
    tools: WEATHER_TOOLS,
  };
}

function toolCallsWithResults(): HistoryCase {
  return {
    id: 'tool-calls-with-results',
    description: 'two sequential tool round trips, then a follow-up',
    rows: [
      human('weather in Paris and London?'),
      aiCalls(call('hist_tool_1', 'get_weather', { city: 'Paris' })),
      toolResults(response('hist_tool_1', 'get_weather', { temp: 21 })),
      aiCalls(call('hist_tool_2', 'get_weather', { city: 'London' })),
      toolResults(response('hist_tool_2', 'get_weather', 'rainy, 14C')),
      ai('Paris 21C, London rainy 14C.'),
      human('thanks'),
    ],
    systemInstruction: 'You are a terse assistant.',
    tools: WEATHER_TOOLS,
  };
}

function parallelToolCalls(): HistoryCase {
  return {
    id: 'parallel-tool-calls',
    description: 'one assistant row with text and two calls, one tool row',
    rows: [
      human('read both files'),
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Reading both.' },
          call('call_a', 'read_file', { path: '/a.txt' }),
          call('call_b', 'read_file', { path: '/b.txt' }),
        ],
      },
      toolResults(
        response('call_a', 'read_file', 'alpha'),
        response('call_b', 'read_file', 'beta'),
      ),
      human('summarise'),
    ],
    tools: WEATHER_TOOLS,
  };
}

function orphanToolCall(): HistoryCase {
  return {
    id: 'orphan-tool-call',
    description: 'assistant tool call that never receives a result',
    rows: [
      human('read it'),
      aiCalls(call('orphan_1', 'read_file', { path: '/lost.txt' })),
      human('never mind, say hi'),
    ],
    tools: WEATHER_TOOLS,
  };
}

function orphanToolResult(): HistoryCase {
  return {
    id: 'orphan-tool-result',
    description: 'tool result whose call is not in the history',
    rows: [
      human('start'),
      toolResults(response('ghost_1', 'read_file', 'from nowhere')),
      ai('ok'),
      human('continue'),
    ],
    tools: WEATHER_TOOLS,
  };
}

function interleavedToolResults(): HistoryCase {
  return {
    id: 'interleaved-tool-results',
    description:
      'results arrive out of call order with a human row between call and result',
    rows: [
      human('read two files'),
      aiCalls(
        call('call_a', 'read_file', { path: '/a.txt' }),
        call('call_b', 'read_file', { path: '/b.txt' }),
      ),
      toolResults(response('call_b', 'read_file', 'beta')),
      human('hurry up'),
      toolResults(response('call_a', 'read_file', 'alpha')),
      ai('Both read.'),
      human('good'),
    ],
    tools: WEATHER_TOOLS,
  };
}

function displacedToolResult(): HistoryCase {
  return {
    id: 'displaced-tool-result',
    description:
      'result for an earlier call sits after a later assistant turn, one call has none',
    rows: [
      human('first'),
      aiCalls(call('call_1', 'read_file', { path: '/1.txt' })),
      ai('while waiting'),
      human('second'),
      aiCalls(
        call('call_2', 'read_file', { path: '/2.txt' }),
        call('call_3', 'read_file', { path: '/3.txt' }),
      ),
      toolResults(
        response('call_2', 'read_file', 'two'),
        response('call_1', 'read_file', 'one'),
      ),
      human('done?'),
    ],
    tools: WEATHER_TOOLS,
  };
}

function toolIdShapes(): HistoryCase {
  return {
    id: 'tool-id-shapes',
    description:
      'provider-foreign ids, a duplicated id and an unmapped result (id mapper rules)',
    rows: [
      human('go'),
      aiCalls(
        call('call_abcdefghijklmnop', 'read_file', { path: '/x' }),
        call('toolu_01ABCdefGHI', 'get_weather', { city: 'Oslo' }),
      ),
      toolResults(
        response('call_abcdefghijklmnop', 'read_file', 'x-body'),
        response('toolu_01ABCdefGHI', 'get_weather', 'cold'),
      ),
      aiCalls(call('call_abcdefghijklmnop', 'read_file', { path: '/y' })),
      toolResults(
        response('call_abcdefghijklmnop', 'read_file', 'y-body'),
        response('never_called', 'read_file', 'stray'),
      ),
      human('end'),
    ],
    tools: WEATHER_TOOLS,
  };
}

function reasoning(): HistoryCase {
  return {
    id: 'reasoning-thinking',
    description:
      'several assistant turns with thinking blocks, signatures and encrypted content',
    rows: [
      human('think hard'),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'first line of thought',
            sourceField: 'thinking',
            signature: 'sig-first',
            encryptedContent: 'enc-first',
          },
          { type: 'text', text: 'first answer' },
        ],
        metadata: { model: 'claude-opus-5' },
      },
      human('again'),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'second line of thought',
            sourceField: 'reasoning_content',
            signature: 'sig-second',
            encryptedContent: 'enc-second',
          },
          call('think_call', 'get_weather', { city: 'Rome' }),
        ],
        metadata: { model: 'claude-opus-5' },
      },
      toolResults(response('think_call', 'get_weather', 'sunny')),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'last line of thought',
            sourceField: 'thinking',
            signature: 'sig-last',
          },
          { type: 'text', text: 'It is sunny.' },
        ],
        metadata: { model: 'claude-opus-5' },
      },
      human('and tomorrow?'),
    ],
    tools: WEATHER_TOOLS,
  };
}

function thinkingOnlyChain(): HistoryCase {
  return {
    id: 'thinking-only-chain',
    description:
      'an assistant row with only thinking followed by consecutive assistant rows',
    rows: [
      human('go'),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'deciding',
            sourceField: 'thinking',
            signature: 'sig-chain',
          },
        ],
        metadata: { model: 'claude-opus-5' },
      },
      ai('part one'),
      ai('part two'),
      human('next'),
    ],
  };
}

function inlineImage(): HistoryCase {
  return {
    id: 'media-inline-image',
    description: 'a base64 image with a caption and a tool result',
    rows: [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'what is this?' },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: PNG_DATA,
          },
        ],
      },
      ai('a pixel'),
      human('and the url one?'),
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'url',
            data: 'https://example.test/pixel.png',
          },
        ],
      },
    ],
  };
}

function referenceImage(media: CorpusMedia): HistoryCase {
  return {
    id: 'media-reference-image',
    description: 'an admitted local-store image sent as a media reference',
    rows: [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'what is in the stored image?' },
          media.imageReference,
        ],
      },
      ai('a pixel'),
      human('thanks'),
    ],
    usesMediaReferences: true,
  };
}

function unicodeEdges(): HistoryCase {
  return {
    id: 'unicode-edges',
    description:
      'lone surrogates, U+2028, control characters and integer-like keys in tool input',
    rows: [
      human(
        'edge \ud800 lone high, \udc00 lone low, \u2028 \u2029 \u0000 \u001f',
      ),
      aiCalls(
        call('edge_call', 'read_file', {
          path: '/ü/雪.txt',
          '10': 'ten',
          '2': 'two',
          b: 1,
          a: [1, 2, { z: null }],
        }),
      ),
      toolResults(response('edge_call', 'read_file', 'line1\nline2\t"quoted"')),
      ai('emoji \ud83d\ude00 done'),
      human('end'),
    ],
    tools: WEATHER_TOOLS,
  };
}

function cacheTailUser(): HistoryCase {
  return {
    id: 'cache-tail-user',
    description:
      'long text history ending on a human row (cache breakpoint on the tail)',
    rows: [
      human('one'),
      ai('two'),
      human('three'),
      ai('four'),
      human('five'),
      ai('six'),
      human('seven'),
    ],
    systemInstruction: 'Stable system prompt.',
    tools: WEATHER_TOOLS,
  };
}

function cacheTailToolResult(): HistoryCase {
  return {
    id: 'cache-tail-tool-result',
    description: 'history ending on a tool result row',
    rows: [
      human('one'),
      aiCalls(call('tail_call', 'read_file', { path: '/t.txt' })),
      toolResults(response('tail_call', 'read_file', 'tail body')),
    ],
    systemInstruction: 'Stable system prompt.',
    tools: WEATHER_TOOLS,
  };
}

function cacheTailAssistant(): HistoryCase {
  return {
    id: 'cache-tail-assistant',
    description: 'history ending on an assistant text row',
    rows: [human('one'), ai('two'), human('three'), ai('four')],
  };
}

function cacheAnchor(): HistoryCase {
  return {
    id: 'cache-anchor',
    description:
      'a compression-preserved head marked as the cache anchor, then newer turns',
    rows: [
      human('summary of earlier work'),
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'acknowledged' }],
        metadata: { cacheAnchor: true },
      },
      human('new question'),
      ai('new answer'),
      human('another question'),
    ],
    systemInstruction: 'Stable system prompt.',
  };
}

function cacheTailThinking(): HistoryCase {
  return {
    id: 'cache-tail-thinking',
    description:
      'history ending on an assistant row whose last block is thinking',
    rows: [
      human('one'),
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'visible answer' },
          {
            type: 'thinking',
            thought: 'trailing thought',
            sourceField: 'thinking',
            signature: 'sig-tail',
          },
        ],
        metadata: { model: 'claude-opus-5' },
      },
    ],
  };
}

function mediaPurgeBoundary(): HistoryCase {
  return {
    id: 'cache-media-purge-boundary',
    description:
      'semantic media purge on: a tagged stable prefix, then the oldest image',
    rows: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'stable prefix' }],
        metadata: {
          semanticMediaPurgeBoundary: {
            blockIndex: 0,
            boundaryId: Object.freeze({}),
          },
        },
      },
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: PNG_DATA,
          },
        ],
      },
      ai('seen'),
      human('tail'),
    ],
    globalSettings: { 'media.semantic-purge': 'remove' },
  };
}

function statefulResponsesParent(): HistoryCase {
  return {
    id: 'responses-stateful-parent',
    description:
      'an assistant row stored server-side by the Responses API, then newer rows',
    rows: [
      human('first question'),
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'stored answer' }],
        metadata: {
          id: 'resp_stored_parent',
          responsesStored: true,
          providerBaseURL: 'https://api.openai.com/v1',
          usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 },
        },
      },
      human('second question'),
      aiCalls(call('stateful_call', 'read_file', { path: '/s.txt' })),
    ],
    ephemerals: { 'responses-stateful': true },
    tools: WEATHER_TOOLS,
  };
}

function blocklessRow(): HistoryCase {
  return {
    id: 'blockless-row',
    description: 'a row with an empty block list between text turns',
    rows: [
      human('before'),
      { speaker: 'ai', blocks: [] },
      ai('after'),
      human('end'),
    ],
  };
}

export function buildHistoryCases(media: CorpusMedia): HistoryCase[] {
  return [
    textOnly(),
    systemAndTools(),
    toolCallsWithResults(),
    parallelToolCalls(),
    orphanToolCall(),
    orphanToolResult(),
    interleavedToolResults(),
    displacedToolResult(),
    toolIdShapes(),
    reasoning(),
    thinkingOnlyChain(),
    inlineImage(),
    referenceImage(media),
    unicodeEdges(),
    cacheTailUser(),
    cacheTailToolResult(),
    cacheTailAssistant(),
    cacheAnchor(),
    cacheTailThinking(),
    mediaPurgeBoundary(),
    statefulResponsesParent(),
    blocklessRow(),
  ];
}
