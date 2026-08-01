/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral acceptance tests for issue #2849: a load-balancer `failover`
 * profile must be at least as reliable as a standalone provider profile for
 * transient 429 (rate-limit) errors.
 *
 * Root cause: `isImmediateFailoverError()` previously treated 429 as an
 * immediate-failover signal alongside 401/402/403. This caused the LB to skip
 * same-backend retry entirely and burn the shared transport-attempt budget
 * cycling through backends. With 3 backends and a budget of 6, the LB got
 * only 2 full rotations — far fewer retries than a standalone provider, which
 * retries 429s with exponential backoff up to the same budget.
 *
 * Fix: 429 is no longer an immediate-failover error. The LB now retries 429
 * on the same backend (up to `failover_retry_count`, default 2) before
 * advancing to the next backend. Only after exhausting per-backend retries
 * does the LB fail over. Auth errors (401/402/403) remain immediate-failover.
 *
 * These tests use the real `LoadBalancingProvider`, a real `ProviderManager`,
 * and fake delegate providers. No mock theater.
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
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../GenerateChatOptions.js';

/** Build a fake delegate whose per-invocation behavior is supplied inline. */
function makeFakeProvider(
  respond: (invocation: number) => AsyncGenerator<IContent>,
): { provider: IProvider; counter: { value: number } } {
  const counter = { value: 0 };
  const provider: IProvider = {
    name: 'test-provider',
    async *generateChatCompletion(): AsyncGenerator<IContent> {
      counter.value++;
      yield* respond(counter.value);
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

/** A generator that always throws the given status. */
function throwStatus(
  message: string,
  status: number,
): () => AsyncGenerator<IContent> {
  return function* (): AsyncGenerator<IContent> {
    throw statusError(message, status);
    yield undefined as unknown as IContent; // eslint require-yield
  };
}

/** A generator that yields a single success chunk. */
function* successChunk(): AsyncGenerator<IContent> {
  yield { type: 'text' as const, content: 'ok' } as unknown as IContent;
}

function makeOptions(): GenerateChatOptions {
  return {
    prompt: 'test prompt',
    messages: [{ role: 'user' as const, content: 'test' }],
  };
}

/**
 * Three-backend failover config matching the issue's "glm" profile (zai +
 * makoraglm51 + ollamaglm51). Uses the DEFAULT failover_retry_count (now 2)
 * — no lbProfileEphemeralSettings override — so the test exercises the
 * production default behavior.
 */
function makeGlmConfig(profileName: string): LoadBalancingProviderConfig {
  return {
    profileName,
    strategy: 'failover',
    subProfiles: [
      {
        name: 'zai',
        providerName: 'test-provider',
        modelId: 'model1',
        baseURL: 'https://api.z.ai',
        authToken: 'token-1',
      },
      {
        name: 'makoraglm51',
        providerName: 'test-provider',
        modelId: 'model2',
        baseURL: 'https://api.makora.ai',
        authToken: 'token-2',
      },
      {
        name: 'ollamaglm51',
        providerName: 'test-provider',
        modelId: 'model3',
        baseURL: 'https://api.ollama.ai',
        authToken: 'token-3',
      },
    ],
  };
}

/** Consume the entire stream and return all chunks. */
async function consumeStream(
  provider: LoadBalancingProvider,
  options: GenerateChatOptions,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of provider.generateChatCompletion(options)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('LoadBalancingProvider issue #2849: LB reliability for transient 429', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  /**
   * Core acceptance: a single transient 429 on the primary backend must be
   * retried on the SAME backend (not immediately failed over). This gives
   * the LB at least the same retry behavior as a standalone provider.
   */
  it('retries a transient 429 on the same backend before failing over', async () => {
    const { provider, counter } = makeFakeProvider((invocation) => {
      if (invocation === 1) {
        return throwStatus('rate limited', 429)();
      }
      return successChunk();
    });
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-transient-429'),
      providerManager,
    );

    const chunks = await consumeStream(lb, makeOptions());

    expect(chunks).toHaveLength(1);
    // Both invocations hit zai (backend 0): first 429, second success.
    expect(counter.value).toBe(2);
    // Stayed on zai — no failover.
    expect(lb.getCurrentFailoverIndex()).toBe(0);
  });

  /**
   * After exhausting per-backend retries (default 2) on persistent 429, the
   * LB must still advance to the next backend. This prevents infinite
   * retrying of a truly exhausted backend while still giving transient 429s
   * a chance to recover.
   */
  it('fails over to the next backend after exhausting per-backend retries on persistent 429', async () => {
    const { provider, counter } = makeFakeProvider((invocation) => {
      // zai attempts 1+2: both 429 (exhaust retryCount=2)
      // makoraglm51 attempt 3: succeeds
      if (invocation <= 2) {
        return throwStatus('rate limited', 429)();
      }
      return successChunk();
    });
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-persistent-429-then-success'),
      providerManager,
    );

    const chunks = await consumeStream(lb, makeOptions());

    expect(chunks).toHaveLength(1);
    // zai tried twice (both 429), then makoraglm51 succeeded.
    expect(counter.value).toBe(3);
    // Failover index advanced to makoraglm51 (index 1).
    expect(lb.getCurrentFailoverIndex()).toBe(1);
  });

  /**
   * Regression guard: 401 (auth) must still cause IMMEDIATE failover — no
   * same-backend retry. Auth errors are non-transient; retrying the same
   * backend is futile.
   */
  it('still immediately fails over on 401 auth errors without same-backend retry', async () => {
    const { provider, counter } = makeFakeProvider((invocation) => {
      // zai attempt 1: 401 (immediate failover)
      // makoraglm51 attempt 2: succeeds
      if (invocation === 1) {
        return throwStatus('unauthorized', 401)();
      }
      return successChunk();
    });
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-auth-failover'),
      providerManager,
    );

    const chunks = await consumeStream(lb, makeOptions());

    expect(chunks).toHaveLength(1);
    // Only 2 invocations: zai 401 → immediate failover → makoraglm51 success.
    expect(counter.value).toBe(2);
    expect(lb.getCurrentFailoverIndex()).toBe(1);
  });

  /**
   * Full reliability scenario: one backend is healthy (zai), two are
   * persistently exhausted. The LB must succeed by retrying/failing-over
   * through the rotation without burning the budget excessively. This is the
   * scenario described in the issue: "zai is not exhausted, it sometimes
   * throws minor errors" — a transient 429 on zai should recover on retry,
   * not cause a loopbreak.
   */
  it('succeeds when the primary backend has a transient 429 and others are persistently exhausted', async () => {
    const { provider, counter } = makeFakeProvider((invocation) => {
      // zai attempt 1: transient 429
      // zai attempt 2 (retry): success
      // (makoraglm51 and ollamaglm51 never reached)
      if (invocation === 1) {
        return throwStatus('rate limited', 429)();
      }
      return successChunk();
    });
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-zai-transient-others-exhausted'),
      providerManager,
    );

    const chunks = await consumeStream(lb, makeOptions());

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toStrictEqual({ type: 'text', content: 'ok' });
    // Only 2 invocations: zai 429 → retry → zai success.
    // The LB did NOT fail over to the exhausted backends.
    expect(counter.value).toBe(2);
    expect(lb.getCurrentFailoverIndex()).toBe(0);
  });

  /**
   * When all backends are persistently exhausted (all 429 on every attempt),
   * the LB must throw an aggregate error after bounded attempts. With the
   * default retryCount=2 and 3 backends, this is 6 delegate invocations.
   */
  it('throws a bounded aggregate error when all backends are persistently 429', async () => {
    const { provider, counter } = makeFakeProvider(() =>
      throwStatus('rate limited', 429)(),
    );
    providerManager.registerProvider(provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-all-persistent-429'),
      providerManager,
    );

    await expect(consumeStream(lb, makeOptions())).rejects.toThrow(
      /Load balancer "glm-all-persistent-429"/,
    );

    // 3 backends × 2 retries each = 6 bounded invocations.
    expect(counter.value).toBe(6);
  });
});
