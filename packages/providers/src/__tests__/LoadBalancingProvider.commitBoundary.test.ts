/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #2532: load-balancer commit-boundary behavior. Once any chunk
 * (including metadata-only usage events) escapes a backend attempt, the
 * load balancer must not retry the same backend, advance to another
 * backend, or lose the losing iterator on a first-chunk timeout. The
 * shared request commit state is marked by the same guarded-stream
 * primitive the orchestrator uses, and post-yield failures surface as
 * terminal errors so no upstream layer replays observable output.
 *
 * These tests compose a real LoadBalancingProvider with a real
 * ProviderManager and scripted delegate providers. The unit under test is
 * never mocked.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import {
  resolveRetryRequestContext,
  getRequestCommitState,
} from '../retryRequestContext.js';
import { isTerminalRetryError } from '../retryErrorClassification.js';
import { LoadBalancerFailoverError } from '../errors.js';

const textChunk: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'partial' }],
};

const metadataChunk: IContent = {
  speaker: 'ai',
  blocks: [],
  metadata: {
    usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
  },
};

function networkError(): Error {
  const error = new Error('socket hang up') as Error & { code: string };
  error.code = 'ECONNRESET';
  return error;
}

function statusError(message: string, status: number): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

type Script = (options: GenerateChatOptions) => AsyncIterableIterator<IContent>;

function makeScriptedProvider(
  name: string,
  scripts: Script[],
): { provider: IProvider; calls: { value: number } } {
  const calls = { value: 0 };
  const provider: IProvider = {
    name,
    generateChatCompletion(
      optionsOrContents: GenerateChatOptions | IContent[],
    ) {
      const options = optionsOrContents as GenerateChatOptions;
      const script = scripts[Math.min(calls.value, scripts.length - 1)];
      calls.value++;
      return script(options);
    },
    getModels: async () => [],
    getDefaultModel: () => `${name}-model`,
    getServerTools: () => [],
    invokeServerTool: async () => ({ content: [] }),
  };
  return { provider, calls };
}

function yieldThenThrow(chunk: IContent, error: Error): Script {
  return async function* script() {
    yield chunk;
    throw error;
  };
}

function alwaysThrow(error: Error): Script {
  return async function* script() {
    throw error;
    yield undefined as unknown as IContent; // eslint require-yield
  };
}

function successStream(text: string): Script {
  return async function* script() {
    yield { speaker: 'ai', blocks: [{ type: 'text', text }] } as IContent;
  };
}

function makeConfig(
  ephemerals?: Record<string, unknown>,
): LoadBalancingProviderConfig {
  return {
    profileName: 'lb-commit',
    strategy: 'failover',
    ...(ephemerals !== undefined
      ? { lbProfileEphemeralSettings: ephemerals }
      : {}),
    subProfiles: [
      {
        name: 'primary',
        providerName: 'provider-a',
        modelId: 'model-a',
        baseURL: 'https://a.test',
        authToken: 'token-a',
      },
      {
        name: 'secondary',
        providerName: 'provider-b',
        modelId: 'model-b',
        baseURL: 'https://b.test',
        authToken: 'token-b',
      },
    ],
  };
}

function makeOptions(): GenerateChatOptions {
  return createProviderCallOptions({
    providerName: 'load-balancer',
    contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    ephemerals: { retries: 8, retrywait: 0 },
  });
}

async function pullUntilFailure(
  provider: IProvider,
  options: GenerateChatOptions,
): Promise<{ first: IContent; failure: unknown }> {
  const iterator = provider.generateChatCompletion(options);
  const first = await iterator.next();
  if (first.done === true) {
    throw new Error('expected a first chunk before failure');
  }
  try {
    await iterator.next();
  } catch (failure) {
    return { first: first.value, failure };
  }
  throw new Error('expected the stream to fail after the first chunk');
}

async function expectFailure(
  provider: IProvider,
  options: GenerateChatOptions,
): Promise<unknown> {
  const iterator = provider.generateChatCompletion(options);
  try {
    await iterator.next();
  } catch (failure) {
    return failure;
  }
  throw new Error('expected the stream to fail');
}

async function pullFirst(
  provider: IProvider,
  options: GenerateChatOptions,
): Promise<IContent> {
  const iterator = provider.generateChatCompletion(options);
  const first = await iterator.next();
  if (first.done === true) throw new Error('stream ended immediately');
  return first.value;
}

describe('LoadBalancingProvider commit boundary (issue #2532)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  function registerAndCreate(
    backendA: { provider: IProvider; calls: { value: number } },
    backendB: { provider: IProvider; calls: { value: number } },
    cfg: LoadBalancingProviderConfig,
  ): LoadBalancingProvider {
    providerManager.registerProvider(backendA.provider);
    providerManager.registerProvider(backendB.provider);
    return new LoadBalancingProvider(cfg, providerManager);
  }

  it('does not retry the same backend or advance after partial text then network error', async () => {
    const failure = networkError();
    const backendA = makeScriptedProvider('provider-a', [
      yieldThenThrow(textChunk, failure),
    ]);
    const backendB = makeScriptedProvider('provider-b', [successStream('ok')]);
    const lb = registerAndCreate(backendA, backendB, makeConfig());

    const result = await pullUntilFailure(lb, makeOptions());

    expect(result.first).toStrictEqual(textChunk);
    expect(result.failure).toBe(failure);
    expect(backendA.calls.value).toBe(1);
    expect(backendB.calls.value).toBe(0);
  });

  it('does not retry the same backend or advance after partial text then 5xx', async () => {
    const failure = statusError('internal error', 500);
    const backendA = makeScriptedProvider('provider-a', [
      yieldThenThrow(textChunk, failure),
    ]);
    const backendB = makeScriptedProvider('provider-b', [successStream('ok')]);
    const lb = registerAndCreate(backendA, backendB, makeConfig());

    const result = await pullUntilFailure(lb, makeOptions());

    expect(result.failure).toBe(failure);
    expect(backendA.calls.value).toBe(1);
    expect(backendB.calls.value).toBe(0);
  });

  it('surfaces the terminal error instead of a retryable aggregate after partial text on a failover backend', async () => {
    const preOutputFailure = networkError();
    const postOutputFailure = networkError();
    const backendA = makeScriptedProvider('provider-a', [
      alwaysThrow(preOutputFailure),
    ]);
    const backendB = makeScriptedProvider('provider-b', [
      yieldThenThrow(textChunk, postOutputFailure),
    ]);
    const lb = registerAndCreate(backendA, backendB, makeConfig());

    const result = await pullUntilFailure(lb, makeOptions());

    expect(result.first).toStrictEqual(textChunk);
    expect(result.failure).toBe(postOutputFailure);
    expect(result.failure).not.toBeInstanceOf(LoadBalancerFailoverError);
    expect(isTerminalRetryError(result.failure)).toBe(true);
    // Backend A may retry pre-output before the rotation reaches B, but B
    // must never be retried after observable output escapes it.
    expect(backendA.calls.value).toBeGreaterThanOrEqual(1);
    expect(backendB.calls.value).toBe(1);
  });

  it('treats a metadata-only chunk as exposure: no retry, no advance', async () => {
    const failure = networkError();
    const backendA = makeScriptedProvider('provider-a', [
      yieldThenThrow(metadataChunk, failure),
    ]);
    const backendB = makeScriptedProvider('provider-b', [successStream('ok')]);
    const lb = registerAndCreate(backendA, backendB, makeConfig());

    const result = await pullUntilFailure(lb, makeOptions());

    expect(result.first).toStrictEqual(metadataChunk);
    expect(result.failure).toBe(failure);
    expect(backendA.calls.value).toBe(1);
    expect(backendB.calls.value).toBe(0);
  });

  it('marks the shared request commit state with a metadata floor through the guarded stream', async () => {
    const backendA = makeScriptedProvider('provider-a', [
      yieldThenThrow(metadataChunk, networkError()),
    ]);
    const backendB = makeScriptedProvider('provider-b', [successStream('ok')]);
    const lb = registerAndCreate(backendA, backendB, makeConfig());

    const request = resolveRetryRequestContext(makeOptions(), {
      maxAttempts: 8,
      initialDelayMs: 0,
      authRetryTimeoutMs: 30_000,
    });
    try {
      await pullUntilFailure(lb, request.options);
    } catch {
      request.releaseBudget();
      throw new Error('expected the pull to surface the scripted failure');
    }
    try {
      expect(getRequestCommitState(request).committed).toBe(true);
      expect(getRequestCommitState(request).exposure).toBe('metadata');
      expect(backendA.calls.value).toBe(1);
      expect(backendB.calls.value).toBe(0);
    } finally {
      request.releaseBudget();
    }
  });

  it('marks post-yield failures terminal on standalone load-balanced streams', async () => {
    const backendA = makeScriptedProvider('provider-a', [
      yieldThenThrow(textChunk, networkError()),
    ]);
    const backendB = makeScriptedProvider('provider-b', [successStream('ok')]);
    const lb = registerAndCreate(backendA, backendB, makeConfig());

    const result = await pullUntilFailure(lb, makeOptions());

    expect(isTerminalRetryError(result.failure)).toBe(true);
    expect(backendA.calls.value).toBe(1);
    expect(backendB.calls.value).toBe(0);
  });

  it('still retries the same backend and fails over before any output', async () => {
    const backendA = makeScriptedProvider('provider-a', [
      alwaysThrow(networkError()),
    ]);
    const backendB = makeScriptedProvider('provider-b', [successStream('ok')]);
    const lb = registerAndCreate(backendA, backendB, makeConfig());

    const first = await pullFirst(lb, makeOptions());

    expect(first).toMatchObject({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'ok' }],
    });
    // Default failover_retry_count is 2: backend A exhausts its own retries
    // before the rotation advances to backend B.
    expect(backendA.calls.value).toBe(2);
    expect(backendB.calls.value).toBe(1);
  });

  it('aggregates an all-429 rotation pre-exposure into a retryable failure', async () => {
    const backendA = makeScriptedProvider('provider-a', [
      alwaysThrow(statusError('rate limited', 429)),
    ]);
    const backendB = makeScriptedProvider('provider-b', [
      alwaysThrow(statusError('rate limited', 429)),
    ]);
    const lb = registerAndCreate(
      backendA,
      backendB,
      makeConfig({ failover_retry_count: 1 }),
    );

    const failure = await expectFailure(lb, makeOptions());

    expect(failure).toBeInstanceOf(LoadBalancerFailoverError);
    expect((failure as LoadBalancerFailoverError).isRetryable).toBe(true);
    expect(backendA.calls.value).toBe(1);
    expect(backendB.calls.value).toBe(1);
  });

  it('releases the losing stream and fails over on first-chunk timeout before output', async () => {
    let losingReleased = false;
    const hangScript: Script = (options) =>
      (async function* hang() {
        try {
          await delay(10_000, getRequestSignal(options));
          yield textChunk;
        } finally {
          losingReleased = true;
        }
      })();
    const backendA = makeScriptedProvider('provider-a', [hangScript]);
    const backendB = makeScriptedProvider('provider-b', [successStream('ok')]);
    const lb = registerAndCreate(
      backendA,
      backendB,
      makeConfig({ timeout_ms: 50, failover_retry_count: 1 }),
    );

    const first = await pullFirst(lb, makeOptions());

    expect(first).toMatchObject({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'ok' }],
    });
    expect(backendA.calls.value).toBe(1);
    expect(backendB.calls.value).toBe(1);
    // The losing stream must not linger for its full 10s pending delay: the
    // timeout aborts the attempt signal, which settles the hung generator.
    expect(losingReleased).toBe(true);
  });
});
