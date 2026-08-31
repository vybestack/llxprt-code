/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  restoreGlobals,
  setGlobal,
  assertInstanceOf,
} from '@vybestack/llxprt-code-test-utils';
import { describe, it, beforeEach, afterEach, expect, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  executeOpenAIResponsesRequest,
  type PreparedResponsesRequestContext,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { WebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import {
  CODEX_WEBSOCKET_BETA_HEADER,
  createCodexResponsesWebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import {
  SocketHarness,
  completingScript,
  connectionLimitScript,
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
    systemInstruction: 'test system prompt',
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
    getMediaTransportCapabilities: (isCodex) =>
      declaredMediaTransportCapabilities(
        isCodex ? 'codex' : 'openai-responses',
      ),
    // Codex statefulness is WS-bound; these harnesses exercise the WS path.
    isWebSocketTransportActive: () => true,
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

function requestWithReleaseFailure(error: Error): ResolvedMediaRequest {
  return {
    withContents: (consume) => consume([]),
    registerCleanup: () => undefined,
    accounting: () => ({
      selectedReferenceCount: 0,
      uniqueContentCount: 0,
      selectedNormalizedBytes: 0,
      materializedNormalizedBytes: 0,
      storeReadCount: 0,
      reservedContentCount: 0,
      released: false,
    }),
    release: () => Promise.reject(error),
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

  it('preserves a transport-start failure before a media release failure', async () => {
    const primary = new Error('responses transport start failed');
    const cleanup = new Error('responses media release failed');
    const prepared: PreparedResponsesRequestContext = {
      rawBaseURL: CODEX_BASE_URL,
      isCodex: true,
      includeThinkingInResponse: false,
      responsesStored: false,
      projectionContext: {
        statefulParentUsed: false,
        incrementalRequest: undefined,
      },
      request: {
        model: 'gpt-5.6-sol',
        input: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
      mediaRequest: requestWithReleaseFailure(cleanup),
    };
    const iterator = executeOpenAIResponsesRequest(
      buildNormalizedOptions(),
      buildDeps({
        resolveAuthTokenForPrompt: () => Promise.reject(primary),
      }),
      prepared,
    );

    const error = await iterator.next().catch((reason: unknown) => reason);
    assertInstanceOf(error, AggregateError, 'expected an AggregateError');

    expect(error.errors).toStrictEqual([primary, cleanup]);
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

  it('awaits rejected HTTP request-body disposal and preserves both failures', async () => {
    const transportError = new Error('responses HTTP transport failed');
    const disposalError = new Error('responses HTTP body disposal failed');
    const originalCancel = ReadableStreamDefaultReader.prototype.cancel;
    ReadableStreamDefaultReader.prototype.cancel = function (): Promise<void> {
      return Promise.reject(disposalError);
    };
    try {
      setGlobal('fetch', () => Promise.reject(transportError));
      const options = buildNormalizedOptions({
        resolved: {
          model: 'gpt-5',
          baseURL: 'https://api.openai.com/v1',
          authToken: 'test-token',
        },
      });

      const error = await drain(
        executeOpenAIResponsesRequest(
          options,
          buildDeps({
            isCodexBaseURL: () => false,
            getProviderBaseURL: () => 'https://api.openai.com/v1',
          }),
        ),
      ).catch((reason: unknown) => reason);

      assertInstanceOf(
        error,
        AggregateError,
        'expected HTTP transport and disposal AggregateError',
      );
      expect(error.errors).toStrictEqual([transportError, disposalError]);
    } finally {
      ReadableStreamDefaultReader.prototype.cancel = originalCancel;
    }
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
    // Codex must NEVER send store=true: the backend rejects it outright
    // (400 "Store must be set to false"). The parent is resolved from the
    // live socket instead, which is why store stays false here.
    expect(sent['store']).toBe(false);

    // The first request opens the chain and likewise never sets store.
    const firstSent = JSON.parse(harness.sockets[0].sent[0]) as Record<
      string,
      unknown
    >;
    expect(firstSent['store']).toBe(false);
    expect(firstSent['previous_response_id']).toBeUndefined();

    const userTexts = userTextsOf(sent['input']);
    // Exact equality, not toContain: an empty array would satisfy both a
    // toContain-absent and a not.toContain assertion, hiding a total failure.
    expect(userTexts).toStrictEqual(['second question']);

    transport.close();
  });
});

describe('executeOpenAIResponsesRequest WebSocket lifecycle-limit retry @issue:2771', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoreSystemPromptAsyncSpy.mockResolvedValue('system prompt');
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  /**
   * The lifecycle-limit verdict is scoped to the connection, so recovering on
   * a fresh socket inside one request must NOT demote the provider to HTTP:
   * the retry is transport health, not a transport failure.
   */
  it('recovers on a fresh connection without sticky HTTP fallback and keeps WebSocket for later requests', async () => {
    const harness = new SocketHarness([
      connectionLimitScript(),
      completingScript('recovered'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const fetchSpy = vi.fn();
    setGlobal('fetch', fetchSpy);
    const onWebSocketFallback = vi.fn();
    const onWebSocketSuccess = vi.fn();

    const deps = buildDeps({
      getWebSocketTransport: () => transport,
      onWebSocketFallback,
      onWebSocketSuccess,
    });

    // Request 1: socket 1 reports the lifecycle limit, socket 2 completes.
    const first = await drainHarness(
      executeOpenAIResponsesRequest(buildNormalizedOptions(), deps),
    );

    expect(first[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'recovered' }],
    });
    expect(harness.sockets).toHaveLength(2);
    expect(harness.sockets[0].closedByClient).toBe(true);
    // A healthy reconnect is not a fallback and must not stick to HTTP.
    expect(onWebSocketFallback).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The recovered stream still reports transport success (#3034 counter).
    expect(onWebSocketSuccess).toHaveBeenCalled();

    // Request 2: the WebSocket remains the transport, reusing socket 2.
    const second = await drainHarness(
      executeOpenAIResponsesRequest(buildNormalizedOptions(), deps),
    );

    expect(second[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'recovered' }],
    });
    expect(harness.sockets).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();

    transport.close();
  });
});

describe('executeOpenAIResponsesRequest WebSocket handshake identity @issue:2772', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoreSystemPromptAsyncSpy.mockResolvedValue('system prompt');
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  it('sends the current Codex handshake headers with the runtime identity', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await drainHarness(
      executeOpenAIResponsesRequest(
        buildNormalizedOptions(),
        buildDeps({ getWebSocketTransport: () => transport }),
      ),
    );

    expect(harness.headers[0]).toStrictEqual({
      Authorization: 'Bearer codex-token',
      'X-Provider': 'p',
      'ChatGPT-Account-ID': 'codex-account',
      originator: 'codex_cli_rs',
      'session-id': 'test-runtime',
      'thread-id': 'test-runtime',
      'x-client-request-id': 'test-runtime',
      'OpenAI-Beta': CODEX_WEBSOCKET_BETA_HEADER,
    });
  });

  it('omits every identity header when no runtime identity resolves', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const defaults = buildNormalizedOptions();
    const optionsWithoutIdentity = buildNormalizedOptions({
      invocation: { ...defaults.invocation, runtimeId: '' },
      runtime: undefined,
    });

    await drainHarness(
      executeOpenAIResponsesRequest(
        optionsWithoutIdentity,
        buildDeps({ getWebSocketTransport: () => transport }),
      ),
    );

    const headers = harness.headers[0];
    expect(headers['session-id']).toBeUndefined();
    expect(headers['thread-id']).toBeUndefined();
    expect(headers['x-client-request-id']).toBeUndefined();
  });
});
