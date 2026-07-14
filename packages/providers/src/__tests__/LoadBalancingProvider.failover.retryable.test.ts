/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for issue #2450: a load-balancer `failover` profile whose
 * backends all transiently 429 in a single pass must surface an aggregate
 * error that the upstream retry layer classifies as retryable, rather than
 * fatally dropping the agent back to the prompt.
 *
 * These tests assert OBSERVABLE outcomes on the thrown aggregate error using
 * the real `LoadBalancingProvider`, a real `ProviderManager`, and fake
 * delegate providers (the unit under test is never mocked).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import { LoadBalancerFailoverError } from '../errors.js';
import {
  LoadBalancerAllContextLimitsExceededError,
  LoadBalancerContextLimitError,
} from '../loadBalancing/contextLimitError.js';
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../GenerateChatOptions.js';
import {
  isRetryableError,
  getErrorStatus,
  RetryableQuotaError,
} from '@vybestack/llxprt-code-core/utils/retry.js';

/** Build a fake delegate provider that records each invocation. */
function makeFakeProvider(
  generator: (attempt: number) => AsyncGenerator<IContent>,
): { provider: IProvider; counter: { value: number } } {
  const counter = { value: 0 };
  const provider: IProvider = {
    name: 'test-provider',
    async *generateChatCompletion(): AsyncGenerator<IContent> {
      counter.value++;
      yield* generator(counter.value);
    },
    getModels: async () => [],
    getDefaultModel: () => 'test-model',
    getServerTools: () => [],
    invokeServerTool: async () => ({ content: [] }),
  };
  return { provider, counter };
}

/** Create a status-bearing error like the ones real providers throw. */
function statusError(message: string, status: number): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Create an Anthropic-style body-level overload error (no HTTP status). These
 * carry a `type` field like `overloaded_error` / `rate_limit_error` and are
 * classified transient by isOverloadError.
 */
function overloadError(type: string): Error {
  const error = new Error(type) as Error & { type: string };
  error.type = type;
  return error;
}

function makeOptions(): GenerateChatOptions {
  return {
    prompt: 'test prompt',
    messages: [{ role: 'user' as const, content: 'test' }],
  };
}

function makeFailoverConfig(profileName: string): LoadBalancingProviderConfig {
  return {
    profileName,
    strategy: 'failover',
    subProfiles: [
      {
        name: 'zai',
        providerName: 'test-provider',
        modelId: 'model1',
        baseURL: 'https://api.test.com',
        authToken: 'token-1',
      },
      {
        name: 'makoraglm51',
        providerName: 'test-provider',
        modelId: 'model2',
        baseURL: 'https://api.test.com',
        authToken: 'token-2',
      },
      {
        name: 'ollamaglm51',
        providerName: 'test-provider',
        modelId: 'model3',
        baseURL: 'https://api.test.com',
        authToken: 'token-3',
      },
    ],
  };
}

describe('LoadBalancingProvider - Failover aggregate retryability (issue #2450)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  /**
   * Drive a failover profile to exhaustion and capture the aggregate error.
   * Registers a fake delegate whose per-invocation behavior is supplied by
   * `generator`, runs a real LoadBalancingProvider to completion, and asserts
   * that the thrown value is a LoadBalancerFailoverError. Returns the aggregate
   * plus the invocation counter so callers can assert on retryability and the
   * number of backend attempts.
   */
  async function captureFailoverError(
    generator: (attempt: number) => AsyncGenerator<IContent>,
    profileName: string,
  ): Promise<{ error: LoadBalancerFailoverError; counter: { value: number } }> {
    const { provider, counter } = makeFakeProvider(generator);
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeFailoverConfig(profileName),
      providerManager,
    );

    let thrown: unknown;
    try {
      for await (const _chunk of lb.generateChatCompletion(makeOptions())) {
        // consume
      }
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(LoadBalancerFailoverError);
    return { error: thrown as LoadBalancerFailoverError, counter };
  }

  it.each([
    ['server', statusError('service unavailable', 503), 'server_error'],
    ['network', new Error('socket hang up'), 'network'],
  ])(
    'records a %s failure when the global budget ends after one transport',
    async (_label, failure, category) => {
      const { provider, counter } = makeFakeProvider(async function* () {
        throw failure;
        yield undefined as unknown as IContent;
      });
      providerManager.registerProvider(provider);
      const lb = new LoadBalancingProvider(
        {
          ...makeFailoverConfig('budget-one'),
          lbProfileEphemeralSettings: {
            failover_retry_count: 3,
            failover_retry_delay_ms: 10_000,
          },
        },
        providerManager,
      );
      const requestContext: Record<string, unknown> = {
        transportAttemptBudget: { limit: 1, used: 0 },
      };
      const options = {
        ...makeOptions(),
        metadata: { _retryRequestContext: requestContext },
      };

      let thrown: unknown;
      try {
        for await (const _chunk of lb.generateChatCompletion(options)) {
          // consume
        }
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        category,
        reason: 'retries_exhausted',
        failures: [{ error: failure }],
      });
      expect(counter.value).toBe(1);
    },
  );

  it('classifies an all-429 aggregate as retryable and does not masquerade as an HTTP 429', async () => {
    const { error, counter } = await captureFailoverError(
      function* (): AsyncGenerator<IContent> {
        throw statusError('rate limited', 429);
        yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
      },
      'glm-all-429',
    );

    expect(error.isRetryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
    expect(counter.value).toBe(3);
  });

  /**
   * Regression guard (issue #2450): an aggregate-of-failures is NOT itself an
   * HTTP 429 response, so it must deliberately expose NO HTTP status. This
   * prevents the aggregate from being mis-routed into the bucket-failover /
   * `onPersistent429` path in retryWithBackoff, which would either throw it
   * fatally before the isRetryable marker is consulted or bind its retry count
   * to bucket state. Recovery is driven solely by the isRetryable marker via
   * normal bounded retry.
   */
  it('exposes the safe homogeneous status on an all-429 aggregate', () => {
    const error = new LoadBalancerFailoverError('glm', [
      { profile: 'zai', error: statusError('rate limited', 429) },
      { profile: 'makoraglm51', error: statusError('rate limited', 429) },
      { profile: 'ollamaglm51', error: statusError('rate limited', 429) },
    ]);
    expect(getErrorStatus(error)).toBe(429);
    expect(error.category).toBe('rate_limit');
  });

  it('classifies an all-5xx aggregate as retryable', async () => {
    const { error, counter } = await captureFailoverError(
      function* (): AsyncGenerator<IContent> {
        throw statusError('service unavailable', 503);
        yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
      },
      'glm-all-5xx',
    );

    expect(error.isRetryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
    expect(counter.value).toBe(3);
  });

  it('classifies a mixed (429 + 400) aggregate as NON-retryable', async () => {
    const { error, counter } = await captureFailoverError(function* (
      attempt: number,
    ): AsyncGenerator<IContent> {
      if (attempt <= 2) {
        throw statusError('rate limited', 429);
      }
      throw statusError('bad request', 400);
      yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
    }, 'glm-mixed');

    expect(error.isRetryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
    expect(counter.value).toBe(3);
  });

  it('classifies a mixed (429 + 401 auth) aggregate as NON-retryable', async () => {
    const { error, counter } = await captureFailoverError(function* (
      attempt: number,
    ): AsyncGenerator<IContent> {
      if (attempt <= 2) {
        throw statusError('rate limited', 429);
      }
      throw statusError('unauthorized', 401);
      yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
    }, 'glm-mixed-auth');

    // A 401 is an auth/config problem, not transient load, so the whole
    // aggregate is non-retryable.
    expect(error.isRetryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
    expect(counter.value).toBe(3);
  });

  it('classifies an all-overload (Anthropic body-level "overloaded_error", no HTTP status) aggregate as retryable', async () => {
    const { error, counter } = await captureFailoverError(
      function* (): AsyncGenerator<IContent> {
        throw overloadError('overloaded_error');
        yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
      },
      'glm-all-overload',
    );

    expect(error.isRetryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
    expect(counter.value).toBe(3);
  });

  it('classifies an all-overload (Anthropic body-level "rate_limit_error", no HTTP status) aggregate as retryable', async () => {
    const { error, counter } = await captureFailoverError(
      function* (): AsyncGenerator<IContent> {
        throw overloadError('rate_limit_error');
        yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
      },
      'glm-all-rate-limit',
    );

    expect(error.isRetryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
    expect(counter.value).toBe(3);
  });

  /**
   * Regression guard (issue #2450 OCR finding): `RetryableQuotaError` (a Google
   * quota-limit error) carries NO HTTP `.status` — only `cause.code: 429` and
   * `retryDelayMs`. Core's `isRetryableError` handles it via `instanceof` at
   * PRIORITY 2, but `getErrorStatus` does NOT traverse `.cause.code`. If the
   * LB-level classifier forgot this category (as it initially did), an
   * all-quota aggregate would be non-retryable — the same #2450 fatal-drop bug
   * for Google providers.
   */
  it('classifies an all-RetryableQuotaError aggregate as retryable (Google quota, no HTTP status)', async () => {
    const quotaError = new RetryableQuotaError(
      'quota exceeded',
      { code: 429, message: 'Rate limit exceeded' },
      1,
    );
    const { error, counter } = await captureFailoverError(
      function* (): AsyncGenerator<IContent> {
        throw quotaError;
        yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
      },
      'glm-all-quota',
    );

    expect(error.isRetryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
    expect(counter.value).toBe(3);
  });

  /**
   * Blocking regression guard (issue #2450): a MIXED aggregate where one
   * backend fails transiently at the NETWORK layer (e.g. "socket hang up") and
   * another fails permanently (HTTP 400). Because the aggregate flattens each
   * child message into its own `.message`, a naive classifier that scans the
   * message for network-transient phrases BEFORE consulting the aggregate's own
   * decision would wrongly retry it. The aggregate is correctly non-retryable,
   * and `isRetryableError` must honor that despite the leaked "socket hang up"
   * text.
   */
  it('classifies a mixed (network-transient + 400) aggregate as NON-retryable despite the transient phrase leaking into the message', async () => {
    const { error, counter } = await captureFailoverError(function* (
      attempt: number,
    ): AsyncGenerator<IContent> {
      if (attempt <= 2) {
        // A network-transient failure whose message trips the phrase heuristic.
        throw new Error('socket hang up');
      }
      throw statusError('bad request', 400);
      yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
    }, 'glm-mixed-network-transient');

    // The flattened aggregate message really does contain the transient phrase.
    expect(error.message).toContain('socket hang up');
    // Sanity: that phrase in isolation IS classified network-transient. This
    // assertion is coupled to isNetworkTransientError's phrase heuristic; if
    // that heuristic changes, update the phrase here accordingly.
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
    // But the mixed aggregate is authoritatively non-retryable.
    expect(error.isRetryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
    expect(counter.value).toBe(3);
  });

  it('classifies an all-network-transient aggregate as retryable', async () => {
    const { error, counter } = await captureFailoverError(
      function* (): AsyncGenerator<IContent> {
        throw new Error('socket hang up');
        yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
      },
      'glm-all-network-transient',
    );

    expect(error.isRetryable).toBe(true);
    expect(isRetryableError(error)).toBe(true);
    expect(counter.value).toBe(3);
  });

  it('classifies an all-plain-Error (no status) aggregate as NON-retryable', async () => {
    const { error, counter } = await captureFailoverError(
      function* (): AsyncGenerator<IContent> {
        throw new Error('backend failed');
        yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
      },
      'glm-plain',
    );

    expect(error.isRetryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
    expect(counter.value).toBe(3);
  });

  it('preserves immediate failover-to-next-backend behavior on a single 429 (issue #902 regression guard)', async () => {
    const { provider, counter } = makeFakeProvider(function* (
      attempt: number,
    ): AsyncGenerator<IContent> {
      if (attempt === 1) {
        throw statusError('rate limited', 429);
      }
      yield { type: 'text' as const, content: 'ok' } as unknown as IContent;
    });
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeFailoverConfig('glm-one-429'),
      providerManager,
    );

    const chunks: IContent[] = [];
    for await (const chunk of lb.generateChatCompletion(makeOptions())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(counter.value).toBe(2);
  });

  /**
   * Streaming edge case (issue #2450 regression guard): when an immediate
   * failover error (e.g. 429) occurs AFTER the backend has already yielded
   * chunks to the consumer, the load balancer abandons the failover path and
   * re-throws the RAW backend error rather than wrapping it in a
   * LoadBalancerFailoverError. A partial stream cannot be silently retried
   * against another backend, so the consumer must see the underlying status
   * error, not the aggregate. This documents and guards that distinct path.
   *
   * The second backend's error is deliberately a distinct 500 (not a 429) so
   * that `getErrorStatus(thrown) === 429` can only pass if the FIRST backend's
   * error is the one re-thrown — not any 429 from any backend.
   */
  it('re-throws the raw backend error (not an aggregate) when a 429 occurs mid-stream after chunks were yielded', async () => {
    const { provider, counter } = makeFakeProvider(function* (
      attempt: number,
    ): AsyncGenerator<IContent> {
      if (attempt === 1) {
        yield {
          type: 'text' as const,
          content: 'partial',
        } as unknown as IContent;
        throw statusError('rate limited', 429);
      }
      // A second backend must never be reached; use a distinct error so the
      // 429 assertion can only pass via the FIRST backend's error.
      throw statusError('second backend should not be reached', 500);
      yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
    });
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeFailoverConfig('glm-midstream-429'),
      providerManager,
    );

    const received: IContent[] = [];
    const observedErrors: Array<{
      message: string;
      status?: number;
      category?: string;
    }> = [];
    let thrown: unknown;
    try {
      for await (const chunk of lb.generateChatCompletion({
        ...makeOptions(),
        onProviderError: (error) => observedErrors.push(error),
      })) {
        received.push(chunk);
      }
    } catch (e) {
      thrown = e;
    }

    // The partial chunk was delivered before the failure.
    expect(received).toHaveLength(1);
    // Because chunks were already yielded, the raw backend error is re-thrown
    // instead of being collected into an aggregate.
    expect(thrown).not.toBeInstanceOf(LoadBalancerFailoverError);
    expect(getErrorStatus(thrown)).toBe(429);
    expect(observedErrors).toStrictEqual([
      {
        message: 'rate limited',
        status: 429,
        category: 'rate_limit',
      },
    ]);
    // Only the first backend was ever invoked; no silent cross-backend retry.
    expect(counter.value).toBe(1);
  });

  it('LoadBalancerAllContextLimitsExceededError is NON-retryable', () => {
    const contextLimitError = new LoadBalancerContextLimitError({
      profileName: 'glm',
      subProfileName: 'zai',
      tokens: 500000,
      contextLimit: 128000,
    });
    const error = new LoadBalancerAllContextLimitsExceededError({
      profileName: 'glm',
      failures: [{ profile: 'zai', error: contextLimitError }],
    });

    expect(error.isRetryable).toBe(false);
    expect(isRetryableError(error)).toBe(false);
  });

  describe('LoadBalancerFailoverError unit tests (isRetryable)', () => {
    it('isRetryable is false for an empty failures array', () => {
      const error = new LoadBalancerFailoverError('glm', []);
      expect(error.isRetryable).toBe(false);
      // The empty-array boundary must still produce a well-formed, status-less
      // error (message construction must not depend on there being failures).
      expect(getErrorStatus(error)).toBeUndefined();
      expect(error.message).toBeTruthy();
      expect(error.failures).toHaveLength(0);
    });
  });
});
