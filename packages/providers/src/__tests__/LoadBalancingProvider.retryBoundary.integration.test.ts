/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-end integration tests for issue #2450: proving the Loopbreaker is
 * actually fixed through the REAL retry boundary. A load-balancer `failover`
 * profile whose backends all transiently 429 in a single rotation must be
 * re-attempted as a whole rotation by the upstream `retryWithBackoff` layer
 * (driven solely by the aggregate's `isRetryable` marker), NOT thrown fatally
 * via the bucket-failover / `onPersistent429` path.
 *
 * These tests use the REAL `retryWithBackoff` from core wrapping a REAL
 * `LoadBalancingProvider` (real `ProviderManager`, fake delegate providers).
 * No mock theater — the unit under test is never mocked.
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
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../GenerateChatOptions.js';
import {
  retryWithBackoff,
  isRetryableError,
} from '@vybestack/llxprt-code-core/utils/retry.js';

/** A mutable handle onto the fake delegate's behavior. */
interface FakeBehavior {
  /**
   * Called with the 1-based global invocation count. Return a generator that
   * either throws (per-backend failure) or yields a success chunk.
   */
  respond: (invocation: number) => AsyncGenerator<IContent>;
}

/** Build a fake delegate provider that records each invocation. */
function makeFakeProvider(behavior: FakeBehavior): {
  provider: IProvider;
  counter: { value: number };
} {
  const counter = { value: 0 };
  const provider: IProvider = {
    name: 'test-provider',
    async *generateChatCompletion(): AsyncGenerator<IContent> {
      counter.value++;
      yield* behavior.respond(counter.value);
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

const NUM_BACKENDS = 3;

/** A generator that always throws a 429. */
function* always429(): AsyncGenerator<IContent> {
  throw statusError('rate limited', 429);
  yield undefined as unknown as IContent; // eslint require-yield; unreachable after throw
}

/** A generator that yields a single success chunk. */
function* successChunk(): AsyncGenerator<IContent> {
  yield { type: 'text' as const, content: 'ok' } as unknown as IContent;
}

/**
 * Because the LB throws lazily on the first pull, the retried `fn` must pull
 * the first chunk itself (mirroring StreamProcessor._consumeFirstChunkAndReturn).
 * On success it returns the first chunk so the caller can assert on it; on
 * failure the LB aggregate error propagates out to retryWithBackoff.
 */
async function pullFirstChunk(
  lb: LoadBalancingProvider,
  options: GenerateChatOptions,
): Promise<IContent> {
  const it = lb.generateChatCompletion(options);
  const first = await it.next();
  if (first.done === true) {
    throw new Error('stream ended immediately');
  }
  return first.value;
}

describe('LoadBalancingProvider retry boundary integration (issue #2450)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  /**
   * Scenario A (the core proof): fake delegates 429 on the ENTIRE first
   * rotation (all 3 backends), then SUCCEED on the next rotation. The call
   * must ultimately SUCCEED, proving the aggregate isRetryable marker drives
   * a whole-rotation retry through normal bounded backoff.
   *
   * This test FAILS if isRetryable isn't honored (the aggregate is fatal) or
   * if the aggregate is mis-classified as non-retryable.
   */
  it('Scenario A: retries a full failed all-429 rotation and succeeds on the next rotation', async () => {
    const behavior: FakeBehavior = {
      respond(invocation: number): AsyncGenerator<IContent> {
        // First full rotation (invocations 1..NUM_BACKENDS) all 429, then
        // succeed.
        if (invocation <= NUM_BACKENDS) {
          return always429();
        }
        return successChunk();
      },
    };
    const { provider, counter } = makeFakeProvider(behavior);
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeFailoverConfig('glm-retry-then-success'),
      providerManager,
    );

    const firstChunk = await retryWithBackoff(
      () => pullFirstChunk(lb, makeOptions()),
      {
        shouldRetryOnError: (e) => isRetryableError(e),
        maxAttempts: 3,
        initialDelayMs: 0,
        maxDelayMs: 0,
      },
    );

    expect(firstChunk).toStrictEqual({ type: 'text', content: 'ok' });
    // First rotation failed (3 invocations), then the second rotation's first
    // backend succeeded (1 more invocation).
    expect(counter.value).toBe(NUM_BACKENDS + 1);
  });

  /**
   * Scenario B (bounded + bucket-failover-path guard): ALL rotations always
   * 429. The call must:
   *   - reject with LoadBalancerFailoverError (the underlying aggregate), and
   *   - do so after EXACTLY `maxAttempts` full rotations
   *     (= maxAttempts × NUM_BACKENDS delegate invocations).
   *
   * Why the aggregate must NOT expose an HTTP `status` (the actual fix), and
   * what this test guards:
   *
   * Inside retryWithBackoff, `classifyError` derives `is429` purely from the
   * error's HTTP status (or an Anthropic overload body). The fixed aggregate
   * has NO status, so `is429` is false, `attemptFailover` returns 'proceed'
   * WITHOUT ever invoking `onPersistent429`, and recovery is driven solely by
   * `isRetryableError` (the structural marker) under normal bounded retry —
   * hence exactly maxAttempts × NUM_BACKENDS invocations.
   *
   * We deliberately wire `onPersistent429: async () => false` as a SAFETY NET
   * to prove the negative: even with a bucket-failover callback present, the
   * status-less aggregate never routes into it. Under the REJECTED `status =
   * 429` design the aggregate WOULD reach `onPersistent429`; a `false` return
   * there throws it fatally on attempt 1 (only NUM_BACKENDS invocations),
   * whereas a `true` return decrements the attempt counter and loops
   * unbounded. Asserting exactly maxAttempts × NUM_BACKENDS therefore fails
   * under that design in both directions and passes only for the status-less
   * fix. The callback is asserted to have been NEVER called to make the
   * "bucket failover is not on the active path" guarantee explicit.
   */
  it('Scenario B: bounded by maxAttempts and never routes a status-less aggregate into bucket failover', async () => {
    const behavior: FakeBehavior = {
      respond(): AsyncGenerator<IContent> {
        return always429();
      },
    };
    const { provider, counter } = makeFakeProvider(behavior);
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeFailoverConfig('glm-always-429'),
      providerManager,
    );

    const maxAttempts = 3;
    let onPersistent429Calls = 0;
    const failoverCallback = async (): Promise<boolean> => {
      onPersistent429Calls++;
      return false;
    };

    let thrown: unknown;
    try {
      await retryWithBackoff(() => pullFirstChunk(lb, makeOptions()), {
        shouldRetryOnError: (e) => isRetryableError(e),
        maxAttempts,
        initialDelayMs: 0,
        maxDelayMs: 0,
        onPersistent429: failoverCallback,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(LoadBalancerFailoverError);
    // Exactly maxAttempts full rotations × NUM_BACKENDS invocations. Not 1
    // rotation (which a status-bearing aggregate would produce by routing into
    // onPersistent429), and not unbounded.
    expect(counter.value).toBe(maxAttempts * NUM_BACKENDS);
    // The status-less aggregate is never classified as a 429, so the
    // bucket-failover callback is never reached.
    expect(onPersistent429Calls).toBe(0);
  });
});
