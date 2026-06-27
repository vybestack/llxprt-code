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

describe('LB stats through the REAL registerProvider wrapping chain', () => {
  it('getProviderByName().getStats() returns real stats after wrapping', () => {
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

    // Register through the production path (wraps in Retry + Logging)
    providerManager.registerProvider(raw as unknown as IProvider);

    const resolved = providerManager.getProviderByName('load-balancer');
    expect(resolved).toBeDefined();

    const resolvedHasGetStats =
      resolved !== undefined &&
      'getStats' in resolved &&
      typeof (resolved as { getStats?: unknown }).getStats === 'function';

    // The wrapper exposes getStats...
    expect(resolvedHasGetStats).toBe(true);

    // ...but does it actually return the real stats through the chain?
    const viaWrapper = (
      resolved as unknown as { getStats: () => unknown }
    ).getStats();

    // THIS is the production reality the footer/diagnostics see.
    expect(viaWrapper).toBeDefined();
    expect((viaWrapper as { profileName?: string }).profileName).toBe('glm');
  });
});
