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

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { StreamLivenessEvent } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

const getCoreSystemPromptAsyncSpy = vi.hoisted(() =>
  vi.fn().mockResolvedValue('system prompt'),
);

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: getCoreSystemPromptAsyncSpy,
}));

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
      model: 'gpt-5',
      baseURL: 'https://api.openai.com/v1',
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
    getProviderBaseURL: () => 'https://api.openai.com/v1',
    getCustomHeaders: () => undefined,
    isCodexBaseURL: () => false,
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => '',
    generateSyntheticCallId: () => 'call_synthetic_test',
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('invokes onStreamLiveness for a response.created lifecycle event', async () => {
    const sseBody = encodeSse([
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: [DONE]\n\n',
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, body: sseBody }),
    );

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
      'data: [DONE]\n\n',
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, body: sseBody }),
    );

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
    ]);
  });
});
