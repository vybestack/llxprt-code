/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 WP09: the Gemini transport reads `requestRows` itself and builds
 * the SDK `Content[]` once. The request sent to the SDK must be identical to
 * the independent array route, live in one request-scoped lease, and be
 * released on every outcome. Only the SDK client is faked.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { GenerateChatOptions } from '@vybestack/llxprt-code-providers/IProvider.js';
import type { IProviderConfig } from '@vybestack/llxprt-code-providers/types/IProviderConfig.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  GeminiProvider,
  type CreateGeminiApiClient,
} from '../gemini/GeminiProvider.js';
import { createProviderCallOptions } from './testSupport.js';

interface FakeSdkState {
  /** JSON of each request, captured at call time (before lease release). */
  sent: string[];
  /** Request objects as handed to the SDK, to inspect after release. */
  requests: Array<{ contents: unknown[] }>;
  leasesDuringSend: number[];
  failure?: Error;
  onSend?: () => void;
  chunks: Array<Record<string, unknown>>;
}

const sdk: FakeSdkState = {
  sent: [],
  requests: [],
  leasesDuringSend: [],
  chunks: [],
};

function resetSdk(): void {
  sdk.sent = [];
  sdk.requests = [];
  sdk.leasesDuringSend = [];
  sdk.failure = undefined;
  sdk.onSend = undefined;
  sdk.chunks = [{ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }];
}

function recordSend(request: { contents: unknown[] }): void {
  sdk.sent.push(JSON.stringify(request));
  sdk.requests.push(request);
  sdk.leasesDuringSend.push(activeRequestBodyCount());
  sdk.onSend?.();
  if (sdk.failure !== undefined) throw sdk.failure;
}

const fakeClientFactory = (async () => ({
  models: {
    generateContentStream: async (request: { contents: unknown[] }) => {
      recordSend(request);
      const chunks = sdk.chunks;
      return (async function* () {
        yield* chunks;
      })();
    },
    generateContent: async (request: { contents: unknown[] }) => {
      recordSend(request);
      return sdk.chunks[0];
    },
  },
})) as unknown as CreateGeminiApiClient;

class TestGeminiProvider extends GeminiProvider {
  constructor(streaming: boolean) {
    super('test-key', undefined, undefined, fakeClientFactory);
    const current = (this as unknown as { providerConfig?: IProviderConfig })
      .providerConfig;
    (this as unknown as { providerConfig?: IProviderConfig }).providerConfig = {
      ...(current ?? {}),
      getEphemeralSettings: () => ({
        streaming: streaming ? 'enabled' : 'disabled',
      }),
    };
  }
}

interface RowProbe {
  readonly selection: ProviderRequestSelection;
  readonly opened: () => number;
  readonly pulled: () => number;
  readonly returned: () => number;
}

function probeRows(rows: IContent[], onPull?: () => void): RowProbe {
  let opened = 0;
  let pulled = 0;
  let returned = 0;
  const selection: ProviderRequestSelection = Object.freeze({
    count: rows.length,
    openReader: (signal?: AbortSignal) => {
      opened += 1;
      return (async function* (): AsyncGenerator<IContent, void> {
        try {
          for (const row of rows) {
            signal?.throwIfAborted();
            pulled += 1;
            yield row;
            onPull?.();
          }
        } finally {
          returned += 1;
        }
      })();
    },
    close: () => undefined,
  });
  return {
    selection,
    opened: () => opened,
    pulled: () => pulled,
    returned: () => returned,
  };
}

interface Scenario {
  readonly rows: IContent[];
  readonly tools?: GenerateChatOptions['tools'];
  readonly streaming?: boolean;
  readonly ephemerals?: Record<string, unknown>;
}

function arrayOptions(
  scenario: Scenario,
  signal?: AbortSignal,
): GenerateChatOptions {
  const base = createProviderCallOptions({
    providerName: 'gemini',
    contents: replay(scenario.rows),
    tools: scenario.tools,
    ephemerals: scenario.ephemerals,
  });
  if (signal === undefined) return base;
  return {
    ...base,
    invocation: { ...base.invocation, signal },
  };
}

function replay(rows: IContent[]): AsyncIterable<IContent> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
      yield* rows;
    },
  };
}

function rowsOptions(
  scenario: Scenario,
  probe: RowProbe,
  signal?: AbortSignal,
): GenerateChatOptions {
  return {
    ...arrayOptions(scenario, signal),
    contents: {
      [Symbol.asyncIterator]: () => {
        throw new Error('The transport must read requestRows, not contents');
      },
    },
    requestRows: probe.selection,
    contentCount: scenario.rows.length,
  };
}

async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const out: IContent[] = [];
  for await (const chunk of iterator) out.push(chunk);
  return out;
}

async function sendArray(scenario: Scenario): Promise<string[]> {
  resetSdk();
  const provider = new TestGeminiProvider(scenario.streaming !== false);
  await drain(provider.generateChatCompletion(arrayOptions(scenario)));
  return sdk.sent;
}

async function sendRows(scenario: Scenario): Promise<string[]> {
  resetSdk();
  const provider = new TestGeminiProvider(scenario.streaming !== false);
  const probe = probeRows(scenario.rows);
  await drain(provider.generateChatCompletion(rowsOptions(scenario, probe)));
  expect(probe.opened()).toBe(1);
  expect(probe.returned()).toBe(1);
  return sdk.sent;
}

const text = (speaker: 'human' | 'ai', value: string): IContent => ({
  speaker,
  blocks: [{ type: 'text', text: value }],
});

const WEATHER_TOOL = [
  {
    name: 'get_weather',
    description: 'Weather lookup',
    parametersJsonSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
    },
  },
] as GenerateChatOptions['tools'];

const toolTurns: IContent[] = [
  text('human', 'weather in Paris?'),
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'hist_tool_1',
        name: 'get_weather',
        parameters: { city: 'Paris' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'get_weather',
        result: { temp: 21 },
      },
    ],
  },
  text('human', 'and London?'),
];

const activeLoopTurns = toolTurns.slice(0, 3);

const thinkingTurns: IContent[] = [
  text('human', 'think about it'),
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'previous reasoning wp09',
        sourceField: 'thought',
      },
      {
        type: 'tool_call',
        id: 'hist_tool_2',
        name: 'get_weather',
        parameters: { city: 'Rome' },
      },
    ],
  } as IContent,
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_tool_2',
        toolName: 'get_weather',
        result: { temp: 30 },
      },
    ],
  },
  text('human', 'continue'),
];

const mediaTurns: IContent[] = [
  {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
        encoding: 'base64',
      },
      { type: 'text', text: 'what is this wp09 image?' },
    ],
  },
];

describe('Gemini transport-owned request rows body (WP09)', () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    resetSdk();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  const cases: ReadonlyArray<readonly [string, Scenario]> = [
    [
      'text',
      {
        rows: [
          text('human', 'hello'),
          text('ai', 'hi'),
          text('human', 'again'),
        ],
      },
    ],
    ['tools and tool pairing', { rows: toolTurns, tools: WEATHER_TOOL }],
    [
      'thought signatures in the active tool loop',
      { rows: activeLoopTurns, tools: WEATHER_TOOL },
    ],
    [
      'unstripped reasoning context',
      {
        rows: thinkingTurns,
        tools: WEATHER_TOOL,
        ephemerals: { 'reasoning.stripFromContext': 'none' },
      },
    ],
    [
      'reasoning settings with stripped context',
      {
        rows: thinkingTurns,
        tools: WEATHER_TOOL,
        ephemerals: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
          'reasoning.stripFromContext': 'all',
        },
      },
    ],
    ['media', { rows: mediaTurns }],
    [
      'non-streaming request',
      { rows: [text('human', 'one shot')], streaming: false },
    ],
  ];

  it.each(cases)(
    'sends the array route request for %s',
    async (_name, scenario) => {
      const arrayBodies = await sendArray(scenario);
      const rowBodies = await sendRows(scenario);
      expect(arrayBodies).toHaveLength(1);
      expect(rowBodies).toStrictEqual(arrayBodies);
    },
  );

  it('keeps tool pairing, thought signatures and media in the compared requests', async () => {
    const [tools] = await sendRows({ rows: toolTurns, tools: WEATHER_TOOL });
    expect(tools).toContain('functionResponse');
    expect(tools).toContain('hist_tool_1');
    const [signed] = await sendRows({
      rows: activeLoopTurns,
      tools: WEATHER_TOOL,
    });
    expect(signed).toContain('thoughtSignature');
    const [media] = await sendRows({ rows: mediaTurns });
    expect(media).toContain('inlineData');
  });

  it('rejects rows whose count changed after selection', async () => {
    const scenario: Scenario = {
      rows: [text('human', 'a'), text('human', 'b')],
    };
    const provider = new TestGeminiProvider(true);
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(scenario, probe);
    const wrong = { ...options, requestRows: { ...probe.selection, count: 3 } };
    const before = activeRequestBodyCount();
    await expect(drain(provider.generateChatCompletion(wrong))).rejects.toThrow(
      'Provider request rows count changed',
    );
    expect(sdk.sent).toHaveLength(0);
    expect(activeRequestBodyCount()).toBe(before);
  });
});

describe('Gemini request rows preparation lifecycle (WP09)', () => {
  const scenario: Scenario = { rows: toolTurns, tools: WEATHER_TOOL };
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    resetSdk();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it('holds exactly one SDK body lease during send and releases its arrays afterwards', async () => {
    const provider = new TestGeminiProvider(true);
    const probe = probeRows(scenario.rows);
    const before = activeRequestBodyCount();
    await drain(provider.generateChatCompletion(rowsOptions(scenario, probe)));
    expect(sdk.leasesDuringSend).toStrictEqual([before + 1]);
    expect(activeRequestBodyCount()).toBe(before);
    expect(probe.opened()).toBe(1);
    expect(sdk.requests[0].contents).toHaveLength(0);
  });

  it('reads the rows again for a retried call and sends the same request', async () => {
    const provider = new TestGeminiProvider(true);
    const probe = probeRows(scenario.rows);
    const before = activeRequestBodyCount();
    sdk.failure = new Error('transient transport failure');
    await expect(
      drain(provider.generateChatCompletion(rowsOptions(scenario, probe))),
    ).rejects.toThrow('transient transport failure');
    expect(activeRequestBodyCount()).toBe(before);
    sdk.failure = undefined;
    await drain(provider.generateChatCompletion(rowsOptions(scenario, probe)));
    expect(probe.opened()).toBe(2);
    expect(probe.returned()).toBe(2);
    expect(sdk.sent).toHaveLength(2);
    expect(sdk.sent[1]).toBe(sdk.sent[0]);
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the send fails', async () => {
    const provider = new TestGeminiProvider(true);
    const before = activeRequestBodyCount();
    sdk.failure = new Error('transport exploded');
    await expect(
      drain(
        provider.generateChatCompletion(
          rowsOptions(scenario, probeRows(scenario.rows)),
        ),
      ),
    ).rejects.toThrow('transport exploded');
    expect(activeRequestBodyCount()).toBe(before);
    expect(sdk.requests[0].contents).toHaveLength(0);
  });

  it('releases the body when the consumer returns mid-stream', async () => {
    const provider = new TestGeminiProvider(true);
    sdk.chunks = [
      { candidates: [{ content: { parts: [{ text: 'one' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'two' }] } }] },
    ];
    const before = activeRequestBodyCount();
    const iterator = provider.generateChatCompletion(
      rowsOptions(scenario, probeRows(scenario.rows)),
    );
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(activeRequestBodyCount()).toBe(before + 1);
    await iterator.return?.();
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the request is aborted during the call', async () => {
    const provider = new TestGeminiProvider(true);
    const controller = new AbortController();
    const before = activeRequestBodyCount();
    sdk.failure = new Error('aborted mid call');
    sdk.onSend = () => controller.abort(sdk.failure);
    await expect(
      drain(
        provider.generateChatCompletion(
          rowsOptions(scenario, probeRows(scenario.rows), controller.signal),
        ),
      ),
    ).rejects.toThrow('aborted mid call');
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('never opens the rows when cancelled before the first pull', async () => {
    const provider = new TestGeminiProvider(true);
    const controller = new AbortController();
    controller.abort(new Error('cancelled early'));
    const probe = probeRows(scenario.rows);
    const before = activeRequestBodyCount();
    await expect(
      drain(
        provider.generateChatCompletion(
          rowsOptions(scenario, probe, controller.signal),
        ),
      ),
    ).rejects.toThrow('cancelled early');
    expect(probe.pulled()).toBe(0);
    expect(sdk.sent).toHaveLength(0);
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('closes the reader and sends nothing when cancelled after the first chunk', async () => {
    const provider = new TestGeminiProvider(true);
    const controller = new AbortController();
    const probe = probeRows(scenario.rows, () => {
      controller.abort(new Error('cancelled after first chunk'));
    });
    const before = activeRequestBodyCount();
    await expect(
      drain(
        provider.generateChatCompletion(
          rowsOptions(scenario, probe, controller.signal),
        ),
      ),
    ).rejects.toThrow('cancelled after first chunk');
    expect(probe.pulled()).toBe(1);
    expect(probe.returned()).toBe(1);
    expect(sdk.sent).toHaveLength(0);
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases an unsent preparation when the client cannot be created', async () => {
    const provider = new (class extends GeminiProvider {
      constructor() {
        super('test-key', undefined, undefined, (() =>
          Promise.reject(
            new Error('client unavailable'),
          )) as unknown as CreateGeminiApiClient);
      }
    })();
    const probe = probeRows(scenario.rows);
    const before = activeRequestBodyCount();
    await expect(
      drain(provider.generateChatCompletion(rowsOptions(scenario, probe))),
    ).rejects.toThrow('client unavailable');
    expect(probe.returned()).toBe(1);
    expect(sdk.sent).toHaveLength(0);
    expect(activeRequestBodyCount()).toBe(before);
  });
});
