/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime assembly tests extracted from the original monolithic
 * subagentOrchestrator.test.ts so no file-level max-lines disable is needed.
 * Part 2: load-balancer subagent profile resolution (Issue #2410), split from
 * subagentOrchestrator-runtime.test.ts to stay under the max-lines limit.
 */

import { describe, expect, it, vi } from 'bun:test';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { SubAgentScope } from '../subagent.js';
import { type SubAgentScope as SubAgentScopeInstance } from '../subagent.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import {
  makeForegroundConfig,
  createRuntimeBundle,
} from './subagentOrchestrator-test-helpers.js';

describe('SubagentOrchestrator - Runtime Assembly (load balancer profiles)', () => {
  it('preserves load balancer profile as effective profile for failover (Issue #2410)', async () => {
    const loadBalancerSubagent: SubagentConfig = {
      name: 'typescript-helper',
      profile: 'typescript-lb',
      systemPrompt: 'Write TypeScript carefully.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const loadBalancerProfile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'failover',
      profiles: ['anthropic-fast', 'openai-fallback'],
      provider: 'load-balancer',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'tools.allowed': ['read_file'],
        'compression-threshold': 0.9,
      },
    };

    const anthropicProfile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {
        temperature: 0.2,
        top_p: 0.8,
      },
      ephemeralSettings: {
        'auth-key': 'anthropic-key',
      },
    };

    const openaiProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'openai-key',
      },
    };

    const loadSubagent = vi.fn().mockResolvedValue(loadBalancerSubagent);
    const loadProfile = vi.fn(async (profileName: string) => {
      if (profileName === 'typescript-lb') {
        return loadBalancerProfile;
      }
      if (profileName === 'anthropic-fast') {
        return anthropicProfile;
      }
      if (profileName === 'openai-fallback') {
        return openaiProfile;
      }
      throw new Error(`unexpected profile ${profileName}`);
    });

    const config = makeForegroundConfig();
    const runtimeBundle = createRuntimeBundle('load-balancer');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'typescript-helper-1',
    } as unknown as SubAgentScopeInstance;
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockResolvedValue(scope);

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: config,
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    const result = await orchestrator.launch({
      name: loadBalancerSubagent.name,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    const settingsService = loaderArgs.profile.providerRuntime.settingsService;

    // The load-balancer profile is preserved and activated as a real
    // load-balancer provider, not collapsed to profiles[0].
    expect(result.profile).toBe(loadBalancerProfile);

    // All referenced sub-profiles are validated and resolved by the isolated
    // runtime's profile manager while registering the load-balancer provider.
    expect(loadProfile).toHaveBeenCalledWith('typescript-lb');
    expect(loadProfile).toHaveBeenCalledWith('anthropic-fast');
    expect(loadProfile).toHaveBeenCalledWith('openai-fallback');

    expect(loaderArgs.profile.state.provider).toBe('load-balancer');
    expect(loaderArgs.profile.state.model).toBe('load-balancer');
    // loadBalancerProfile.modelParams is {}, so the orchestrator applies its
    // standard runtime defaults for temperature (0.7) and top_p (1).
    expect(loaderArgs.profile.state.modelParams).toMatchObject({
      temperature: 0.7,
      topP: 1,
    });
    expect(loaderArgs.profile.settings.compressionThreshold).toBe(0.9);
    expect(loaderArgs.profile.settings.tools?.allowed).toStrictEqual([
      'read_file',
    ]);
    expect(loaderArgs.profile.contentGeneratorConfig.model).toBe(
      'load-balancer',
    );
    expect(loaderArgs.profile.contentGeneratorConfig.apiKey).toBeUndefined();
    expect(loaderArgs.profile.contentGeneratorConfig.providerManager).toBe(
      loaderArgs.profile.providerManager,
    );
    expect(loaderArgs.profile.providerManager).toBeDefined();
    expect(settingsService.getCurrentProfileName()).toBe(
      loadBalancerSubagent.profile,
    );
    expect(settingsService.get('activeProvider')).toBe('load-balancer');
    expect(settingsService.get('providers.load-balancer.model')).toBe(
      'load-balancer',
    );
  });

  it('rejects load balancer subagent profiles without referenced profiles', async () => {
    const emptyLoadBalancerSubagent: SubagentConfig = {
      name: 'empty-lb-helper',
      profile: 'empty-lb',
      systemPrompt: 'Do not launch.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const emptyLoadBalancerProfile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: [],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };

    const loadSubagent = vi.fn().mockResolvedValue(emptyLoadBalancerSubagent);
    const loadProfile = vi.fn().mockResolvedValue(emptyLoadBalancerProfile);
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());
    const scopeFactory = vi.fn<typeof SubAgentScope.create>();

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    await expect(
      orchestrator.launch({ name: emptyLoadBalancerSubagent.name }),
    ).rejects.toThrow(/must reference at least one profile/);
    expect(runtimeLoader).not.toHaveBeenCalled();
    expect(scopeFactory).not.toHaveBeenCalled();
  });

  it('rejects nested load balancer profiles for subagent runtime resolution', async () => {
    const nestedLoadBalancerSubagent: SubagentConfig = {
      name: 'nested-lb-helper',
      profile: 'outer-lb',
      systemPrompt: 'Do not launch.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const outerLoadBalancerProfile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['inner-lb'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };
    const innerLoadBalancerProfile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['anthropic-fast'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };

    const loadSubagent = vi.fn().mockResolvedValue(nestedLoadBalancerSubagent);
    const loadProfile = vi.fn(async (profileName: string) => {
      if (profileName === 'outer-lb') {
        return outerLoadBalancerProfile;
      }
      if (profileName === 'inner-lb') {
        return innerLoadBalancerProfile;
      }
      throw new Error(`unexpected profile ${profileName}`);
    });
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());
    const scopeFactory = vi.fn<typeof SubAgentScope.create>();

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    await expect(
      orchestrator.launch({ name: nestedLoadBalancerSubagent.name }),
    ).rejects.toThrow(/cannot use nested load balancer profile 'inner-lb'/);
    expect(runtimeLoader).not.toHaveBeenCalled();
    expect(scopeFactory).not.toHaveBeenCalled();
  });
});
