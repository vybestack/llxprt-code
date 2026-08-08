/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral retry-classification tests for the OpenAI Responses path
 * (issue #3140).
 *
 * Drives the REAL executor with a stubbed global `fetch` and the REAL
 * production `shouldRetryOnError` classification (via a test-only subclass
 * that exposes the protected method). Asserts on observable outcomes only:
 * number of fetch calls, the error message surfaced, and the inter-attempt
 * wait duration.
 *
 * AC1: a quota-exhaustion 429 issues exactly one fetch and surfaces the
 *      quota message immediately.
 * AC2: a throttling 429 is retried; when Retry-After is present the
 *      inter-attempt wait tracks the header rather than the configured retrywait.
 * AC6: 500, network-transient, and 400 behave as before.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from '../openAIResponsesExecutor.js';
import { OpenAIResponsesProviderBase } from '../OpenAIResponsesProviderBase.js';
import { shouldRetryError } from '../../retryDelayPolicy.js';
import type { NormalizedGenerateChatOptions } from '../../BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

const TERMINAL_EVENT =
  'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}\n\n';

const OK_BODY =
  'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
  TERMINAL_EVENT;

/**
 * Test-only subclass that exposes the protected `shouldRetryOnError` so the
 * executor deps use the REAL production classification logic, not a stub.
 */
class TestableResponsesProvider extends OpenAIResponsesProviderBase {
  retryDecision(error: Error | unknown): boolean {
    return this.shouldRetryOnError(error);
  }

  protected override async *generateChatCompletionWithOptions(): AsyncIterableIterator<IContent> {
    yield* [];
  }
}

interface FetchMock {
  readonly calls: { count: number };
  readonly timestamps: number[];
  restore(): void;
}

function installFetch(
  handler: (callIndex: number) => Response | Promise<Response>,
): FetchMock {
  const original = globalThis.fetch;
  const calls = { count: 0 };
  const timestamps: number[] = [];
  const impl: typeof fetch = () => {
    const index = calls.count;
    calls.count += 1;
    timestamps.push(Date.now());
    return Promise.resolve(handler(index));
  };
  globalThis.fetch = impl;
  return {
    calls,
    timestamps,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function errorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function okResponse(): Response {
  return new Response(OK_BODY, { status: 200 });
}

function buildNormalizedOptions(
  overrides: {
    ephemerals?: Record<string, unknown>;
  } & Partial<NormalizedGenerateChatOptions> = {},
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
    resolved: {
      model: 'gpt-5',
      baseURL: 'https://api.openai.com/v1',
      authToken: 'test-token',
    },
  } as unknown as NormalizedGenerateChatOptions;
  return { ...base, ...optionOverrides };
}

function buildDeps(provider: TestableResponsesProvider): ResponsesExecutorDeps {
  return {
    providerName: 'openai-responses',
    logger: {
      debug: () => undefined,
    } as unknown as ResponsesExecutorDeps['logger'],
    getProviderBaseURL: () => 'https://api.openai.com/v1',
    getCustomHeaders: () => undefined,
    isCodexBaseURL: () => false,
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => 'test-token',
    generateSyntheticCallId: () => 'call_synthetic_test',
    shouldRetryOnError: (error) => provider.retryDecision(error),
    getDefaultModel: () => 'gpt-5',
    getGlobalConfig: () => undefined,
  };
}

async function drain(iterator: AsyncIterableIterator<IContent>): Promise<{
  messages: IContent[];
  error: unknown | undefined;
}> {
  const messages: IContent[] = [];
  let error: unknown | undefined;
  try {
    for await (const chunk of iterator) messages.push(chunk);
  } catch (caught) {
    error = caught;
  }
  return { messages, error };
}

describe('OpenAI Responses retry classification @issue:3140', () => {
  let fetchMock: FetchMock | undefined;
  let provider: TestableResponsesProvider;

  beforeEach(() => {
    fetchMock = undefined;
    provider = new TestableResponsesProvider(
      'test-key',
      'https://api.openai.com/v1',
      {
        getEphemeralSettings: () => ({}),
      },
    );
  });

  afterEach(() => {
    fetchMock?.restore();
  });

  it('AC1: quota-exhaustion 429 issues exactly ONE fetch and surfaces the quota message', async () => {
    fetchMock = installFetch(() =>
      errorResponse(429, {
        error: {
          code: 'insufficient_quota',
          message: 'You exhausted your quota',
        },
      }),
    );
    const options = buildNormalizedOptions({
      ephemerals: { retries: 6, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeInstanceOf(Error);
    expect(fetchMock.calls.count).toBe(1);
    // AC5: the surfaced message must read as quota exhaustion, not throttling.
    const message = (error as Error).message.toLowerCase();
    expect(message).not.toContain('rate limit exceeded');
    expect(message).toContain('quota');
    expect(message).toContain('will not');
  });

  it('AC1: a quota 429 carrying insufficient_quota only under type is terminal', async () => {
    fetchMock = installFetch(() =>
      errorResponse(429, {
        error: {
          type: 'insufficient_quota',
          message: 'You exhausted your quota',
        },
      }),
    );
    const options = buildNormalizedOptions({
      ephemerals: { retries: 6, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeInstanceOf(Error);
    expect(fetchMock.calls.count).toBe(1);
  });

  it('AC1: billing_hard_limit_reached 429 issues exactly ONE fetch', async () => {
    fetchMock = installFetch(() =>
      errorResponse(429, {
        error: {
          code: 'billing_hard_limit_reached',
          message: 'Billing hard limit reached',
        },
      }),
    );
    const options = buildNormalizedOptions({
      ephemerals: { retries: 6, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeInstanceOf(Error);
    expect(fetchMock.calls.count).toBe(1);
  });

  it('AC2: throttling 429 is retried and then succeeds', async () => {
    fetchMock = installFetch((call) => {
      if (call === 0)
        return errorResponse(429, {
          error: { code: 'rate_limit_exceeded', message: 'Too many requests' },
        });
      return okResponse();
    });
    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const { messages, error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeUndefined();
    expect(fetchMock.calls.count).toBe(2);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('AC2: Retry-After header is honored — wait tracks the header, not retrywait', async () => {
    const retrywait = 4000;
    fetchMock = installFetch((call) => {
      if (call === 0)
        return errorResponse(
          429,
          { error: { code: 'rate_limit_exceeded', message: 'slow down' } },
          { 'Retry-After': '1' },
        );
      return okResponse();
    });
    const options = buildNormalizedOptions({
      ephemerals: { retries: 2, retrywait },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeUndefined();
    expect(fetchMock.calls.count).toBe(2);
    // The inter-attempt gap must track Retry-After (1s): long enough to prove
    // the header was actually waited on, short enough to prove the jittered
    // retrywait fallback (2800-5200ms) was not used.
    const gap = fetchMock.timestamps[1] - fetchMock.timestamps[0];
    expect(gap).toBeGreaterThanOrEqual(900);
    expect(gap).toBeLessThan(2500);
  }, 15000);

  it('boundary: a bare 429 with no body code is still retried', async () => {
    fetchMock = installFetch((call) => {
      if (call === 0)
        return errorResponse(429, {
          error: { message: 'Too many requests' },
        });
      return okResponse();
    });
    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeUndefined();
    expect(fetchMock.calls.count).toBe(2);
  });

  it('AC6: a 500 server error is still retried', async () => {
    fetchMock = installFetch((call) => {
      if (call === 0)
        return errorResponse(500, { error: { message: 'Internal error' } });
      return okResponse();
    });
    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeUndefined();
    expect(fetchMock.calls.count).toBe(2);
  });

  it('AC6: a network-transient TypeError is still retried', async () => {
    const original = globalThis.fetch;
    const calls = { count: 0 };
    globalThis.fetch = (() => {
      calls.count += 1;
      if (calls.count === 1)
        return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(okResponse());
    }) as typeof fetch;
    fetchMock = {
      calls,
      timestamps: [],
      restore: () => {
        globalThis.fetch = original;
      },
    };

    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeUndefined();
    expect(fetchMock.calls.count).toBe(2);
  });

  /**
   * Regression guard: the body-level error `type` must never be written to a
   * bare `type` key on the thrown error. `isOverloadError` in core reads that
   * key and treats `api_error` as retryable, which would silently reverse the
   * "403 is never retried" invariant from issue #2917.
   */
  it('a 403 carrying type=api_error is still NOT retried', async () => {
    fetchMock = installFetch(() =>
      errorResponse(403, {
        error: { type: 'api_error', message: 'Forbidden' },
      }),
    );
    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeInstanceOf(Error);
    expect(fetchMock.calls.count).toBe(1);
    expect(shouldRetryError(error)).toBe(false);
  });

  it('a 404 carrying type=rate_limit_error is still NOT retried', async () => {
    fetchMock = installFetch(() =>
      errorResponse(404, {
        error: { type: 'rate_limit_error', message: 'Not found' },
      }),
    );
    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeInstanceOf(Error);
    expect(fetchMock.calls.count).toBe(1);
    expect(shouldRetryError(error)).toBe(false);
  });

  it('AC6: a 400 bad request is NOT retried', async () => {
    fetchMock = installFetch(() =>
      errorResponse(400, { error: { message: 'Bad request' } }),
    );
    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const { error } = await drain(
      executeOpenAIResponsesRequest(options, buildDeps(provider)),
    );

    expect(error).toBeInstanceOf(Error);
    expect(fetchMock.calls.count).toBe(1);
  });
});
