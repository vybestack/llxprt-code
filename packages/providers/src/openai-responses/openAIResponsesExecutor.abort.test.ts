/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue:2607 Finding 3
 *
 * Behavioral tests for abort-signal propagation and retry-backoff abort in the
 * OpenAI Responses executor.
 *
 * The executor uses the established `getRequestSignal(options)` utility, which
 * prefers the normalized `invocation.signal` while preserving the legacy
 * `metadata.abortSignal` fallback. The resulting signal drives fetch, the
 * parser/retry path, and retry backoff (via `delay(backoff, signal)`), so an
 * abort during backoff rejects promptly with an AbortError and does not issue
 * another fetch/retry.
 *
 * Uses fake timers/signals deterministically — no wall-clock sleeps.
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
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

const getCoreSystemPromptAsyncSpy = vi.hoisted(() =>
  vi.fn().mockResolvedValue('system prompt'),
);

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: getCoreSystemPromptAsyncSpy,
}));

function buildNormalizedOptions(
  overrides: Partial<NormalizedGenerateChatOptions> & {
    invocationSignal?: AbortSignal;
    metadataAbortSignal?: AbortSignal;
  } = {},
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
    ephemeralsSnapshot: overrides.ephemerals ?? {},
    fallbackRuntimeId: 'test-runtime',
    ...(overrides.invocationSignal !== undefined
      ? { signal: overrides.invocationSignal }
      : {}),
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
    metadata:
      overrides.metadataAbortSignal !== undefined
        ? { abortSignal: overrides.metadataAbortSignal }
        : {},
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
    shouldRetryOnError: () => true,
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

async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<readonly IContent[]> {
  const messages: IContent[] = [];
  for await (const chunk of iterator) {
    messages.push(chunk);
  }
  return messages;
}

/** Checks that a thrown Error has the expected name. */
function isNamedError(value: unknown, expectedName: string): boolean {
  return value instanceof Error && value.name === expectedName;
}

describe('executeOpenAIResponsesRequest abort-signal propagation @issue:2607', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoreSystemPromptAsyncSpy.mockResolvedValue('system prompt');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes the invocation-only signal to fetch (preferred over absent metadata signal)', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: encodeSse([
        'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const options = buildNormalizedOptions({
      invocationSignal: controller.signal,
    });
    await drain(executeOpenAIResponsesRequest(options, buildDeps()));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchCallInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(fetchCallInit.signal).toBe(controller.signal);
  });

  it('still passes the legacy metadata.abortSignal to fetch when invocation.signal is absent', async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: encodeSse([
        'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const options = buildNormalizedOptions({
      metadataAbortSignal: controller.signal,
    });
    await drain(executeOpenAIResponsesRequest(options, buildDeps()));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchCallInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(fetchCallInit.signal).toBe(controller.signal);
  });

  it('prefers invocation.signal over metadata.abortSignal when both are present', async () => {
    const invocationController = new AbortController();
    const metadataController = new AbortController();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      body: encodeSse([
        'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const options = buildNormalizedOptions({
      invocationSignal: invocationController.signal,
      metadataAbortSignal: metadataController.signal,
    });
    await drain(executeOpenAIResponsesRequest(options, buildDeps()));

    const fetchCallInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(fetchCallInit.signal).toBe(invocationController.signal);
  });

  it('aborts during retry backoff promptly with AbortError and issues no further fetch/retry', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchSpy = vi
      .fn()
      // First attempt: transient network error (retryable).
      .mockRejectedValueOnce(new TypeError('network error'))
      // Any subsequent attempt must NEVER be reached — abort during backoff.
      .mockResolvedValue({
        ok: true,
        body: encodeSse([
          'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
          'data: [DONE]\n\n',
        ]),
      });
    vi.stubGlobal('fetch', fetchSpy);

    const options = buildNormalizedOptions({
      invocationSignal: controller.signal,
      ephemerals: { retrywait: 10_000, retries: 5 },
    });
    const iterator = executeOpenAIResponsesRequest(options, buildDeps());

    // Drain into a promise we can assert rejects. Attach a no-op catch now so
    // the delayed rejection (after abort) never becomes an unhandled rejection.
    const drainPromise = drain(iterator);
    const caughtPromise = drainPromise.then(
      () => undefined,
      (error: unknown) => error,
    );

    // Wait for the first fetch to be called (transient failure), then the
    // retry backoff delay begins.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1), {
      interval: 1,
      timeout: 200,
    });

    // Abort DURING the backoff delay (before it elapses).
    controller.abort();

    // Advance fake timers to let the aborted delay reject promptly.
    await vi.advanceTimersByTimeAsync(1);

    const result = await caughtPromise;
    expect(isNamedError(result, 'AbortError')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('classifies an AbortError as an AbortError (no retry) even on a retryable transient failure', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    // First attempt: aborted fetch rejects with an AbortError (not retried).
    const abortError = new DOMException('aborted', 'AbortError');
    const fetchSpy = vi.fn().mockRejectedValueOnce(abortError);
    vi.stubGlobal('fetch', fetchSpy);

    const options = buildNormalizedOptions({
      invocationSignal: controller.signal,
      ephemerals: { retrywait: 1_000, retries: 5 },
    });
    const iterator = executeOpenAIResponsesRequest(options, buildDeps());
    controller.abort();

    await expect(drain(iterator)).rejects.toBe(abortError);
    // AbortError must NOT trigger a retry — only one fetch call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
