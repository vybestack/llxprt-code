/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type ResolvedSubProfile,
} from '../LoadBalancingProvider.js';

describe('LoadBalancingProvider.getContextLimit() (issue #2251)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('returns the config-level contextLimit when set', () => {
    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'config-limit-lb',
      strategy: 'round-robin',
      contextLimit: 32_000,
      subProfiles: [
        {
          name: 'primary',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    expect(provider.getContextLimit()).toBe(32_000);
  });

  it('returns the min-across-pool contextWindow when no config-level limit is set', () => {
    const subA: ResolvedSubProfile = {
      name: 'sub-a',
      providerName: 'anthropic',
      model: 'claude-opus-4',
      contextWindow: 200_000,
      ephemeralSettings: {},
      modelParams: {},
    };
    const subB: ResolvedSubProfile = {
      name: 'sub-b',
      providerName: 'google',
      model: 'gemini-2.0-flash',
      contextWindow: 1_000_000,
      ephemeralSettings: {},
      modelParams: {},
    };
    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'min-window-lb',
      strategy: 'round-robin',
      subProfiles: [subA, subB],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    expect(provider.getContextLimit()).toBe(200_000);
  });

  it('returns undefined when neither config limit nor resolvable contextWindows exist', () => {
    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'unresolved-lb',
      strategy: 'round-robin',
      subProfiles: [
        {
          name: 'plain-sub',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    expect(provider.getContextLimit()).toBeUndefined();
  });

  it('prefers config-level contextLimit over member contextWindows', () => {
    const sub: ResolvedSubProfile = {
      name: 'sub-a',
      providerName: 'anthropic',
      model: 'claude-opus-4',
      contextWindow: 200_000,
      ephemeralSettings: {},
      modelParams: {},
    };
    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'config-wins-lb',
      strategy: 'round-robin',
      contextLimit: 50_000,
      subProfiles: [sub],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    expect(provider.getContextLimit()).toBe(50_000);
  });
});
