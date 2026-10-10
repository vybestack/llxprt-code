/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 WP07: the Anthropic transport reads `requestRows` itself and
 * builds the Messages-SDK body once. The body must be byte-identical to the
 * independent array route, live in exactly one request-scoped lease that
 * serves estimation, send and image-recovery retry, and be released on every
 * outcome. Only the SDK transport is faked.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { APIError } from '@anthropic-ai/sdk';
import sharp from 'sharp';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { ProviderToolset } from '../IProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { TEST_PROVIDER_CONFIG } from '../__tests__/providerTestConfig.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';
import { createAnthropicRawPostTestAdapter } from '../__tests__/rawPostTestAdapters.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { AnthropicProvider } from './AnthropicProvider.js';

const mockMessagesCreate = vi.fn();

void vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    ...createAnthropicRawPostTestAdapter(mockMessagesCreate),
    messages: { create: mockMessagesCreate },
  })),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

const OAUTH_TOKEN = 'sk-ant-oat-wp07-token';

interface Harness {
  readonly provider: AnthropicProvider;
  readonly settings: ReturnType<typeof setup>['settings'];
  readonly runtime: ReturnType<typeof setup>['runtime'];
}

function setup(oauth: boolean, cache: boolean, streaming: boolean) {
  const result = createProviderWithRuntime<AnthropicProvider>(
    ({ settingsService: svc }) => {
      svc.set('auth-key', oauth ? OAUTH_TOKEN : 'test-api-key');
      svc.set('activeProvider', 'anthropic');
      svc.setProviderSetting(
        'anthropic',
        'streaming',
        streaming ? 'enabled' : 'disabled',
      );
      svc.setProviderSetting(
        'anthropic',
        'prompt-caching',
        cache ? '5m' : 'off',
      );
      return new AnthropicProvider(
        oauth ? OAUTH_TOKEN : 'test-api-key',
        undefined,
        TEST_PROVIDER_CONFIG,
      );
    },
    { runtimeId: 'anthropic.wp07', metadata: { source: 'wp07' } },
  );
  const { provider, runtime, settingsService } = result;
  runtime.config ??= createRuntimeConfigStub(settingsService);
  const ephemerals = {
    ...settingsService.getAllGlobalSettings(),
    ...settingsService.getProviderSettings(provider.name),
  };
  runtime.config.getEphemeralSettings = () => ({ ...ephemerals });
  runtime.config.getEphemeralSetting = (key: string) =>
    settingsService.getProviderSettings(provider.name)[key] ??
    settingsService.get(key);
  return { provider, settings: settingsService, runtime };
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
  readonly tools?: ProviderToolset;
  readonly oauth?: boolean;
  readonly cache?: boolean;
  readonly streaming?: boolean;
}

function arrayOptions(
  harness: Harness,
  scenario: Scenario,
  signal?: AbortSignal,
): GenerateChatOptions {
  const invocation = createRuntimeInvocationContext({
    runtime: harness.runtime,
    settings: harness.settings,
    providerName: 'anthropic',
    ephemeralsSnapshot: {
      ...harness.settings.getAllGlobalSettings(),
      ...harness.settings.getProviderSettings('anthropic'),
    },
    ...(signal === undefined ? {} : { signal }),
  });
  return streamCallOptions({
    providerName: 'anthropic',
    contents: scenario.rows,
    tools: scenario.tools,
    settings: harness.settings,
    runtime: harness.runtime,
    config: harness.runtime.config,
    invocation,
  });
}

function rowsOptions(
  harness: Harness,
  scenario: Scenario,
  probe: RowProbe,
  signal?: AbortSignal,
): GenerateChatOptions {
  const base = arrayOptions(harness, scenario, signal);
  return {
    ...base,
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

function makeHarness(scenario: Scenario): Harness {
  const built = setup(
    scenario.oauth === true,
    scenario.cache === true,
    scenario.streaming === true,
  );
  return {
    provider: built.provider,
    settings: built.settings,
    runtime: built.runtime,
  };
}

function okResponse(streaming: boolean) {
  if (!streaming) {
    return {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'ok' },
      };
      yield { type: 'message_stop' };
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
  return mockMessagesCreate.mock.calls.map((call) => JSON.stringify(call[0]));
}

async function sendArray(scenario: Scenario): Promise<string[]> {
  mockMessagesCreate.mockReset();
  mockMessagesCreate.mockResolvedValue(okResponse(scenario.streaming === true));
  const harness = makeHarness(scenario);
  await drain(
    harness.provider.generateChatCompletion(arrayOptions(harness, scenario)),
  );
  return sentBodies();
}

async function sendRows(scenario: Scenario): Promise<string[]> {
  mockMessagesCreate.mockReset();
  mockMessagesCreate.mockResolvedValue(okResponse(scenario.streaming === true));
  const harness = makeHarness(scenario);
  const probe = probeRows(scenario.rows);
  await drain(
    harness.provider.generateChatCompletion(
      rowsOptions(harness, scenario, probe),
    ),
  );
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

const thinkingTurns: IContent[] = [
  text('human', 'think about it'),
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'previous reasoning',
        sourceField: 'thinking',
        signature: 'sig-wp07',
      },
      { type: 'text', text: 'answer' },
    ],
    metadata: { model: 'claude-opus-5' },
  } as IContent,
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
      { type: 'text', text: 'what is this?' },
    ],
  },
];

describe('Anthropic transport-owned request rows body (WP07)', () => {
  beforeEach(() => {
    mockMessagesCreate.mockReset();
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
    ['thinking blocks and signatures', { rows: thinkingTurns }],
    [
      'cache boundaries',
      {
        rows: [...toolTurns, text('ai', 'sunny'), text('human', 'ok')],
        tools: WEATHER_TOOL,
        cache: true,
      },
    ],
    ['media', { rows: mediaTurns }],
    [
      'OAuth Claude Code prompt',
      { rows: toolTurns, tools: WEATHER_TOOL, oauth: true },
    ],
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

  it('keeps thinking signatures and cache_control in the compared bodies', async () => {
    const [thinking] = await sendRows({ rows: thinkingTurns });
    expect(thinking).toContain('sig-wp07');
    const [cached] = await sendRows({
      rows: toolTurns,
      tools: WEATHER_TOOL,
      cache: true,
    });
    expect(cached).toContain('cache_control');
    const [oauth] = await sendRows({
      rows: toolTurns,
      tools: WEATHER_TOOL,
      oauth: true,
    });
    expect(oauth).toContain('Claude Code');
  });

  it('rejects rows whose count changed after selection', async () => {
    const scenario: Scenario = {
      rows: [text('human', 'a'), text('human', 'b')],
    };
    const harness = makeHarness(scenario);
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(harness, scenario, probe);
    const wrong = { ...options, requestRows: { ...probe.selection, count: 3 } };
    await expect(
      drain(harness.provider.generateChatCompletion(wrong)),
    ).rejects.toThrow('Provider request rows count changed');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(activeRequestBodyCount()).toBe(0);
  });
});

describe('Anthropic request rows preparation lifecycle (WP07)', () => {
  const scenario: Scenario = { rows: toolTurns, tools: WEATHER_TOOL };

  beforeEach(() => {
    mockMessagesCreate.mockReset();
  });

  it('holds one request body lease for estimate and send, released after the call', async () => {
    const harness = makeHarness(scenario);
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(harness, scenario, probe);
    const before = activeRequestBodyCount();
    const projection = await harness.provider.projectPromptEnvelope(options);
    expect(activeRequestBodyCount()).toBe(before + 1);
    expect(probe.opened()).toBe(1);
    // The estimate graph is derived from the one body on demand, not kept.
    const first = projection.finalizedProjection;
    expect(projection.finalizedProjection).not.toBe(first);
    expect(projection.finalizedProjection).toStrictEqual(first);
    expect(await projection.legacyEstimate()).toBeGreaterThan(0);

    let during = -1;
    mockMessagesCreate.mockImplementation(async () => {
      during = activeRequestBodyCount();
      return okResponse(false);
    });
    await drain(
      harness.provider.generateChatCompletion({
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
    const harness = makeHarness(scenario);
    const rowProjection = await harness.provider.projectPromptEnvelope(
      rowsOptions(harness, scenario, probeRows(scenario.rows)),
    );
    const arrayHarness = makeHarness(scenario);
    const arrayProjection = await arrayHarness.provider.projectPromptEnvelope(
      arrayOptions(arrayHarness, scenario),
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

  it('releases an unsent preparation and refuses later estimation', async () => {
    const harness = makeHarness(scenario);
    const options = rowsOptions(harness, scenario, probeRows(scenario.rows));
    const before = activeRequestBodyCount();
    const projection = await harness.provider.projectPromptEnvelope(options);
    expect(activeRequestBodyCount()).toBe(before + 1);
    await projection.releaseIfUnsent?.();
    expect(activeRequestBodyCount()).toBe(before);
    expect(() => projection.finalizedProjection).toThrow(
      'consumed after release',
    );
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('releases the body when the send fails', async () => {
    const harness = makeHarness(scenario);
    const options = rowsOptions(harness, scenario, probeRows(scenario.rows));
    const before = activeRequestBodyCount();
    mockMessagesCreate.mockRejectedValue(new Error('transport exploded'));
    await expect(
      drain(harness.provider.generateChatCompletion(options)),
    ).rejects.toThrow('transport exploded');
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the consumer returns mid-stream', async () => {
    const streaming: Scenario = { rows: toolTurns, streaming: true };
    const harness = makeHarness(streaming);
    const options = rowsOptions(harness, streaming, probeRows(streaming.rows));
    const before = activeRequestBodyCount();
    mockMessagesCreate.mockResolvedValue(okResponse(true));
    const iterator = harness.provider.generateChatCompletion(options);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(activeRequestBodyCount()).toBe(before + 1);
    await iterator.return?.();
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the request is aborted during the call', async () => {
    const harness = makeHarness(scenario);
    const controller = new AbortController();
    const options = rowsOptions(
      harness,
      scenario,
      probeRows(scenario.rows),
      controller.signal,
    );
    const before = activeRequestBodyCount();
    mockMessagesCreate.mockImplementation(async () => {
      controller.abort(new Error('aborted mid call'));
      throw controller.signal.reason;
    });
    await expect(
      drain(harness.provider.generateChatCompletion(options)),
    ).rejects.toThrow('aborted mid call');
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('never opens the rows when cancelled before the first pull', async () => {
    const harness = makeHarness(scenario);
    const controller = new AbortController();
    controller.abort(new Error('cancelled early'));
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(harness, scenario, probe, controller.signal);
    const before = activeRequestBodyCount();
    await expect(
      drain(harness.provider.generateChatCompletion(options)),
    ).rejects.toThrow('cancelled early');
    expect(probe.pulled()).toBe(0);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('closes the reader and sends nothing when cancelled after the first chunk', async () => {
    const harness = makeHarness(scenario);
    const controller = new AbortController();
    const probe = probeRows(scenario.rows, () => {
      controller.abort(new Error('cancelled after first chunk'));
    });
    const options = rowsOptions(harness, scenario, probe, controller.signal);
    const before = activeRequestBodyCount();
    await expect(
      harness.provider.projectPromptEnvelope(options),
    ).rejects.toThrow('cancelled after first chunk');
    expect(probe.pulled()).toBe(1);
    expect(probe.returned()).toBe(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(activeRequestBodyCount()).toBe(before);
  });
});

async function pngBase64(size: number): Promise<string> {
  const buffer = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return buffer.toString('base64');
}

function imageDimensionError(): Error {
  return APIError.generate(
    400,
    {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels',
      },
    },
    undefined,
    new Headers({ 'request-id': 'req_wp07' }),
  );
}

describe('Anthropic request rows image recovery retry bytes (WP07)', () => {
  async function recoverWith(route: 'array' | 'rows'): Promise<string[]> {
    mockMessagesCreate.mockReset();
    mockMessagesCreate
      .mockRejectedValueOnce(imageDimensionError())
      .mockResolvedValue(okResponse(false));
    const rows: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: await pngBase64(2100),
            encoding: 'base64',
          },
          { type: 'text', text: 'describe' },
        ],
      },
    ];
    const scenario: Scenario = { rows };
    const harness = makeHarness(scenario);
    const options =
      route === 'array'
        ? arrayOptions(harness, scenario)
        : rowsOptions(harness, scenario, probeRows(rows));
    const before = activeRequestBodyCount();
    await drain(harness.provider.generateChatCompletion(options));
    expect(activeRequestBodyCount()).toBe(before);
    return sentBodies();
  }

  it('retries once with the sanitized body and the array route bytes', async () => {
    const arrayBodies = await recoverWith('array');
    const rowBodies = await recoverWith('rows');
    expect(arrayBodies).toHaveLength(2);
    expect(arrayBodies[1]).not.toBe(arrayBodies[0]);
    expect(rowBodies).toStrictEqual(arrayBodies);
  });
});
