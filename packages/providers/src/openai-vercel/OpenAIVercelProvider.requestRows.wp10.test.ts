/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 WP10: the Vercel transport reads `requestRows` itself and builds
 * the AI SDK `ModelMessage[]` once. The HTTP request the real AI SDK sends
 * must be byte-identical to the independent array route, the message arrays
 * live in one request-scoped lease, and the lease is released on every
 * outcome. Only the network (global fetch) is faked.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { GenerateChatOptions, ProviderToolset } from '../IProvider.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';

const originalFetch = globalThis.fetch;

interface FakeNetwork {
  bodies: string[];
  leasesDuringSend: number[];
  failure?: Error;
  onSend?: () => void;
}

const network: FakeNetwork = { bodies: [], leasesDuringSend: [] };

function resetNetwork(): void {
  network.bodies = [];
  network.leasesDuringSend = [];
  network.failure = undefined;
  network.onSend = undefined;
}

const COMPLETION = {
  id: 'chatcmpl-wp10',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-wp10',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
};

function sse(streaming: boolean): Response {
  if (!streaming) {
    return new Response(JSON.stringify(COMPLETION), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const chunk = (delta: unknown, finish: string | null) =>
    `data: ${JSON.stringify({
      id: 'chatcmpl-wp10',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-wp10',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const frames = [
    chunk({ role: 'assistant', content: 'o' }, null),
    chunk({ content: 'k' }, null),
    chunk({}, 'stop'),
    'data: [DONE]\n\n',
  ];
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function installFetch(streaming: boolean): void {
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      network.bodies.push(typeof init?.body === 'string' ? init.body : '');
      network.leasesDuringSend.push(activeRequestBodyCount());
      network.onSend?.();
      if (network.failure !== undefined) throw network.failure;
      return sse(streaming);
    },
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch;
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
  readonly streaming?: boolean;
  readonly settings?: Record<string, unknown>;
}

interface Harness {
  readonly provider: OpenAIVercelProvider;
  readonly settings: SettingsService;
  readonly config: ReturnType<typeof createRuntimeConfigStub>;
  readonly streaming: boolean;
}

function makeHarness(scenario: Scenario): Harness {
  const settings = new SettingsService();
  settings.set('activeProvider', 'openaivercel');
  for (const [key, value] of Object.entries(scenario.settings ?? {})) {
    settings.set(key, value);
  }
  const config = createRuntimeConfigStub(settings);
  const provider = new OpenAIVercelProvider('test-api-key');
  return {
    provider,
    settings,
    config,
    streaming: scenario.streaming === true,
  };
}

function replay(rows: IContent[]): AsyncIterable<IContent> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
      yield* rows;
    },
  };
}

function arrayOptions(
  harness: Harness,
  scenario: Scenario,
  signal?: AbortSignal,
): GenerateChatOptions {
  const base = createProviderCallOptions({
    providerName: 'openaivercel',
    config: harness.config,
    settings: harness.settings,
    contents: replay(scenario.rows),
    tools: scenario.tools,
    resolved: { streaming: harness.streaming },
  });
  if (signal === undefined) return base;
  return { ...base, invocation: { ...base.invocation, signal } };
}

function rowsOptions(
  harness: Harness,
  scenario: Scenario,
  probe: RowProbe,
  signal?: AbortSignal,
): GenerateChatOptions {
  return {
    ...arrayOptions(harness, scenario, signal),
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

async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const out: IContent[] = [];
  for await (const chunk of iterator) out.push(chunk);
  return out;
}

async function sendArray(scenario: Scenario): Promise<string[]> {
  resetNetwork();
  const harness = makeHarness(scenario);
  installFetch(harness.streaming);
  await drain(
    harness.provider.generateChatCompletion(arrayOptions(harness, scenario)),
  );
  return network.bodies;
}

async function sendRows(scenario: Scenario): Promise<string[]> {
  resetNetwork();
  const harness = makeHarness(scenario);
  installFetch(harness.streaming);
  const probe = probeRows(scenario.rows);
  const chunks = await drain(
    harness.provider.generateChatCompletion(
      rowsOptions(harness, scenario, probe),
    ),
  );
  expect(chunks.length).toBeGreaterThan(0);
  expect(probe.opened()).toBe(1);
  expect(probe.returned()).toBe(1);
  return network.bodies;
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
        thought: 'previous reasoning wp10',
        sourceField: 'reasoning_content',
      },
      { type: 'text', text: 'answer' },
    ],
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
      { type: 'text', text: 'what is this wp10 image?' },
    ],
  },
];

describe('Vercel transport-owned request rows body (WP10)', () => {
  beforeEach(resetNetwork);
  afterEach(() => {
    globalThis.fetch = originalFetch;
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
      'reasoning kept in context',
      {
        rows: thinkingTurns,
        settings: {
          'reasoning.enabled': true,
          'reasoning.includeInContext': true,
          'reasoning.stripFromContext': 'none',
        },
      },
    ],
    ['media', { rows: mediaTurns }],
    ['streaming request', { rows: toolTurns, streaming: true }],
    [
      'streaming request with reasoning capture',
      {
        rows: thinkingTurns,
        streaming: true,
        settings: { 'reasoning.enabled': true },
      },
    ],
  ];

  it.each(cases)(
    'sends the array route HTTP request for %s',
    async (_name, scenario) => {
      const arrayBodies = await sendArray(scenario);
      const rowBodies = await sendRows(scenario);
      expect(arrayBodies).toHaveLength(1);
      expect(rowBodies).toStrictEqual(arrayBodies);
    },
  );

  it('keeps tool pairing and media in the compared requests', async () => {
    const [tools] = await sendRows({ rows: toolTurns, tools: WEATHER_TOOL });
    expect(tools).toContain('tool_call_id');
    expect(tools).toContain('get_weather');
    const [media] = await sendRows({ rows: mediaTurns });
    expect(media).toContain('image_url');
  });

  it('rejects rows whose count changed after selection', async () => {
    const scenario: Scenario = {
      rows: [text('human', 'a'), text('human', 'b')],
    };
    const harness = makeHarness(scenario);
    installFetch(false);
    const probe = probeRows(scenario.rows);
    const options = rowsOptions(harness, scenario, probe);
    const wrong = { ...options, requestRows: { ...probe.selection, count: 3 } };
    const before = activeRequestBodyCount();
    await expect(
      drain(harness.provider.generateChatCompletion(wrong)),
    ).rejects.toThrow('Provider request rows count changed');
    expect(network.bodies).toHaveLength(0);
    expect(activeRequestBodyCount()).toBe(before);
  });
});

describe('Vercel request rows preparation lifecycle (WP10)', () => {
  const scenario: Scenario = { rows: toolTurns, tools: WEATHER_TOOL };

  beforeEach(resetNetwork);
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('holds exactly one request body lease during send and releases it afterwards', async () => {
    const harness = makeHarness(scenario);
    installFetch(false);
    const probe = probeRows(scenario.rows);
    const before = activeRequestBodyCount();
    await drain(
      harness.provider.generateChatCompletion(
        rowsOptions(harness, scenario, probe),
      ),
    );
    expect(network.leasesDuringSend).toStrictEqual([before + 1]);
    expect(activeRequestBodyCount()).toBe(before);
    expect(probe.opened()).toBe(1);
  });

  it('reads the rows again for a retried call and sends the same request', async () => {
    const harness = makeHarness(scenario);
    installFetch(false);
    const probe = probeRows(scenario.rows);
    const before = activeRequestBodyCount();
    network.failure = new Error('transient transport failure');
    await expect(
      drain(
        harness.provider.generateChatCompletion(
          rowsOptions(harness, scenario, probe),
        ),
      ),
    ).rejects.toThrow('transient transport failure');
    expect(activeRequestBodyCount()).toBe(before);
    network.failure = undefined;
    await drain(
      harness.provider.generateChatCompletion(
        rowsOptions(harness, scenario, probe),
      ),
    );
    expect(probe.opened()).toBe(2);
    expect(probe.returned()).toBe(2);
    expect(network.bodies).toHaveLength(2);
    expect(network.bodies[1]).toBe(network.bodies[0]);
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the send fails', async () => {
    const harness = makeHarness(scenario);
    installFetch(false);
    const before = activeRequestBodyCount();
    network.failure = new Error('transport exploded');
    await expect(
      drain(
        harness.provider.generateChatCompletion(
          rowsOptions(harness, scenario, probeRows(scenario.rows)),
        ),
      ),
    ).rejects.toThrow('transport exploded');
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the consumer returns mid-stream', async () => {
    const streaming: Scenario = { rows: toolTurns, streaming: true };
    const harness = makeHarness(streaming);
    installFetch(true);
    const before = activeRequestBodyCount();
    const iterator = harness.provider.generateChatCompletion(
      rowsOptions(harness, streaming, probeRows(streaming.rows)),
    );
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(activeRequestBodyCount()).toBe(before + 1);
    await iterator.return?.();
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases the body when the request is aborted during the call', async () => {
    const harness = makeHarness(scenario);
    installFetch(false);
    const controller = new AbortController();
    const before = activeRequestBodyCount();
    network.failure = new Error('aborted mid call');
    network.onSend = () => controller.abort(network.failure);
    await expect(
      drain(
        harness.provider.generateChatCompletion(
          rowsOptions(
            harness,
            scenario,
            probeRows(scenario.rows),
            controller.signal,
          ),
        ),
      ),
    ).rejects.toThrow('aborted mid call');
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('never opens the rows when cancelled before the first pull', async () => {
    const harness = makeHarness(scenario);
    installFetch(false);
    const controller = new AbortController();
    controller.abort(new Error('cancelled early'));
    const probe = probeRows(scenario.rows);
    const before = activeRequestBodyCount();
    await expect(
      drain(
        harness.provider.generateChatCompletion(
          rowsOptions(harness, scenario, probe, controller.signal),
        ),
      ),
    ).rejects.toThrow('cancelled early');
    expect(probe.pulled()).toBe(0);
    expect(network.bodies).toHaveLength(0);
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('closes the reader and sends nothing when cancelled after the first chunk', async () => {
    const harness = makeHarness(scenario);
    installFetch(false);
    const controller = new AbortController();
    const probe = probeRows(scenario.rows, () => {
      controller.abort(new Error('cancelled after first chunk'));
    });
    const before = activeRequestBodyCount();
    await expect(
      drain(
        harness.provider.generateChatCompletion(
          rowsOptions(harness, scenario, probe, controller.signal),
        ),
      ),
    ).rejects.toThrow('cancelled after first chunk');
    expect(probe.pulled()).toBe(1);
    expect(probe.returned()).toBe(1);
    expect(network.bodies).toHaveLength(0);
    expect(activeRequestBodyCount()).toBe(before);
  });

  it('releases an unsent preparation when the model cannot be created', async () => {
    const unauthenticated = makeHarness({ ...scenario });
    const failing = new OpenAIVercelProvider(undefined);
    installFetch(false);
    const probe = probeRows(scenario.rows);
    const before = activeRequestBodyCount();
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(
      drain(
        failing.generateChatCompletion(
          rowsOptions(unauthenticated, scenario, probe),
        ),
      ),
    ).rejects.toThrow('no-credential-configured');
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    expect(probe.returned()).toBe(1);
    expect(network.bodies).toHaveLength(0);
    expect(activeRequestBodyCount()).toBe(before);
  });
});
