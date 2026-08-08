/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral regression: when the normalized resolved model is empty,
 * the request body model must fall back to the provider's default
 * model (deps.getDefaultModel) — never the provider base URL.
 *
 * Exercises the real executor function with a real NormalizedGenerateChatOptions
 * and a real ResponsesExecutorDeps. Only the fetch boundary is intercepted.
 *
 * @issue #2483, #3136
 */

import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { describe, it, beforeEach, afterEach, expect, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

const SYSTEM_INSTRUCTION = 'test system instruction';

let capturedRequest: Record<string, unknown> | undefined;

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
    systemInstruction: SYSTEM_INSTRUCTION,
    resolved: {
      model: '',
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
    shouldRetryOnError: () => false,
    getDefaultModel: () => 'o3-mini',
    getGlobalConfig: () => undefined,
    ...overrides,
  };
}

/** The executor sends the body as a Blob, so extract+parse it accordingly. */
async function readRequestBodyText(body: BodyInit): Promise<string> {
  if (body instanceof Blob) return body.text();
  if (typeof body === 'string') return body;
  return new Response(body).text();
}

async function captureRequestModel(): Promise<
  Record<string, unknown> | undefined
> {
  const fetchCall = (
    globalThis as unknown as { fetch: { mock: { calls: unknown[][] } } }
  ).fetch.mock.calls[0];
  const init = fetchCall[1] as { body?: BodyInit } | undefined;
  if (init?.body == null) return undefined;
  const bodyText = await readRequestBodyText(init.body);
  return bodyText ? JSON.parse(bodyText) : undefined;
}

describe('executeOpenAIResponsesRequest empty-resolved-model fallback @issue:2483', () => {
  beforeEach(() => {
    capturedRequest = undefined;
    setGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                'data: ' +
                  JSON.stringify({
                    type: 'response.completed',
                    response: {
                      output: [
                        {
                          content: [{ type: 'output_text', text: 'response' }],
                        },
                      ],
                    },
                  }) +
                  '\n\n',
              ),
            );
            controller.close();
          },
        }),
      }),
    );
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  it('uses deps.getDefaultModel() as the request model when resolved model is empty', async () => {
    const deps = buildDeps({
      getDefaultModel: () => 'o3-mini',
      resolveAuthTokenForPrompt: async () => 'test-token',
    });
    const options = buildNormalizedOptions({
      resolved: {
        model: '',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-token',
      } as NormalizedGenerateChatOptions['resolved'],
    });

    const iterator = executeOpenAIResponsesRequest(options, deps);
    await iterator.next();

    // The fetch mock captures the serialized request body
    capturedRequest = await captureRequestModel();
    expect(capturedRequest?.model).toBe('o3-mini');
  });

  it('does NOT pass the provider base URL as the model when resolved model is empty', async () => {
    const baseURL = 'https://api.openai.com/v1';
    const deps = buildDeps({
      getDefaultModel: () => 'o3-mini',
      getProviderBaseURL: () => baseURL,
      resolveAuthTokenForPrompt: async () => 'test-token',
    });
    const options = buildNormalizedOptions({
      resolved: {
        model: '',
        baseURL,
        authToken: 'test-token',
      } as NormalizedGenerateChatOptions['resolved'],
    });

    const iterator = executeOpenAIResponsesRequest(options, deps);
    await iterator.next();

    capturedRequest = await captureRequestModel();
    expect(capturedRequest?.model).toBe('o3-mini');
    expect(capturedRequest?.model).not.toBe(baseURL);
  });

  it('passes the resolved model when it is non-empty', async () => {
    const deps = buildDeps({
      getDefaultModel: () => 'o3-mini',
      resolveAuthTokenForPrompt: async () => 'test-token',
    });
    const options = buildNormalizedOptions({
      resolved: {
        model: 'gpt-5.6-sol',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-token',
      } as NormalizedGenerateChatOptions['resolved'],
    });

    const iterator = executeOpenAIResponsesRequest(options, deps);
    await iterator.next();

    capturedRequest = await captureRequestModel();
    expect(capturedRequest?.model).toBe('gpt-5.6-sol');
  });
});
