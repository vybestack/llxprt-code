/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { describe, it, beforeEach, afterEach, expect, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { WebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import { createCodexResponsesWebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  completingScript,
  drain as drainHarness,
  userTextsOf,
} from './openAIResponsesWebSocketTransport.test-helpers.js';

const getCoreSystemPromptAsyncSpy = vi.fn().mockResolvedValue('system prompt');

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: getCoreSystemPromptAsyncSpy,
}));

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function buildNormalizedOptions(
  overrides: Partial<NormalizedGenerateChatOptions> = {},
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'test-runtime',
  });
  const config = createRuntimeConfigStub(settings, {});
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: {},
    fallbackRuntimeId: 'test-runtime',
  });

  const base = {
    contents: [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Hello' }],
      },
    ],
    settings,
    config,
    runtime,
    invocation,
    userMemory: undefined,
    tools: undefined,
    metadata: {},
    resolved: {
      model: 'gpt-5.6-sol',
      baseURL: CODEX_BASE_URL,
      authToken: 'test-token',
    },
  } as unknown as NormalizedGenerateChatOptions;

  return { ...base, ...overrides };
}

function buildDeps(
  overrides: Partial<ResponsesExecutorDeps> = {},
): ResponsesExecutorDeps {
  return {
    providerName: 'openai-responses',
    logger: { debug: vi.fn() } as unknown as ResponsesExecutorDeps['logger'],
    getProviderBaseURL: () => CODEX_BASE_URL,
    getCustomHeaders: () => ({ 'X-Provider': 'p' }),
    isCodexBaseURL: (url) => (url ?? '').includes('backend-api/codex'),
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => 'codex-token',
    shouldRetryOnError: () => false,
    getDefaultModel: () => 'gpt-5.6-sol',
    getGlobalConfig: () => undefined,
    ...overrides,
  };
}

function encodeSse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<readonly IContent[]> {
  const out: IContent[] = [];
  for await (const chunk of iterator) {
    out.push(chunk);
  }
  return out;
}

function makeRecordingTransport(behavior: 'success' | 'connect-failure'): {
  getWebSocketTransport: () => WebSocketTransport | undefined;
  instances: WebSocketTransport[];
  streamResponseCalls: number;
} {
  const instances: WebSocketTransport[] = [];
  let streamResponseCalls = 0;
  const getWebSocketTransport = (): WebSocketTransport | undefined => {
    const instance: WebSocketTransport = {
      async *streamResponse() {
        streamResponseCalls += 1;
        if (behavior === 'connect-failure') {
          throw new TypeError('connect ECONNREFUSED');
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'from websocket' }],
        };
      },
      close() {},
    };
    instances.push(instance);
    return instance;
  };
  return {
    getWebSocketTransport,
    instances,
    get streamResponseCalls() {
      return streamResponseCalls;
    },
  };
}

describe('executeOpenAIResponsesRequest WebSocket selection & fallback @issue:2041', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoreSystemPromptAsyncSpy.mockResolvedValue('system prompt');
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  it('A1: uses the WebSocket transport for Codex mode and yields its events', async () => {
    const transport = makeRecordingTransport('success');
    const fetchSpy = vi.fn();
    setGlobal('fetch', fetchSpy);

    const options = buildNormalizedOptions();
    const iterator = executeOpenAIResponsesRequest(
      options,
      buildDeps({ getWebSocketTransport: transport.getWebSocketTransport }),
    );
    const messages = await drain(iterator);

    expect(transport.instances).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(messages).toStrictEqual([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'from websocket' }],
      },
    ]);
  });

  it('A7: uses HTTP fetch (no WebSocket) when not in Codex mode', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: encodeSse([
        'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
        'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    setGlobal('fetch', fetchSpy);
    let transportChecks = 0;

    const options = buildNormalizedOptions({
      resolved: {
        model: 'gpt-5',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-token',
      },
    });
    const iterator = executeOpenAIResponsesRequest(
      options,
      buildDeps({
        isCodexBaseURL: () => false,
        getProviderBaseURL: () => 'https://api.openai.com/v1',
        getWebSocketTransport: () => {
          transportChecks += 1;
          return undefined;
        },
      }),
    );
    const messages = await drain(iterator);

    expect(messages).toStrictEqual([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Hi' }] },
      {
        speaker: 'ai',
        blocks: [],
        metadata: {
          id: 'r1',
          stopReason: 'end_turn',
          finishReason: 'completed',
        },
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(transportChecks).toBe(1);
  });

  it('A5: falls back to HTTP once when WebSocket connect fails before events, then sticks to HTTP', async () => {
    const fallbackBody = (): ReadableStream<Uint8Array> =>
      encodeSse([
        'data: {"type":"response.output_text.delta","delta":"fallback"}\n\n',
        'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
        'data: [DONE]\n\n',
      ]);
    const fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ok: true, body: fallbackBody() }),
      );
    setGlobal('fetch', fetchSpy);
    const transport = makeRecordingTransport('connect-failure');
    let stickyFallback = false;

    const deps = buildDeps({
      getWebSocketTransport: () => {
        if (stickyFallback) return undefined;
        return transport.getWebSocketTransport();
      },
      onWebSocketFallback: () => {
        stickyFallback = true;
      },
    });

    const first = await drain(
      executeOpenAIResponsesRequest(buildNormalizedOptions(), deps),
    );
    expect(first).toStrictEqual([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'fallback' }] },
      {
        speaker: 'ai',
        blocks: [],
        metadata: {
          id: 'r1',
          responsesStored: true,
          stopReason: 'end_turn',
          finishReason: 'completed',
        },
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await drain(
      executeOpenAIResponsesRequest(buildNormalizedOptions(), deps),
    );
    expect(second).toStrictEqual([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'fallback' }] },
      {
        speaker: 'ai',
        blocks: [],
        metadata: {
          id: 'r1',
          responsesStored: true,
          stopReason: 'end_turn',
          finishReason: 'completed',
        },
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(transport.streamResponseCalls).toBe(1);
  });
});

describe('executeOpenAIResponsesRequest WebSocket reconnect keeps the conversation stateful @issue:3134', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoreSystemPromptAsyncSpy.mockResolvedValue('system prompt');
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  /**
   * A dropped socket must not force a full-history replay. Because the parent
   * response was stored server-side (store=true), its id stays resolvable on a
   * brand-new connection, so the reconnected turn still sends only the delta.
   */
  it('sends previous_response_id and only the post-parent turn on a brand-new socket', async () => {
    // Real transport + fake-socket harness, so the reconnect path is exercised
    // end-to-end rather than simulated.
    const harness = new SocketHarness([
      completingScript('first'),
      completingScript('second'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    // Request 1: no stored parent. Opens socket 1.
    await drainHarness(
      executeOpenAIResponsesRequest(
        buildNormalizedOptions(),
        buildDeps({ getWebSocketTransport: () => transport }),
      ),
    );

    // Kill socket 1 so the next request is forced to reconnect.
    harness.sockets[0].serverClose();

    // Request 2: history carries a stored parent, so the turn is trimmed.
    const options2 = buildNormalizedOptions({
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first question' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'first answer' }],
          metadata: {
            id: 'resp_parent',
            responsesStored: true,
            providerBaseURL: CODEX_BASE_URL,
          },
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'second question' }],
        },
      ],
    });
    await drainHarness(
      executeOpenAIResponsesRequest(
        options2,
        buildDeps({ getWebSocketTransport: () => transport }),
      ),
    );

    expect(harness.sockets).toHaveLength(2);

    const sentRaw = harness.sockets[1].sent[0];
    expect(sentRaw).toBeDefined();
    const sent = JSON.parse(sentRaw) as Record<string, unknown>;
    expect(sent['type']).toBe('response.create');
    expect(sent['previous_response_id']).toBe('resp_parent');

    const userTexts = userTextsOf(sent['input']);
    expect(userTexts).toContain('second question');
    expect(userTexts).not.toContain('first question');

    transport.close();
  });
});
