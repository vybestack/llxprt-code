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
 * These tests use the real `RetryOrchestrator` wrapping a real
 * `LoadBalancingProvider` (real `ProviderManager`, fake delegate providers).
 * No mock theater — the unit under test is never mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../GenerateChatOptions.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

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

function makeOptions(retries: number): GenerateChatOptions {
  return createProviderCallOptions({
    providerName: 'load-balancer',
    contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'test' }] }],
    ephemerals: { retries, retrywait: 0 },
  });
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
function requireProvider(provider: IProvider | undefined): IProvider {
  if (provider === undefined) throw new Error('load balancer not registered');
  return provider;
}

async function pullFirstChunk(
  provider: IProvider,
  options: GenerateChatOptions,
): Promise<IContent> {
  const iterator = provider.generateChatCompletion(options);
  const first = await iterator.next();
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

    providerManager.registerProvider(
      new LoadBalancingProvider(
        makeFailoverConfig('glm-retry-then-success'),
        providerManager,
      ),
    );
    const providerChain = requireProvider(
      providerManager.getProviderByName('load-balancer'),
    );

    const firstChunk = await pullFirstChunk(
      providerChain,
      makeOptions(NUM_BACKENDS + 1),
    );

    expect(firstChunk).toStrictEqual({ type: 'text', content: 'ok' });
    // First rotation failed (3 invocations), then the second rotation's first
    // backend succeeded (1 more invocation).
    expect(counter.value).toBe(NUM_BACKENDS + 1);
  });

  /**
   * Scenario B (bounded + bucket-failover-path guard): every backend returns
   * 429. Each transport failure must be observed before aggregation so a
   * pre-request timeout can retain the provider's classified rate-limit error.
   * The aggregate adds no new provider failure and must not be observed again.
   *
   * The shared transport budget bounds the request to `maxAttempts` delegate
   * invocations. Although the homogeneous aggregate safely retains status 429,
   * its explicit bucket-failover policy keeps the profile's internal backend
   * failures out of credential-bucket failover.
   */
  it('Scenario B: observes each bounded backend 429 once without bucket failover or aggregate duplication', async () => {
    const behavior: FakeBehavior = {
      respond(): AsyncGenerator<IContent> {
        return always429();
      },
    };
    const { provider, counter } = makeFakeProvider(behavior);
    providerManager.registerProvider(provider);

    const maxAttempts = 3;
    const providerChain = new RetryOrchestrator(
      new LoadBalancingProvider(
        makeFailoverConfig('glm-always-429'),
        providerManager,
      ),
      { maxAttempts, initialDelayMs: 0 },
    );
    const observed: Array<{
      message: string;
      status?: number;
      category?: string;
    }> = [];
    const tryFailover = vi.fn(async () => true);
    const bucketHandler = {
      tryFailover,
      getProviderName: () => 'test-provider',
      getAttemptedBuckets: () => [],
      getBucketFailureReasons: () => ({}),
    };
    const configWithBucketHandler = {
      ...config,
      getBucketFailoverHandler: () => bucketHandler,
    } as Config;
    const options = {
      ...makeOptions(maxAttempts),
      config: configWithBucketHandler,
      onProviderError: (error: {
        message: string;
        status?: number;
        category?: string;
      }) => {
        observed.push(error);
      },
    };

    await expect(pullFirstChunk(providerChain, options)).rejects.toMatchObject({
      status: 429,
      category: 'rate_limit',
      reason: 'retries_exhausted',
      isRetryable: false,
    });
    expect(counter.value).toBe(maxAttempts);
    expect(observed).toStrictEqual(
      Array.from({ length: maxAttempts }, () => ({
        message: 'rate limited',
        status: 429,
        category: 'rate_limit',
      })),
    );
    expect(tryFailover).not.toHaveBeenCalled();
  });
});
