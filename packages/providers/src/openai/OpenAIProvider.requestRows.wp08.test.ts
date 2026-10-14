/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 WP08: the OpenAI chat transport reads `requestRows` itself and
 * writes the chat `messages` body once, row by row, into a request-scoped
 * spool. The body must be byte-identical to the independent array route; the
 * spool serves the send and the estimator files written with it serve
 * estimation; both are released on every outcome. Only the SDK transport is
 * faked.
 */

import { readAtOf } from '../__tests__/requestRowsTestSupport.js';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { GenerateChatOptions, ProviderToolset } from '../IProvider.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';
import { createOpenAIRawPostTestAdapter } from '../__tests__/rawPostTestAdapters.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { Gpt56SourceProjection } from '../tokenizers/gpt56-source-projection.js';
import { activeWireBodySpoolCount } from '../utils/wire-body-spool.js';
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
    readAt: readAtOf(rows),
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
  // Pass 1 indexes the rows, pass 2 converts them; each reader is returned.
  expect(probe.opened()).toBe(2);
  expect(probe.returned()).toBe(2);
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
    expect(activeWireBodySpoolCount()).toBe(0);
  });
});

const tokenizerFactory = createRuntimeTokenizerFactory();

function sourceOf(projection: PromptEnvelopeProjection): Gpt56SourceProjection {
  const finalized = projection.finalizedProjection;
  if (!(finalized instanceof Gpt56SourceProjection)) {
    throw new Error('Expected a segment-file projection');
  }
  return finalized;
}

function directoryOf(source: Gpt56SourceProjection): string {
  return dirname(source.promptSegments[0].source.path);
}

function segmentBytes(source: Gpt56SourceProjection): Buffer[] {
  return source.promptSegments.map((segment) =>
    readFileSync(segment.source.path),
  );
}

async function tokensOf(
  provider: OpenAIProvider,
  projection: PromptEnvelopeProjection,
): Promise<number> {
  const estimate = await estimatePromptEnvelope(
    provider.name,
    projection,
    tokenizerFactory,
  );
  return estimate.estimatedPromptTokens;
}

describe('OpenAI chat request rows preparation lifecycle (WP08)', () => {
  const scenario: Scenario = { rows: toolTurns, tools: WEATHER_TOOL };

  beforeEach(() => {
    mockChatCreate.mockReset();
  });

  it('writes the body spool and the estimator files at projection, serves send and estimate from them, and releases both after the call', async () => {
    const provider = new OpenAIProvider('test-key');
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(scenario, probe);
    const before = activeWireBodySpoolCount();
    const projection = await provider.projectPromptEnvelope(options);
    expect(activeWireBodySpoolCount()).toBe(before + 1);
    expect(probe.opened()).toBe(2);
    // The estimate reads sealed estimator-form files, the same ones on every
    // access; the files are not copies of the wire or dump forms.
    const source = sourceOf(projection);
    expect(projection.finalizedProjection).toBe(source);
    expect(
      source.promptSegments.map((segment) => segment.promptKey),
    ).toStrictEqual(['messages', 'tools']);
    for (const segment of source.promptSegments) {
      expect(segment.wireSource).toBeUndefined();
      expect(segment.dumpSource).toBeUndefined();
      expect(existsSync(segment.source.path)).toBe(true);
    }
    expect(await tokensOf(provider, projection)).toBeGreaterThan(0);
    expect(await tokensOf(provider, projection)).toBe(
      await tokensOf(provider, projection),
    );

    let during = -1;
    let filesDuring = false;
    mockChatCreate.mockImplementation(() => {
      during = activeWireBodySpoolCount();
      filesDuring = existsSync(directoryOf(source));
      return okResponse(false);
    });
    await drain(
      provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      }),
    );
    expect(during).toBe(before + 1);
    expect(filesDuring).toBe(true);
    expect(activeWireBodySpoolCount()).toBe(before);
    expect(existsSync(directoryOf(source))).toBe(false);
    // Send reused the prepared body: the rows were read at projection only.
    expect(probe.opened()).toBe(2);
    expect(sentBodies()).toStrictEqual(await sendArray(scenario));
  });

  it('estimates from the same prompt files as the array route', async () => {
    const rowProvider = new OpenAIProvider('test-key');
    const rowProjection = await rowProvider.projectPromptEnvelope(
      rowsOptions(scenario, probeRows(scenario.rows)),
    );
    const arrayProvider = new OpenAIProvider('test-key');
    const arrayProjection = await arrayProvider.projectPromptEnvelope(
      arrayOptions(scenario),
    );
    expect(segmentBytes(sourceOf(rowProjection))).toStrictEqual(
      segmentBytes(sourceOf(arrayProjection)),
    );
    expect(await tokensOf(rowProvider, rowProjection)).toBe(
      await tokensOf(arrayProvider, arrayProjection),
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
    const before = activeWireBodySpoolCount();
    const projection = await provider.projectPromptEnvelope(options);
    expect(activeWireBodySpoolCount()).toBe(before + 1);
    const source = sourceOf(projection);
    await projection.releaseIfUnsent?.();
    expect(activeWireBodySpoolCount()).toBe(before);
    expect(existsSync(directoryOf(source))).toBe(false);
    await expect(tokensOf(provider, projection)).rejects.toThrow(
      'Source projection is disposed',
    );
    expect(mockChatCreate).not.toHaveBeenCalled();
  });

  it('releases the body when the send fails', async () => {
    const provider = new OpenAIProvider('test-key');
    const options = rowsOptions(scenario, probeRows(scenario.rows));
    const before = activeWireBodySpoolCount();
    mockChatCreate.mockRejectedValue(new Error('transport exploded'));
    await expect(
      drain(provider.generateChatCompletion(options)),
    ).rejects.toThrow('transport exploded');
    expect(activeWireBodySpoolCount()).toBe(before);
  });

  it('releases the body when the consumer returns mid-stream', async () => {
    const streaming: Scenario = { rows: toolTurns, streaming: true };
    const provider = new OpenAIProvider('test-key');
    const options = rowsOptions(streaming, probeRows(streaming.rows));
    const before = activeWireBodySpoolCount();
    mockChatCreate.mockResolvedValue(okResponse(true));
    const iterator = provider.generateChatCompletion(options);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(activeWireBodySpoolCount()).toBe(before + 1);
    await iterator.return?.();
    expect(activeWireBodySpoolCount()).toBe(before);
  });

  it('releases the body when the request is aborted during the call', async () => {
    const provider = new OpenAIProvider('test-key');
    const controller = new AbortController();
    const options = rowsOptions(
      scenario,
      probeRows(scenario.rows),
      controller.signal,
    );
    const before = activeWireBodySpoolCount();
    mockChatCreate.mockImplementation(() => {
      controller.abort(new Error('aborted mid call'));
      throw controller.signal.reason;
    });
    await expect(
      drain(provider.generateChatCompletion(options)),
    ).rejects.toThrow('aborted mid call');
    expect(activeWireBodySpoolCount()).toBe(before);
  });

  it('never opens the rows when cancelled before the first pull', async () => {
    const provider = new OpenAIProvider('test-key');
    const controller = new AbortController();
    controller.abort(new Error('cancelled early'));
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(scenario, probe, controller.signal);
    const before = activeWireBodySpoolCount();
    await expect(
      drain(provider.generateChatCompletion(options)),
    ).rejects.toThrow('cancelled early');
    expect(probe.pulled()).toBe(0);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(activeWireBodySpoolCount()).toBe(before);
  });

  it('closes the reader and sends nothing when cancelled after the first chunk', async () => {
    const provider = new OpenAIProvider('test-key');
    const controller = new AbortController();
    const probe = probeRows(scenario.rows, () => {
      controller.abort(new Error('cancelled after first chunk'));
    });
    const options = rowsOptions(scenario, probe, controller.signal);
    const before = activeWireBodySpoolCount();
    const scratchBefore = readdirSync(getScratchRoot());
    await expect(provider.projectPromptEnvelope(options)).rejects.toThrow(
      'cancelled after first chunk',
    );
    expect(probe.pulled()).toBe(1);
    expect(probe.returned()).toBe(1);
    expect(mockChatCreate).not.toHaveBeenCalled();
    expect(activeWireBodySpoolCount()).toBe(before);
    expect(readdirSync(getScratchRoot())).toStrictEqual(scratchBefore);
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
    const before = activeWireBodySpoolCount();
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
    expect(activeWireBodySpoolCount()).toBe(before);
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
