/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: the OpenAI Responses executor threads the provider-neutral
 * onStreamLiveness listener from NormalizedGenerateChatOptions down through
 * fetchStreamWithRetries into parseResponsesStream, so a raw lifecycle SSE
 * event (response.created) reaches the listener (issue #2607).
 *
 * Only the fetch boundary is intercepted (legitimate I/O edge); the real
 * executor and real SSE parser run.
 */

import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { describe, it, beforeEach, afterEach, expect, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { StreamLivenessEvent } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { WebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

const getCoreSystemPromptAsyncSpy = vi.fn().mockResolvedValue('system prompt');

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: getCoreSystemPromptAsyncSpy,
}));function buildNormalizedOptions(
  overrides: Partial<NormalizedGenerateChatOptions> & {
    ephemerals?: Record<string, unknown>;
  } = {},
): NormalizedGenerateChatOptions {
  const { ephemerals = {}, ...optionOverrides } = overrides;
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
    ephemeralsSnapshot: ephemerals,
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
      model: 'gpt-5',
      baseURL: 'https://api.openai.com/v1',
      authToken: 'test-token',
    },
  } as unknown as NormalizedGenerateChatOptions;

  return { ...base, ...optionOverrides };
}

function buildDeps(
  overrides: Partial<ResponsesExecutorDeps> = {},
): ResponsesExecutorDeps {
  return {
    providerName: 'openai-responses',
    logger: { debug: vi.fn() } as unknown as ResponsesExecutorDeps['logger'],
    getProviderBaseURL: () => 'https://api.openai.com/v1',
    getCustomHeaders: () => undefined,
    isCodexBaseURL: () => false,
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => '',
    shouldRetryOnError: () => false,
    getDefaultModel: () => 'gpt-5',
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

describe('executeOpenAIResponsesRequest onStreamLiveness threading @issue:2607', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoreSystemPromptAsyncSpy.mockResolvedValue('system prompt');
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  it('invokes onStreamLiveness for a response.created lifecycle event', async () => {
    const sseBody = encodeSse([
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
      'data: [DONE]\n\n',
    ]);
    setGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: sseBody }));

    const livenessEvents: StreamLivenessEvent[] = [];
    const options = buildNormalizedOptions({
      onStreamLiveness: (event) => livenessEvents.push(event),
    });

    const iterator = executeOpenAIResponsesRequest(options, buildDeps());
    for await (const _chunk of iterator) {
      void _chunk;
    }

    expect(livenessEvents).toContainEqual({
      sourceEvent: 'response.created',
      sseObserved: true,
    });
  });

  it('does not invoke onStreamLiveness when not provided (no crash)', async () => {
    const sseBody = encodeSse([
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
      'data: [DONE]\n\n',
    ]);
    setGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: sseBody }));

    const options = buildNormalizedOptions();
    const iterator = executeOpenAIResponsesRequest(options, buildDeps());
    const messages: IContent[] = [];
    for await (const chunk of iterator) {
      messages.push(chunk);
    }
    expect(messages).toStrictEqual([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hi' }],
      },
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
  });
});

describe('executeOpenAIResponsesRequest dump parity @issue:2253', () => {
  let tempDumpDir: string;
  const originalConfigHome = process.env['LLXPRT_CONFIG_HOME'];
  const originalCacheHome = process.env['LLXPRT_CACHE_HOME'];

  beforeEach(() => {
    vi.clearAllMocks();
    getCoreSystemPromptAsyncSpy.mockResolvedValue('system prompt');
    tempDumpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'responses-dump-test-'),
    );
    delete process.env['LLXPRT_CACHE_HOME'];
    process.env['LLXPRT_CONFIG_HOME'] = tempDumpDir;
  });

  afterEach(async () => {
    if (originalConfigHome !== undefined) {
      process.env['LLXPRT_CONFIG_HOME'] = originalConfigHome;
    } else {
      delete process.env['LLXPRT_CONFIG_HOME'];
    }
    if (originalCacheHome !== undefined) {
      process.env['LLXPRT_CACHE_HOME'] = originalCacheHome;
    }
    restoreGlobals();
    vi.restoreAllMocks();
    if (tempDumpDir) {
      await fsp.rm(tempDumpDir, { recursive: true, force: true });
    }
  });

  async function readDumpedRequest(): Promise<{
    model?: string;
    input?: unknown[];
    instructions?: string;
  }> {
    const dumpDir = path.join(tempDumpDir, 'dumps');
    const entries = await fsp.readdir(dumpDir);
    const requestFiles = entries.filter((f) => f.endsWith('-request.json'));
    expect(requestFiles).toHaveLength(1);
    const raw = await fsp.readFile(
      path.join(dumpDir, requestFiles[0]),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as {
      request: {
        body: { model?: string; input?: unknown[]; instructions?: string };
      };
    };
    return parsed.request.body;
  }

  it('A3: emits finalized request dump at common pre-transport seam (HTTP)', async () => {
    const sseBody = encodeSse([
      'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
      'data: [DONE]\n\n',
    ]);
    setGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: sseBody }));

    const options = buildNormalizedOptions({
      ephemerals: { dumpcontext: 'on' },
      resolved: {
        model: 'gpt-5.6-sol',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-token',
      },
    });

    const iterator = executeOpenAIResponsesRequest(options, buildDeps());
    for await (const _chunk of iterator) {
      void _chunk;
    }

    const dumpedBody = await readDumpedRequest();
    expect(dumpedBody.model).toBe('gpt-5.6-sol');
    expect(Array.isArray(dumpedBody.input)).toBe(true);
    expect(dumpedBody.instructions).toBe('test system prompt');
  });

  it('A3: emits finalized request dump when Codex WebSocket path is selected', async () => {
    const fetchMock = vi.fn();
    setGlobal('fetch', fetchMock);

    const options = buildNormalizedOptions({
      ephemerals: { dumpcontext: 'on' },
      resolved: {
        model: 'gpt-5.6-sol',
        baseURL: 'https://chatgpt.com/backend-api/codex',
        authToken: 'codex-token',
      },
    });

    const wsTransport: WebSocketTransport = {
      streamResponse: vi.fn().mockReturnValue(
        (async function* () {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'OK' }],
          };
        })(),
      ),
      close: vi.fn(),
    };

    const iterator = executeOpenAIResponsesRequest(
      options,
      buildDeps({
        isCodexBaseURL: () => true,
        getWebSocketTransport: () => wsTransport,
      }),
    );
    const consumed: IContent[] = [];
    for await (const chunk of iterator) {
      consumed.push(chunk);
    }

    expect(consumed).toHaveLength(1);
    expect(consumed[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'OK' }],
    });
    expect(wsTransport.streamResponse).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    const dumpedBody = await readDumpedRequest();
    expect(dumpedBody.model).toBe('gpt-5.6-sol');
    expect(Array.isArray(dumpedBody.input)).toBe(true);
  });
});
