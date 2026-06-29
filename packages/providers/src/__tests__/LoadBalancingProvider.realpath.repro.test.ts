/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { ExtendedLoadBalancerStats } from '../LoadBalancingProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Narrow a wrapped provider to one exposing getStats(), mirroring the runtime
 * guard the footer/diagnostics use (modelIdentity.ts hasGetStats). Avoids the
 * `as unknown as { getStats }` erasure while still crossing the wrapper chain.
 */
interface HasStats {
  getStats: () => ExtendedLoadBalancerStats;
}

function hasGetStats(value: unknown): value is HasStats {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getStats' in value &&
    typeof (value as { getStats?: unknown }).getStats === 'function'
  );
}

function assertHasStats(value: unknown): asserts value is HasStats {
  expect(hasGetStats(value)).toBe(true);
}

function makeMockProvider(name: string): IProvider {
  return {
    name,
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {
      yield { role: 'model', parts: [{ text: `${name} response` }] };
    },
    getModels: async () => [],
    getDefaultModel: () => 'model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
  } as unknown as IProvider;
}

describe('LB stats through the REAL registerProvider wrapping chain', () => {
  it('getProviderByName().getStats() returns real, live stats after wrapping', async () => {
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService);
    const providerManager = new ProviderManager({ settingsService, config });

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'glm',
      strategy: 'failover',
      subProfiles: [
        { name: 'zai', providerName: 'gemini', modelId: 'glm-4-zai' },
        { name: 'makoraglm51', providerName: 'gemini', modelId: 'glm-5-mak' },
      ],
    };
    const raw = new LoadBalancingProvider(lbConfig, providerManager);

    // Direct stats (what tests currently assert)
    const directStats = raw.getStats();
    expect(directStats.profileName).toBe('glm');
    expect(directStats.totalRequests).toBe(0);
    expect(directStats.lastSelected).toBeNull();

    // Register through the production path (wraps in Retry + Logging)
    providerManager.registerProvider(raw as unknown as IProvider);

    const resolved = providerManager.getProviderByName('load-balancer');
    expect(resolved).toBeDefined();
    // The wrapper exposes getStats through the chain (asserts + narrows type).
    assertHasStats(resolved);

    // Static identity survives the wrapper chain...
    expect(resolved.getStats().profileName).toBe('glm');

    // ...and so do LIVE stats: drive a real request through the wrapped
    // provider and confirm the mutation is visible via the same getStats()
    // the footer/diagnostics call (not a stale snapshot).
    const original = providerManager.getProviderByName.bind(providerManager);
    providerManager.getProviderByName = (name: string) =>
      name === 'gemini' ? makeMockProvider('gemini') : original(name);

    try {
      for await (const _chunk of raw.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      })) {
        // consume
      }
    } finally {
      providerManager.getProviderByName = original;
    }

    const liveStats = resolved.getStats();
    expect(liveStats.totalRequests).toBe(1);
    expect(liveStats.lastSelected).toBe('zai');
    expect(liveStats.lastSelectedModel).toBe('glm-4-zai');
  });
});
