/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral regression tests for Issue #2410 — Bug #1.
 *
 * A subagent whose profile is a load balancer (`type: 'loadbalancer'`) carries
 * an empty `provider`/`model` on the load-balancer profile itself; the concrete
 * provider/model live on the referenced member profiles. These tests drive the
 * REAL orchestrator resolution + runtime-state construction (only the runtime
 * loader and scope factory are stubbed) to prove that:
 *
 *   (a) launching a real load-balancer profile no longer throws
 *       `RuntimeStateError: provider.missing`, and the resulting runtime state
 *       carries the real `load-balancer` provider/model; and
 *   (b) the load-balancer profile is still preserved as the launch result's
 *       profile so failover/round-robin routing downstream is not lost.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { SubAgentScope } from '../subagent.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import {
  makeForegroundConfig,
  createRuntimeBundle,
} from './subagentOrchestrator-test-helpers.js';

describe('SubagentOrchestrator - Load Balancer Profiles (Issue #2410)', () => {
  const loadBalancerSubagent: SubagentConfig = {
    name: 'lb-helper',
    profile: 'glm',
    systemPrompt: 'Reply concisely.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // A production-shaped load-balancer profile: provider/model are EMPTY on the
  // load-balancer profile itself (the concrete values live on the members).
  const loadBalancerProfile: Profile = {
    version: 1,
    type: 'loadbalancer',
    policy: 'failover',
    profiles: ['zai', 'makoraglm51', 'ollamaglm51'],
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: {},
  };

  const zaiProfile: Profile = {
    version: 1,
    provider: 'anthropic',
    model: 'glm-5.2',
    modelParams: {
      temperature: 0.4,
      top_p: 0.9,
    },
    ephemeralSettings: {
      'auth-key': 'zai-key',
    },
  };

  const makoraProfile: Profile = {
    version: 1,
    provider: 'openai',
    model: 'glm-5.1',
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'makora-key',
    },
  };

  const ollamaProfile: Profile = {
    version: 1,
    provider: 'openai',
    model: 'glm-5.1-ollama',
    modelParams: {},
    ephemeralSettings: {
      'base-url': 'http://localhost:11434/v1',
    },
  };

  function makeLoadProfile() {
    return vi.fn(async (profileName: string) => {
      switch (profileName) {
        case 'glm':
          return loadBalancerProfile;
        case 'zai':
          return zaiProfile;
        case 'makoraglm51':
          return makoraProfile;
        case 'ollamaglm51':
          return ollamaProfile;
        default:
          throw new Error(`unexpected profile ${profileName}`);
      }
    });
  }

  function createValidationOrchestrator(
    subagent: SubagentConfig,
    loadProfile: (profileName: string) => Promise<Profile>,
  ) {
    const loadSubagent = vi.fn().mockResolvedValue(subagent);
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());
    const scopeFactory = vi.fn<typeof SubAgentScope.create>();
    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory,
      runtimeLoader,
    });
    return { orchestrator, runtimeLoader };
  }

  it('launches without provider.missing and binds runtime state to the load-balancer provider', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(loadBalancerSubagent);
    const loadProfile = makeLoadProfile();

    const runtimeBundle = createRuntimeBundle('load-balancer');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'lb-helper-1',
    } as unknown as SubAgentScope;
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockResolvedValue(scope);

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory,
      runtimeLoader,
    });

    // Before the fix this rejected with RuntimeStateError: provider.missing.
    const result = await orchestrator.launch({
      name: loadBalancerSubagent.name,
    });

    expect(runtimeLoader).toHaveBeenCalledTimes(1);
    const loaderArgs = runtimeLoader.mock.calls[0][0];
    expect(loaderArgs.profile.state.provider).toBe('load-balancer');
    expect(loaderArgs.profile.state.model).toBe('load-balancer');
    expect(loaderArgs.profile.contentGeneratorConfig?.model).toBe(
      'load-balancer',
    );
    expect(loaderArgs.profile.contentGeneratorConfig?.apiKey).toBeUndefined();
    expect(result.agentId).toBe('lb-helper-1');
  });

  it('preserves the load-balancer profile as the launch result profile (failover intact)', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(loadBalancerSubagent);
    const loadProfile = makeLoadProfile();

    const runtimeBundle = createRuntimeBundle('load-balancer');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'lb-helper-2',
    } as unknown as SubAgentScope;
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockResolvedValue(scope);

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory,
      runtimeLoader,
    });

    const result = await orchestrator.launch({
      name: loadBalancerSubagent.name,
    });

    // The load-balancer profile is preserved so its failover routing survives.
    expect(result.profile).toBe(loadBalancerProfile);
    // Every referenced member is loaded and validated.
    expect(loadProfile).toHaveBeenCalledWith('glm');
    expect(loadProfile).toHaveBeenCalledWith('zai');
    expect(loadProfile).toHaveBeenCalledWith('makoraglm51');
    expect(loadProfile).toHaveBeenCalledWith('ollamaglm51');
  });

  it('still rejects a load-balancer profile that references no member profiles', async () => {
    const emptySubagent: SubagentConfig = {
      ...loadBalancerSubagent,
      name: 'empty-lb',
      profile: 'empty-lb',
    };
    const emptyProfile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: [],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };
    const loadSubagent = vi.fn().mockResolvedValue(emptySubagent);
    const loadProfile = vi.fn().mockResolvedValue(emptyProfile);
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());
    const scopeFactory = vi.fn<typeof SubAgentScope.create>();

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory,
      runtimeLoader,
    });

    await expect(
      orchestrator.launch({ name: emptySubagent.name }),
    ).rejects.toThrow(/must reference at least one profile/);
    expect(runtimeLoader).not.toHaveBeenCalled();
  });

  it('still rejects a load-balancer profile that references a nested load balancer', async () => {
    const nestedSubagent: SubagentConfig = {
      ...loadBalancerSubagent,
      name: 'nested-lb',
      profile: 'outer-lb',
    };
    const outerProfile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['inner-lb'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };
    const innerProfile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['zai'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };
    const loadProfile = vi.fn(async (profileName: string) => {
      if (profileName === 'outer-lb') {
        return outerProfile;
      }
      if (profileName === 'inner-lb') {
        return innerProfile;
      }
      throw new Error(`unexpected profile ${profileName}`);
    });
    const { orchestrator, runtimeLoader } = createValidationOrchestrator(
      nestedSubagent,
      loadProfile,
    );

    await expect(
      orchestrator.launch({ name: nestedSubagent.name }),
    ).rejects.toThrow(/cannot use nested load balancer profile 'inner-lb'/);
    expect(runtimeLoader).not.toHaveBeenCalled();
  });

  it('rejects a load-balancer member with an empty provider', async () => {
    const invalidSubagent: SubagentConfig = {
      ...loadBalancerSubagent,
      name: 'invalid-provider-lb',
      profile: 'invalid-provider-lb',
    };
    const invalidProfile: Profile = {
      ...loadBalancerProfile,
      profiles: ['zai-fast', 'empty-provider'],
    };
    const emptyProviderProfile: Profile = {
      ...zaiProfile,
      provider: '   ',
    };
    const loadProfile = vi.fn(async (profileName: string) => {
      if (profileName === 'invalid-provider-lb') {
        return invalidProfile;
      }
      if (profileName === 'zai-fast') {
        return zaiProfile;
      }
      if (profileName === 'empty-provider') {
        return emptyProviderProfile;
      }
      throw new Error(`unexpected profile ${profileName}`);
    });
    const { orchestrator, runtimeLoader } = createValidationOrchestrator(
      invalidSubagent,
      loadProfile,
    );

    await expect(
      orchestrator.launch({ name: invalidSubagent.name }),
    ).rejects.toThrow(/must define a non-empty provider/);
    expect(runtimeLoader).not.toHaveBeenCalled();
  });

  it('rejects a load-balancer member with an empty model', async () => {
    const invalidSubagent: SubagentConfig = {
      ...loadBalancerSubagent,
      name: 'invalid-model-lb',
      profile: 'invalid-model-lb',
    };
    const invalidProfile: Profile = {
      ...loadBalancerProfile,
      profiles: ['zai-fast', 'empty-model'],
    };
    const emptyModelProfile: Profile = {
      ...zaiProfile,
      model: '',
    };
    const loadProfile = vi.fn(async (profileName: string) => {
      if (profileName === 'invalid-model-lb') {
        return invalidProfile;
      }
      if (profileName === 'zai-fast') {
        return zaiProfile;
      }
      if (profileName === 'empty-model') {
        return emptyModelProfile;
      }
      throw new Error(`unexpected profile ${profileName}`);
    });
    const { orchestrator, runtimeLoader } = createValidationOrchestrator(
      invalidSubagent,
      loadProfile,
    );

    await expect(
      orchestrator.launch({ name: invalidSubagent.name }),
    ).rejects.toThrow(/must define a non-empty model/);
    expect(runtimeLoader).not.toHaveBeenCalled();
  });
});
