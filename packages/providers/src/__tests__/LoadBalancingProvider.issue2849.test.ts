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
  providerName = 'test-provider',
): { provider: IProvider; counter: { value: number } } {
  const counter = { value: 0 };
  const provider: IProvider = {
    name: providerName,
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
 *
 * Each sub-profile references a distinct providerName so individual backends
 * can be configured with different failure modes (e.g., healthy vs exhausted).
 */
function makeGlmConfig(
  profileName: string,
  providers: [string, string, string] = [
    'zai-provider',
    'makora-provider',
    'ollama-provider',
  ],
): LoadBalancingProviderConfig {
  return {
    profileName,
    strategy: 'failover',
    subProfiles: [
      {
        name: 'zai',
        providerName: providers[0],
        modelId: 'model1',
        baseURL: 'https://api.z.ai',
        authToken: 'token-1',
      },
      {
        name: 'makoraglm51',
        providerName: providers[1],
        modelId: 'model2',
        baseURL: 'https://api.makora.ai',
        authToken: 'token-2',
      },
      {
        name: 'ollamaglm51',
        providerName: providers[2],
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
    }, 'zai-provider');
    providerManager.registerProvider(provider);
    // Other backends would fail if reached, but zai succeeds on retry.
    const exhausted1 = makeFakeProvider(
      () => throwStatus('rate limited', 429)(),
      'makora-provider',
    );
    providerManager.registerProvider(exhausted1.provider);
    const exhausted2 = makeFakeProvider(
      () => throwStatus('rate limited', 429)(),
      'ollama-provider',
    );
    providerManager.registerProvider(exhausted2.provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-transient-429'),
      providerManager,
    );

    const chunks = await consumeStream(lb, makeOptions());

    expect(chunks).toHaveLength(1);
    // Both invocations hit zai (backend 0): first 429, second success.
    expect(counter.value).toBe(2);
    // Other backends never reached.
    expect(exhausted1.counter.value).toBe(0);
    expect(exhausted2.counter.value).toBe(0);
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
    const zai = makeFakeProvider(
      () => throwStatus('rate limited', 429)(),
      'zai-provider',
    );
    providerManager.registerProvider(zai.provider);
    const makora = makeFakeProvider(() => successChunk(), 'makora-provider');
    providerManager.registerProvider(makora.provider);
    const ollama = makeFakeProvider(
      () => throwStatus('rate limited', 429)(),
      'ollama-provider',
    );
    providerManager.registerProvider(ollama.provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-persistent-429-then-success'),
      providerManager,
    );

    const chunks = await consumeStream(lb, makeOptions());

    expect(chunks).toHaveLength(1);
    // zai tried twice (both 429), then makoraglm51 succeeded.
    expect(zai.counter.value).toBe(2);
    expect(makora.counter.value).toBe(1);
    // ollamaglm51 never reached.
    expect(ollama.counter.value).toBe(0);
    // Failover index advanced to makoraglm51 (index 1).
    expect(lb.getCurrentFailoverIndex()).toBe(1);
  });

  /**
   * Regression guard: 401 (auth) must still cause IMMEDIATE failover — no
   * same-backend retry. Auth errors are non-transient; retrying the same
   * backend is futile.
   */
  it('still immediately fails over on 401 auth errors without same-backend retry', async () => {
    const zai = makeFakeProvider(
      () => throwStatus('unauthorized', 401)(),
      'zai-provider',
    );
    providerManager.registerProvider(zai.provider);
    const makora = makeFakeProvider(() => successChunk(), 'makora-provider');
    providerManager.registerProvider(makora.provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-auth-failover'),
      providerManager,
    );

    const chunks = await consumeStream(lb, makeOptions());

    expect(chunks).toHaveLength(1);
    // Only 1 invocation on zai: 401 → immediate failover.
    expect(zai.counter.value).toBe(1);
    // makoraglm51 succeeded on first attempt.
    expect(makora.counter.value).toBe(1);
    expect(lb.getCurrentFailoverIndex()).toBe(1);
  });

  /**
   * Full reliability scenario from the issue: zai is healthy but sometimes
   * throws a transient 429; makoraglm51 and ollamaglm51 are persistently
   * exhausted. The LB must succeed by retrying zai's transient 429 on the
   * same backend — NOT by failing over to the exhausted backends. This
   * proves the LB is "as reliable as zai alone" even when the other backends
   * are down.
   */
  it('succeeds when zai has a transient 429 and other backends are persistently exhausted', async () => {
    const zai = makeFakeProvider((invocation) => {
      if (invocation === 1) {
        return throwStatus('rate limited', 429)();
      }
      return successChunk();
    }, 'zai-provider');
    providerManager.registerProvider(zai.provider);
    const makora = makeFakeProvider(
      () => throwStatus('rate limit exhausted', 429)(),
      'makora-provider',
    );
    providerManager.registerProvider(makora.provider);
    const ollama = makeFakeProvider(
      () => throwStatus('rate limit exhausted', 429)(),
      'ollama-provider',
    );
    providerManager.registerProvider(ollama.provider);

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-zai-transient-others-exhausted'),
      providerManager,
    );

    const chunks = await consumeStream(lb, makeOptions());

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toStrictEqual({ type: 'text', content: 'ok' });
    // zai: 429 then success on retry — never failed over.
    expect(zai.counter.value).toBe(2);
    // Exhausted backends never reached because zai succeeded on retry.
    expect(makora.counter.value).toBe(0);
    expect(ollama.counter.value).toBe(0);
    expect(lb.getCurrentFailoverIndex()).toBe(0);
  });

  /**
   * When all backends are persistently exhausted (all 429 on every attempt),
   * the LB must throw an aggregate error after bounded attempts. With the
   * default retryCount=2 and 3 backends, this is 6 delegate invocations.
   */
  it('throws a bounded aggregate error when all backends are persistently 429', async () => {
    const counters: Array<{ value: number }> = [];
    for (const name of ['zai-provider', 'makora-provider', 'ollama-provider']) {
      const fake = makeFakeProvider(
        () => throwStatus('rate limited', 429)(),
        name,
      );
      counters.push(fake.counter);
      providerManager.registerProvider(fake.provider);
    }

    const lb = new LoadBalancingProvider(
      makeGlmConfig('glm-all-persistent-429'),
      providerManager,
    );

    await expect(consumeStream(lb, makeOptions())).rejects.toThrow(
      /Load balancer "glm-all-persistent-429"/,
    );

    // Each backend tried 2 times (retryCount=2). 3 backends × 2 = 6 total.
    const total = counters.reduce((sum, c) => sum + c.value, 0);
    expect(total).toBe(6);
  });
});
