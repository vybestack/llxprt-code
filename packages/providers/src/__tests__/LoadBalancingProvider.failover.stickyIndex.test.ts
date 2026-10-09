/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import { LoadBalancerFailoverError } from '../errors.js';
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  isAsyncIterableContents,
  replayableContents,
} from '../utils/collectContents.js';

const requestContents = replayableContents([
  { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
  { speaker: 'human', blocks: [{ type: 'text', text: 'test prompt' }] },
]);

async function* generateInitialStickyResponse(
  options: GenerateChatOptions,
  callLog: string[],
): AsyncGenerator<IContent> {
  const model = options.resolved?.model ?? '';
  callLog.push(model);
  if (model === 'model-a') throw new Error('backend-a error');
  if (model === 'model-b') throw new Error('backend-b error');
  yield { speaker: 'ai', blocks: [{ type: 'text', text: 'success' }] };
}

async function* generateWraparoundStickyResponse(
  options: GenerateChatOptions,
  callLog: string[],
): AsyncGenerator<IContent> {
  const model = options.resolved?.model ?? '';
  callLog.push(model);
  if (model === 'model-c') {
    const error = new Error('Rate limited') as Error & { status: number };
    error.status = 429;
    throw error;
  }
  if (model === 'model-a') {
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'success from a' }] };
  }
  if (model === 'model-b') throw new Error('backend-b error');
}

async function* generatePhaseResetResponse(
  options: GenerateChatOptions,
  phase: 'first' | 'second',
  callLog: string[],
): AsyncGenerator<IContent> {
  const model = options.resolved?.model ?? '';
  callLog.push(model);
  if (phase === 'first') {
    if (model === 'model-a') throw new Error('backend-a error');
    if (model === 'model-b') throw new Error('backend-b error');
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'success from c' }] };
  } else {
    throw new Error('all backends failed');
  }
}

async function* generateFullRotationFailure(
  options: GenerateChatOptions,
  callLog: string[],
): AsyncGenerator<IContent> {
  const model = options.resolved?.model ?? 'unknown';
  callLog.push(model);
  const chunks: IContent[] = [];
  yield* chunks;
  throw new Error(`backend failed for ${model}`);
}

async function* generateMultiRequestStickyResponse(
  options: GenerateChatOptions,
  phase: 1 | 2 | 3,
  callLog: string[],
): AsyncGenerator<IContent> {
  const model = options.resolved?.model ?? '';
  callLog.push(`phase${phase}:${model}`);
  if (phase === 1) {
    if (model === 'zai-model') throw new Error('zai error');
    if (model === 'makora-model') throw new Error('makora error');
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ollama success' }] };
  } else if (phase === 2) {
    if (model === 'ollama-model') {
      const error = new Error('Rate limited') as Error & { status: number };
      error.status = 429;
      throw error;
    }
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'zai success' }] };
  } else {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'zai success again' }],
    };
  }
}
function makeStickyConfig(profileName: string): LoadBalancingProviderConfig {
  return {
    profileName,
    strategy: 'failover',
    lbProfileEphemeralSettings: { failover_retry_count: 1 },
    subProfiles: [
      {
        name: 'backend-a',
        providerName: 'test-provider',
        modelId: 'model-a',
        baseURL: 'https://api.test.com',
        authToken: 'test-token-a',
      },
      {
        name: 'backend-b',
        providerName: 'test-provider',
        modelId: 'model-b',
        baseURL: 'https://api.test.com',
        authToken: 'test-token-b',
      },
      {
        name: 'backend-c',
        providerName: 'test-provider',
        modelId: 'model-c',
        baseURL: 'https://api.test.com',
        authToken: 'test-token-c',
      },
    ],
  };
}

function makeMultiRequestConfig(): LoadBalancingProviderConfig {
  return {
    profileName: 'test-not-pegged',
    strategy: 'failover',
    lbProfileEphemeralSettings: { failover_retry_count: 1 },
    subProfiles: [
      {
        name: 'zai',
        providerName: 'test-provider',
        modelId: 'zai-model',
        baseURL: 'https://api.test.com',
        authToken: 'test-token-zai',
      },
      {
        name: 'makora',
        providerName: 'test-provider',
        modelId: 'makora-model',
        baseURL: 'https://api.test.com',
        authToken: 'test-token-makora',
      },
      {
        name: 'ollama',
        providerName: 'test-provider',
        modelId: 'ollama-model',
        baseURL: 'https://api.test.com',
        authToken: 'test-token-ollama',
      },
    ],
  };
}

function makeProviderManager(): ProviderManager {
  const settingsService = new SettingsService();
  const config = createRuntimeConfigStub(settingsService);
  return new ProviderManager({ settingsService, config });
}

describe('LoadBalancingProvider - Failover Sticky Index (Issue #2492) [part 1]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });

  it('should failover from sticky index 2 to healthy index 0', async () => {
    const callLog: string[] = [];

    const mockProvider: IProvider = {
      name: 'test-provider',
      generateChatCompletion: (
        options: GenerateChatOptions | AsyncIterable<IContent>,
      ) => generateInitialStickyResponse(requestOptions(options), callLog),
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
    };

    providerManager.registerProvider(mockProvider);

    const lbConfig = makeStickyConfig('test-sticky-wraparound');

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const options: GenerateChatOptions = {
      contents: requestContents,
    };

    callLog.length = 0;
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }

    expect(provider.getCurrentFailoverIndex()).toBe(2);

    callLog.length = 0;
    mockProvider.generateChatCompletion = (
      options: GenerateChatOptions | AsyncIterable<IContent>,
    ) => generateWraparoundStickyResponse(requestOptions(options), callLog);

    const results: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion(options)) {
      results.push(chunk);
    }

    expect(results[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'success from a' }],
    });
    expect(provider.getCurrentFailoverIndex()).toBe(0);
    expect(callLog).toStrictEqual(['model-c', 'model-a']);
  });
});

describe('LoadBalancingProvider - Failover Sticky Index (Issue #2492) [part 2]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });

  it('should reset sticky index to 0 after all backends fail', async () => {
    let phase: 'first' | 'second' = 'first';
    const callLog: string[] = [];

    const mockProvider: IProvider = {
      name: 'test-provider',
      generateChatCompletion: (
        options: GenerateChatOptions | AsyncIterable<IContent>,
      ) => generatePhaseResetResponse(requestOptions(options), phase, callLog),
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
    };

    providerManager.registerProvider(mockProvider);

    const lbConfig = makeStickyConfig('test-reset-on-all-fail');

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const options: GenerateChatOptions = {
      contents: requestContents,
    };

    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }

    expect(provider.getCurrentFailoverIndex()).toBe(2);
    expect(callLog).toStrictEqual(['model-a', 'model-b', 'model-c']);

    phase = 'second';
    callLog.length = 0;

    await expect(
      (async () => {
        for await (const _chunk of provider.generateChatCompletion(options)) {
          // consume
        }
      })(),
    ).rejects.toThrow(LoadBalancerFailoverError);

    expect(provider.getCurrentFailoverIndex()).toBe(0);
    expect(callLog).toStrictEqual(['model-c', 'model-a', 'model-b']);
  });
});

describe('LoadBalancingProvider - Failover Sticky Index (Issue #2492) [part 3]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });

  it('should attempt all backends in order and reset index to 0 when a full rotation from sticky index 0 fails', async () => {
    const callLog: string[] = [];

    const mockProvider: IProvider = {
      name: 'test-provider',
      generateChatCompletion: (
        options: GenerateChatOptions | AsyncIterable<IContent>,
      ) => generateFullRotationFailure(requestOptions(options), callLog),
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
    };

    providerManager.registerProvider(mockProvider);

    const lbConfig = makeStickyConfig('test-full-rotation-from-zero');

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const options: GenerateChatOptions = {
      contents: requestContents,
    };

    expect(provider.getCurrentFailoverIndex()).toBe(0);

    await expect(
      (async () => {
        for await (const _chunk of provider.generateChatCompletion(options)) {
          // consume
        }
      })(),
    ).rejects.toThrow(LoadBalancerFailoverError);

    expect(callLog).toStrictEqual(['model-a', 'model-b', 'model-c']);
    expect(provider.getCurrentFailoverIndex()).toBe(0);
  });
});

describe('LoadBalancingProvider - Failover Sticky Index (Issue #2492) [part 4]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });

  it('should not be pegged to exhausted backend across multiple requests', async () => {
    const callLog: string[] = [];

    let phase: 1 | 2 | 3 = 1;

    const mockProvider: IProvider = {
      name: 'test-provider',
      generateChatCompletion: (
        options: GenerateChatOptions | AsyncIterable<IContent>,
      ) =>
        generateMultiRequestStickyResponse(
          requestOptions(options),
          phase,
          callLog,
        ),
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
    };

    providerManager.registerProvider(mockProvider);

    const lbConfig = makeMultiRequestConfig();

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const options: GenerateChatOptions = {
      contents: requestContents,
    };

    const phase1Calls: string[] = [];
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }
    phase1Calls.push(...callLog.splice(0));
    expect(provider.getCurrentFailoverIndex()).toBe(2);
    expect(phase1Calls).toStrictEqual([
      'phase1:zai-model',
      'phase1:makora-model',
      'phase1:ollama-model',
    ]);

    phase = 2;
    const phase2Calls: string[] = [];
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }
    phase2Calls.push(...callLog.splice(0));
    expect(provider.getCurrentFailoverIndex()).toBe(0);
    expect(phase2Calls).toStrictEqual([
      'phase2:ollama-model',
      'phase2:zai-model',
    ]);

    phase = 3;
    const phase3Calls: string[] = [];
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }
    phase3Calls.push(...callLog.splice(0));
    expect(provider.getCurrentFailoverIndex()).toBe(0);
    expect(phase3Calls).toStrictEqual(['phase3:zai-model']);
  });
});

function requestOptions(
  options: GenerateChatOptions | AsyncIterable<IContent>,
): GenerateChatOptions {
  if (isAsyncIterableContents(options))
    throw new Error('Expected request options');
  return options;
}
