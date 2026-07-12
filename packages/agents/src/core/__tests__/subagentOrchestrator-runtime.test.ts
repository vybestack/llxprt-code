/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime assembly tests extracted from the original monolithic
 * subagentOrchestrator.test.ts so no file-level max-lines disable is needed.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubAgentScope } from '../subagent.js';
import { type SubAgentScope as SubAgentScopeInstance } from '../subagent.js';
import type { RunConfig } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import * as runtimeModule from '@vybestack/llxprt-code-providers/runtime.js';
import * as activationExecutor from '../../api/providerActivationExecutor.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import {
  makeForegroundConfig,
  createRuntimeBundle,
} from './subagentOrchestrator-test-helpers.js';

describe('SubagentOrchestrator - Runtime Assembly', () => {
  const subagentConfig: SubagentConfig = {
    name: 'planner',
    profile: 'planner-profile',
    systemPrompt: 'You are a structured planner.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const profile: Profile = {
    version: 1,
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    modelParams: {
      temperature: 0.3,
      top_p: 0.95,
    },
    ephemeralSettings: {
      'auth-key': 'test-api-key',
      'tools.allowed': ['read_file'],
      'tools.disabled': ['write_file'],
    },
  };

  const runConfig: RunConfig = {
    max_time_minutes: 8,
    max_turns: 12,
  };

  it('calls runtime loader with profile snapshot and threads the bundle into SubAgentScope', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);

    const runtimeBundle = createRuntimeBundle('plan');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'planner-1',
    } as unknown as SubAgentScopeInstance;
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
      name: subagentConfig.name,
      runConfig,
    });

    expect(runtimeLoader).toHaveBeenCalledTimes(1);
    const loaderArgs = runtimeLoader.mock.calls[0][0];
    expect(loaderArgs.profile.state.model).toBe(profile.model);
    expect(loaderArgs.profile.state.provider).toBe(profile.provider);
    expect(loaderArgs.profile.settings.tools?.allowed).toStrictEqual(
      profile.ephemeralSettings['tools.allowed'],
    );

    expect(scopeFactory).toHaveBeenCalledTimes(1);
    const overrides = scopeFactory.mock.calls[0][7];
    expect(overrides?.runtimeBundle).toBe(runtimeBundle);

    expect(result.scope).toBe(scope);
    expect(result.agentId).toBe('planner-1');
    expect(result.dispose).toBeTypeOf('function');
  });

  it('uses an isolated providerManager for provider-backed subagent runtimes (Issue #2410)', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);

    const parentProviderManager = { getActiveProvider: vi.fn() };
    const config = {
      ...makeForegroundConfig(),
      getProviderManager: () => parentProviderManager,
    } as unknown as Config;

    const runtimeBundle = createRuntimeBundle('provider-backed');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'planner-provider-backed',
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
    });

    await orchestrator.launch({
      name: subagentConfig.name,
      runConfig,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    // The subagent gets its OWN isolated providerManager, not the parent's
    expect(loaderArgs.profile.providerManager).not.toBe(parentProviderManager);
    expect(loaderArgs.profile.providerManager).toBeDefined();
    expect(loaderArgs.profile.contentGeneratorConfig.providerManager).toBe(
      loaderArgs.profile.providerManager,
    );
    expect(
      loaderArgs.profile.contentGeneratorConfig.contentGeneratorFactory,
    ).toBeUndefined();
  });

  it('cleans up the isolated runtime when launch fails after runtime assembly', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const activate = vi.fn().mockResolvedValue(undefined);
    const createIsolatedRuntimeContextSpy = vi
      .spyOn(runtimeModule, 'createIsolatedRuntimeContext')
      .mockReturnValue({
        runtimeId: 'isolated-runtime',
        metadata: { source: 'test' },
        settingsService: undefined,
        config: makeForegroundConfig(),
        providerManager: {},
        oauthManager: {},
        activate,
        cleanup,
      } as unknown as ReturnType<
        typeof runtimeModule.createIsolatedRuntimeContext
      >);
    const executeProviderActivationSpy = vi
      .spyOn(activationExecutor, 'executeProviderActivation')
      .mockResolvedValue({ authFailed: false, infoMessages: [] });

    const runtimeBundle = createRuntimeBundle('post-bundle-failure');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockRejectedValue(new Error('scope creation failed'));

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory,
      runtimeLoader,
    });

    try {
      await expect(
        orchestrator.launch({
          name: subagentConfig.name,
          runConfig,
        }),
      ).rejects.toThrow('scope creation failed');

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(activate).toHaveBeenCalledTimes(1);
      expect(executeProviderActivationSpy).toHaveBeenCalledTimes(1);
    } finally {
      createIsolatedRuntimeContextSpy.mockRestore();
      executeProviderActivationSpy.mockRestore();
    }
  });

  it('does not seed default disabled tools when profile omits disabled tools', async () => {
    const profileWithoutDisabled: Profile = {
      ...profile,
      ephemeralSettings: {
        'auth-key': 'test-api-key',
        'tools.allowed': ['read_file'],
      },
    };

    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profileWithoutDisabled);

    const runtimeBundle = createRuntimeBundle('plan');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'planner-2',
    } as unknown as SubAgentScopeInstance;
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

    await orchestrator.launch({
      name: subagentConfig.name,
      runConfig,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    // With default-disabled tools removed, no defaults are seeded.
    expect(loaderArgs.profile.settings.tools?.disabled).toBeUndefined();
  });

  it('preserves profile disabled tools even when they are present in tools.allowed', async () => {
    const profileWithAllowedDisabledOverlap: Profile = {
      ...profile,
      ephemeralSettings: {
        'auth-key': 'test-api-key',
        'tools.allowed': ['read_file', 'write_file', 'glob'],
        'tools.disabled': ['write_file'],
      },
    };

    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi
      .fn()
      .mockResolvedValue(profileWithAllowedDisabledOverlap);

    const runtimeBundle = createRuntimeBundle('plan-overlap');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'planner-overlap',
    } as unknown as SubAgentScopeInstance;
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

    await orchestrator.launch({
      name: subagentConfig.name,
      runConfig,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    expect(loaderArgs.profile.settings.tools?.disabled).toStrictEqual([
      'write_file',
    ]);
  });

  it('copies base-url into provider settings for subagent runtimes (Issue #2410)', async () => {
    const qwenBaseUrl = 'https://portal.qwen.ai/v1';
    const qwenProfile: Profile = {
      version: 1,
      provider: 'qwen',
      model: 'qwen3-coder-plus',
      modelParams: {},
      ephemeralSettings: {
        'base-url': qwenBaseUrl,
      },
    };

    const qwenSubagent: SubagentConfig = {
      name: 'qwencoder',
      profile: 'qwen',
      systemPrompt: 'Qwen coder',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const loadSubagent = vi.fn().mockResolvedValue(qwenSubagent);
    const loadProfile = vi.fn().mockResolvedValue(qwenProfile);

    const runtimeBundle = createRuntimeBundle('qwen');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'qwencoder-1',
    } as unknown as SubAgentScopeInstance;
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

    await orchestrator.launch({
      name: qwenSubagent.name,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    const settingsService = loaderArgs.profile.providerRuntime.settingsService;

    expect(loaderArgs.profile.state.baseUrl).toBe(qwenBaseUrl);
    expect(settingsService.getProviderSettings('qwen')['base-url']).toBe(
      qwenBaseUrl,
    );
  });

  it('keeps GCP profile ephemerals scoped to the subagent settings service', async () => {
    const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
    const originalLocation = process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;

    try {
      const vertexProfile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        modelParams: {},
        ephemeralSettings: {
          GOOGLE_CLOUD_PROJECT: 'subagent-project',
          GOOGLE_CLOUD_LOCATION: 'us-central1',
        },
      };
      const vertexSubagent: SubagentConfig = {
        name: 'vertex-helper',
        profile: 'vertex-profile',
        systemPrompt: 'Use Vertex AI.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const loadSubagent = vi.fn().mockResolvedValue(vertexSubagent);
      const loadProfile = vi.fn().mockResolvedValue(vertexProfile);
      const runtimeBundle = createRuntimeBundle('vertex');
      const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
      const scope = {
        runtimeContext: runtimeBundle.runtimeContext,
        getAgentId: () => 'vertex-helper-1',
      } as unknown as SubAgentScopeInstance;
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

      await orchestrator.launch({ name: vertexSubagent.name });

      const settingsService =
        runtimeLoader.mock.calls[0][0].profile.providerRuntime.settingsService;
      // This mocked runtime-loader boundary verifies settings population itself:
      // GCP ephemerals are scoped to SettingsService and never written globally.
      expect(settingsService.get('GOOGLE_CLOUD_PROJECT')).toBe(
        'subagent-project',
      );
      expect(settingsService.get('GOOGLE_CLOUD_LOCATION')).toBe('us-central1');
      expect(process.env.GOOGLE_CLOUD_PROJECT).toBeUndefined();
      expect(process.env.GOOGLE_CLOUD_LOCATION).toBeUndefined();
    } finally {
      if (originalProject === undefined) {
        delete process.env.GOOGLE_CLOUD_PROJECT;
      } else {
        process.env.GOOGLE_CLOUD_PROJECT = originalProject;
      }
      if (originalLocation === undefined) {
        delete process.env.GOOGLE_CLOUD_LOCATION;
      } else {
        process.env.GOOGLE_CLOUD_LOCATION = originalLocation;
      }
    }
  });

  it('injects base-url into runtime state for provider normalization', async () => {
    const qwenBaseUrl = 'https://portal.qwen.ai/v1';
    const qwenProfile: Profile = {
      version: 1,
      provider: 'qwen',
      model: 'qwen3-coder-plus',
      modelParams: {},
      ephemeralSettings: {
        'base-url': qwenBaseUrl,
      },
    };

    const qwenSubagent: SubagentConfig = {
      name: 'qwencoder',
      profile: 'qwen',
      systemPrompt: 'Qwen coder',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const loadSubagent = vi.fn().mockResolvedValue(qwenSubagent);
    const loadProfile = vi.fn().mockResolvedValue(qwenProfile);

    const runtimeBundle = createRuntimeBundle('qwen');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'qwencoder-1',
    } as unknown as SubAgentScopeInstance;
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

    await orchestrator.launch({
      name: qwenSubagent.name,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    expect(loaderArgs.profile.state.baseUrl).toBe(qwenBaseUrl);
  });

  it('forwards user-agent ephemeral setting to subagent SettingsService (Issue #2410)', async () => {
    const kimiProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'kimi-for-coding',
      modelParams: {},
      ephemeralSettings: {
        'user-agent': 'RooCode/1.0',
      },
    };

    const kimiSubagent: SubagentConfig = {
      name: 'kimicoder',
      profile: 'kimi',
      systemPrompt: 'Kimi coder',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const loadSubagent = vi.fn().mockResolvedValue(kimiSubagent);
    const loadProfile = vi.fn().mockResolvedValue(kimiProfile);

    const runtimeBundle = createRuntimeBundle('kimi');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'kimicoder-1',
    } as unknown as SubAgentScopeInstance;
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

    await orchestrator.launch({
      name: kimiSubagent.name,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    const settingsService = loaderArgs.profile.providerRuntime.settingsService;

    expect(settingsService.get('user-agent')).toBe('RooCode/1.0');
  });

  it('preserves subagent profile identity and auth-key-name in runtime settings', async () => {
    const keyNameProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'minimax-m1',
      modelParams: {},
      ephemeralSettings: {
        'auth-key-name': 'chutesminimax',
      },
    };

    const keyNameSubagent: SubagentConfig = {
      name: 'codeanalyzer',
      profile: 'chutesminimax',
      systemPrompt: 'Analyze code precisely.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const loadSubagent = vi.fn().mockResolvedValue(keyNameSubagent);
    const loadProfile = vi.fn().mockResolvedValue(keyNameProfile);

    const runtimeBundle = createRuntimeBundle('key-name');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'codeanalyzer-1',
    } as unknown as SubAgentScopeInstance;
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

    await orchestrator.launch({
      name: keyNameSubagent.name,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    const settingsService = loaderArgs.profile.providerRuntime.settingsService;

    expect(settingsService.getCurrentProfileName()).toBe(
      keyNameSubagent.profile,
    );

    expect(settingsService.get('auth-key-name')).toBe('chutesminimax');
    expect(settingsService.getProviderSettings('openai')['auth-key-name']).toBe(
      'chutesminimax',
    );
  });

  it('provides a dispose hook that clears runtime history and returns unique agent ids per launch', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);

    const firstBundle = createRuntimeBundle('first');
    const secondBundle = createRuntimeBundle('second');

    const runtimeLoader = vi
      .fn()
      .mockResolvedValueOnce(firstBundle)
      .mockResolvedValueOnce(secondBundle);

    let sequence = 0;
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockImplementation(async () => {
        sequence += 1;
        return {
          runtimeContext:
            sequence === 1
              ? firstBundle.runtimeContext
              : secondBundle.runtimeContext,
          getAgentId: () => `planner-${sequence}`,
        } as unknown as SubAgentScopeInstance;
      });

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory,
      runtimeLoader,
    });

    const firstRun = await orchestrator.launch({
      name: subagentConfig.name,
      runConfig,
    });
    const secondRun = await orchestrator.launch({
      name: subagentConfig.name,
      runConfig,
    });

    expect(firstRun.agentId).toBe('planner-1');
    expect(secondRun.agentId).toBe('planner-2');
    expect(firstRun.agentId).not.toBe(secondRun.agentId);

    await firstRun.dispose();
    await secondRun.dispose();

    expect(firstBundle.history.clear).toHaveBeenCalled();
    expect(secondBundle.history.clear).toHaveBeenCalled();
  });

  it('prefers history.dispose over clear during teardown', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);

    const bundle = createRuntimeBundle('dispose');
    const disposeSpy = vi.fn();
    const clearSpy = vi.fn();

    bundle.history = { dispose: disposeSpy, clear: clearSpy } as unknown as {
      dispose: () => void;
      clear: () => void;
    };
    bundle.runtimeContext.history = bundle.history;

    const runtimeLoader = vi.fn().mockResolvedValue(bundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: makeForegroundConfig(),
      scopeFactory: vi.fn<typeof SubAgentScope.create>().mockResolvedValue({
        runtimeContext: bundle.runtimeContext,
        getAgentId: () => 'planner-dispose',
      } as unknown as SubAgentScopeInstance),
      runtimeLoader,
    });

    const run = await orchestrator.launch({
      name: subagentConfig.name,
      runConfig,
    });

    await run.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).not.toHaveBeenCalled();
  });

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
    });

    await expect(
      orchestrator.launch({ name: nestedLoadBalancerSubagent.name }),
    ).rejects.toThrow(/cannot use nested load balancer profile 'inner-lb'/);
    expect(runtimeLoader).not.toHaveBeenCalled();
    expect(scopeFactory).not.toHaveBeenCalled();
  });
});
