/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 WP08: the OpenAI chat transport reads `requestRows` itself and
 * builds the complete chat `messages` body once. The body must be
 * byte-identical to the independent array route, live in exactly one
 * request-scoped lease that serves estimation and send, and be released on
 * every outcome. Only the SDK transport is faked.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { GenerateChatOptions, ProviderToolset } from '../IProvider.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';
import { createOpenAIRawPostTestAdapter } from '../__tests__/rawPostTestAdapters.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { OpenAIProvider } from './OpenAIProvider.js';

const mockChatCreate = vi.fn();

void vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    ...createOpenAIRawPostTestAdapter(mockChatCreate),
    chat: { completions: { create: mockChatCreate } },
  })),
}));

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

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
  readonly tools?: ProviderToolset;
  readonly streaming?: boolean;
  readonly globalSettings?: Record<string, unknown>;
  readonly providerSettings?: Record<string, unknown>;
}

function arrayOptions(
  scenario: Scenario,
  signal?: AbortSignal,
): GenerateChatOptions {
  return streamCallOptions({
    providerName: 'openai',
    contents: scenario.rows,
    tools: scenario.tools,
    systemInstruction: 'system prompt',
    resolved: { model: 'gpt-4o' },
    ephemerals: {
      streaming: scenario.streaming === true ? 'enabled' : 'disabled',
    },
    settingsOverrides: {
      ...(scenario.globalSettings === undefined
        ? {}
        : { global: scenario.globalSettings }),
      ...(scenario.providerSettings === undefined
        ? {}
        : { provider: scenario.providerSettings }),
    },
    ...(signal === undefined ? {} : { metadata: { abortSignal: signal } }),
  });
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
    readRequestRowsAtTransport: true,
  };
}

function okResponse(streaming: boolean) {
  if (!streaming) {
    return {
      id: 'chatcmpl-1',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  }
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: 'ok' } }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
    },
  };
}

async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const out: IContent[] = [];
  for await (const chunk of iterator) out.push(chunk);
  return out;
}

/** Request bodies the fake transport received, serialized exactly. */
function sentBodies(): string[] {
  return mockChatCreate.mock.calls.map((call) => JSON.stringify(call[0]));
}

async function sendArray(scenario: Scenario): Promise<string[]> {
  mockChatCreate.mockReset();
  mockChatCreate.mockResolvedValue(okResponse(scenario.streaming === true));
  const provider = new OpenAIProvider('test-key');
  await drain(provider.generateChatCompletion(arrayOptions(scenario)));
  return sentBodies();
}

async function sendRows(scenario: Scenario): Promise<string[]> {
  mockChatCreate.mockReset();
  mockChatCreate.mockResolvedValue(okResponse(scenario.streaming === true));
  const provider = new OpenAIProvider('test-key');
  const probe = probeRows(scenario.rows);
  await drain(provider.generateChatCompletion(rowsOptions(scenario, probe)));
  expect(probe.opened()).toBe(1);
  expect(probe.returned()).toBe(1);
  return sentBodies();
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
] as ProviderToolset;

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

const reasoningTurns: IContent[] = [
  text('human', 'think about it'),
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'previous reasoning',
        sourceField: 'reasoning_content',
      },
      { type: 'text', text: 'answer' },
    ],
  },
  text('human', 'continue'),
];

const mediaTurns: IContent[] = [
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'what is this?' },
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
        encoding: 'base64',
      },
    ],
  },
];

describe('OpenAI chat transport-owned request rows body (WP08)', () => {
  beforeEach(() => {
    mockChatCreate.mockReset();
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
      'reasoning content',
      {
        rows: reasoningTurns,
        globalSettings: { 'reasoning.includeInContext': true },
      },
    ],
    [
      'cache fields and provider overrides',
      {
        rows: toolTurns,
        tools: WEATHER_TOOL,
        providerSettings: {
          prompt_cache_key: 'cache-key-wp08',
          temperature: 0.25,
          max_tokens: 321,
        },
      },
    ],
    ['media', { rows: mediaTurns }],
    ['streaming request', { rows: [text('human', 'stream')], streaming: true }],
  ];

  it.each(cases)(
    'sends the array route bytes for %s',
    async (_name, scenario) => {
      const arrayBodies = await sendArray(scenario);
      const rowBodies = await sendRows(scenario);
      expect(arrayBodies).toHaveLength(1);
      expect(rowBodies).toStrictEqual(arrayBodies);
    },
  );

  it('keeps reasoning, tool pairing, cache fields, overrides and media in the compared bodies', async () => {
    const [reasoning] = await sendRows({
      rows: reasoningTurns,
      globalSettings: { 'reasoning.includeInContext': true },
    });
    expect(reasoning).toContain('previous reasoning');
    const [tools] = await sendRows({ rows: toolTurns, tools: WEATHER_TOOL });
    expect(tools).toContain('"tool_call_id":"call_1"');
    expect(tools).toContain('"tool_choice":"auto"');
    const [cached] = await sendRows({
      rows: toolTurns,
      providerSettings: {
        prompt_cache_key: 'cache-key-wp08',
        temperature: 0.25,
      },
    });
    expect(cached).toContain('cache-key-wp08');
    expect(cached).toContain('"temperature":0.25');
    const [media] = await sendRows({ rows: mediaTurns });
    expect(media).toContain('image_url');
  });

  it('rejects rows whose count changed after selection', async () => {
    const scenario: Scenario = {
      rows: [text('human', 'a'), text('human', 'b')],
    };
    const provider = new OpenAIProvider('test-key');
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(scenario, probe);
    const wrong = { ...options, requestRows: { ...probe.selection, count: 3 } };
    await expect(drain(provider.generateChatCompletion(wrong))).rejects.toThrow(
      'Provider request rows count changed',
    );
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(activeRequestBodyCount()).toBe(0);
  });
});

describe('OpenAI chat request rows preparation lifecycle (WP08)', () => {
  const scenario: Scenario = { rows: toolTurns, tools: WEATHER_TOOL };

  beforeEach(() => {
    mockChatCreate.mockReset();
  });

  it('holds one request body lease for estimate and send, released after the call', async () => {
    const provider = new OpenAIProvider('test-key');
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(scenario, probe);
    const before = activeRequestBodyCount();
    const projection = await provider.projectPromptEnvelope(options);
    expect(activeRequestBodyCount()).toBe(before + 1);
    expect(probe.opened()).toBe(1);
    // The estimate graph is derived from the one body on demand, not kept.
    const first = projection.finalizedProjection;
    expect(projection.finalizedProjection).not.toBe(first);
    expect(projection.finalizedProjection).toStrictEqual(first);
    expect(await projection.legacyEstimate()).toBeGreaterThan(0);

    let during = -1;
    mockChatCreate.mockImplementation(() => {
      during = activeRequestBodyCount();
      return okResponse(false);
    });
    await drain(
      provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      }),
    );
    expect(during).toBe(before + 1);
    expect(activeRequestBodyCount()).toBe(before);
    // Send reused the prepared body: the rows were read once, at projection.
    expect(probe.opened()).toBe(1);
    expect(sentBodies()).toStrictEqual(await sendArray(scenario));
  });

  it('estimates the same finalized projection as the array route', async () => {
    const rowProvider = new OpenAIProvider('test-key');
    const rowProjection = await rowProvider.projectPromptEnvelope(
      rowsOptions(scenario, probeRows(scenario.rows)),
    );
    const arrayProvider = new OpenAIProvider('test-key');
    const arrayProjection = await arrayProvider.projectPromptEnvelope(
      arrayOptions(scenario),
    );
    expect(rowProjection.finalizedProjection).toStrictEqual(
      arrayProjection.finalizedProjection,
    );
    expect(await rowProjection.legacyEstimate()).toBe(
      await arrayProjection.legacyEstimate(),
    );
    expect(rowProjection.unsupportedMedia).toStrictEqual(
      arrayProjection.unsupportedMedia,
    );
    await rowProjection.releaseIfUnsent?.();
    await arrayProjection.releaseIfUnsent?.();
  });

  it('reports unsupported media from the rows before they are dropped', async () => {
    const media: Scenario = {
      rows: [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'video/mp4',
              data: 'AAAA',
              encoding: 'base64',
            },
          ],
        },
      ],
    };
    const rowProjection = await new OpenAIProvider(
      'test-key',
    ).projectPromptEnvelope(rowsOptions(media, probeRows(media.rows)));
    const arrayProjection = await new OpenAIProvider(
      'test-key',
    ).projectPromptEnvelope(arrayOptions(media));
    expect(rowProjection.unsupportedMedia).toStrictEqual(
      arrayProjection.unsupportedMedia,
    );
    await rowProjection.releaseIfUnsent?.();
    await arrayProjection.releaseIfUnsent?.();
  });

  it('releases an unsent preparation and refuses later estimation', async () => {
    const provider = new OpenAIProvider('test-key');
    const options = rowsOptions(scenario, probeRows(scenario.rows));
    const before = activeRequestBodyCount();
    const projection = await provider.projectPromptEnvelope(options);
    expect(activeRequestBodyCount()).toBe(before + 1);
    await projection.releaseIfUnsent?.();
    expect(activeRequestBodyCount()).toBe(before);
    expect(() => projection.finalizedProjection).toThrow(
      'consumed after release',
    );
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('releases the body when the send fails', async () => {
    const provider = new OpenAIProvider('test-key');
    const options = rowsOptions(scenario, probeRows(scenario.rows));
    const before = activeRequestBodyCount();
    mockChatCreate.mockRejectedValue(new Error('transport exploded'));
    await expect(
      drain(provider.generateChatCompletion(options)),
    ).rejects.toThrow('transport exploded');
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the consumer returns mid-stream', async () => {
    const streaming: Scenario = { rows: toolTurns, streaming: true };
    const provider = new OpenAIProvider('test-key');
    const options = rowsOptions(streaming, probeRows(streaming.rows));
    const before = activeRequestBodyCount();
    mockChatCreate.mockResolvedValue(okResponse(true));
    const iterator = provider.generateChatCompletion(options);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(activeRequestBodyCount()).toBe(before + 1);
    await iterator.return?.();
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the request is aborted during the call', async () => {
    const provider = new OpenAIProvider('test-key');
    const controller = new AbortController();
    const options = rowsOptions(
      scenario,
      probeRows(scenario.rows),
      controller.signal,
    );
    const before = activeRequestBodyCount();
    mockChatCreate.mockImplementation(() => {
      controller.abort(new Error('aborted mid call'));
      throw controller.signal.reason;
    });
    await expect(
      drain(provider.generateChatCompletion(options)),
    ).rejects.toThrow('aborted mid call');
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('never opens the rows when cancelled before the first pull', async () => {
    const provider = new OpenAIProvider('test-key');
    const controller = new AbortController();
    controller.abort(new Error('cancelled early'));
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(scenario, probe, controller.signal);
    const before = activeRequestBodyCount();
    await expect(
      drain(provider.generateChatCompletion(options)),
    ).rejects.toThrow('cancelled early');
    expect(probe.pulled()).toBe(0);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('closes the reader and sends nothing when cancelled after the first chunk', async () => {
    const provider = new OpenAIProvider('test-key');
    const controller = new AbortController();
    const probe = probeRows(scenario.rows, () => {
      controller.abort(new Error('cancelled after first chunk'));
    });
    const options = rowsOptions(scenario, probe, controller.signal);
    const before = activeRequestBodyCount();
    await expect(provider.projectPromptEnvelope(options)).rejects.toThrow(
      'cancelled after first chunk',
    );
    expect(probe.pulled()).toBe(1);
    expect(probe.returned()).toBe(1);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(activeRequestBodyCount()).toBe(before);
  });
});

function rateLimitError(): Error {
  const error = new Error('Rate limit exceeded') as Error & {
    status?: number;
  };
  error.status = 429;
  return error;
}

describe('OpenAI chat request rows retry bytes (WP08)', () => {
  async function retryWith(route: 'array' | 'rows'): Promise<string[]> {
    mockChatCreate.mockReset();
    mockChatCreate
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValue(okResponse(true));
    const scenario: Scenario = {
      rows: toolTurns,
      tools: WEATHER_TOOL,
      streaming: true,
    };
    const provider = new OpenAIProvider('test-key');
    const options =
      route === 'array'
        ? arrayOptions(scenario)
        : rowsOptions(scenario, probeRows(scenario.rows));
    const before = activeRequestBodyCount();
    const projection = await provider.projectPromptEnvelope(options);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });
    await drain(
      orchestrator.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      }),
    );
    expect(activeRequestBodyCount()).toBe(before);
    return sentBodies();
  }

  it('retries a rate-limited request with the array route bytes', async () => {
    const arrayBodies = await retryWith('array');
    const rowBodies = await retryWith('rows');
    expect(arrayBodies).toHaveLength(2);
    expect(arrayBodies[1]).toBe(arrayBodies[0]);
    expect(rowBodies).toStrictEqual(arrayBodies);
  });
});
