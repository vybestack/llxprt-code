/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '../config/profileManager.js';
import type { SubagentConfig } from '../config/types.js';
import type { Profile } from '../types/modelParams.js';
import type { Config } from '../config/config.js';
import {
  SubAgentScope,
  type RunConfig,
  type SubAgentScope as SubAgentScopeInstance,
} from './subagent.js';
import { SubagentOrchestrator } from './subagentOrchestrator.js';

const makeForegroundConfig = (): Config =>
  ({
    getSessionId: () => 'primary-session',
    getProvider: () => 'gemini',
    getContentGeneratorConfig: () => undefined,
    getModel: () => 'gemini-1.5-flash',
    getToolRegistry: () => undefined,
  }) as unknown as Config;

const createRuntimeBundle = (label = 'bundle') => {
  const clearHistory = vi.fn();
  const history = { clear: clearHistory } as unknown as {
    clear: () => void;
  };
  const runtimeContext = {
    state: { runtimeId: `${label}-runtime-id`, sessionId: `${label}-session` },
    history,
    ephemerals: {
      compressionThreshold: () => 0.5,
      contextLimit: () => 20_000,
      preserveThreshold: () => 0.3,
      toolFormatOverride: () => undefined,
    },
    telemetry: {},
    provider: {},
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    providerRuntime: {},
  } as unknown as SubAgentScopeInstance['runtimeContext'];

  return {
    runtimeContext,
    history,
    providerAdapter: {},
    telemetryAdapter: {},
    toolsView: {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    },
    contentGenerator: {},
  };
};

describe('SubagentOrchestrator - Config Resolution', () => {
  const baseProfile: Profile = {
    version: 1,
    provider: 'gemini',
    model: 'gemini-2.0-pro',
    modelParams: {
      temperature: 0.42,
      top_p: 0.9,
    },
    ephemeralSettings: {},
  };

  const defaultRunConfig: RunConfig = {
    max_time_minutes: 3,
    max_turns: 5,
  };

  const foregroundConfig = makeForegroundConfig();

  const createScopeFactory = () => {
    const fakeScope = {
      runtimeContext: {
        state: { runtimeId: 'runtime#1' },
        history: { clear: vi.fn() },
      },
      getAgentId: () => 'agent-helper-123',
    } as unknown as SubAgentScopeInstance;

    const factory = vi.fn<typeof SubAgentScope.create>(async () => fakeScope);
    return { factory, fakeScope };
  };

  it('throws an enhanced error message suggesting list_subagents tool when subagent not found', async () => {
    const subagentName = 'nonexistent-helper';
    const loadSubagent = vi
      .fn()
      .mockRejectedValue(new Error("Subagent 'nonexistent-helper' not found."));
    const subagentManager = {
      loadSubagent,
    } as unknown as SubagentManager;
    const profileManager = {
      loadProfile: vi.fn(),
    } as unknown as ProfileManager;
    const { factory } = createScopeFactory();
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
    });

    await expect(
      orchestrator.launch({
        name: subagentName,
        runConfig: defaultRunConfig,
      }),
    ).rejects.toThrow(
      /Unable to load subagent 'nonexistent-helper': Subagent not found. Use the list_subagents tool to discover available subagents before calling the task tool./,
    );
    expect(loadSubagent).toHaveBeenCalledWith(subagentName);
    expect(factory).not.toHaveBeenCalled();
  });

  it('throws a descriptive error when the subagent config is missing', async () => {
    const subagentName = 'unknown-helper';
    const loadSubagent = vi
      .fn()
      .mockRejectedValue(new Error("Subagent 'unknown-helper' not found."));
    const subagentManager = {
      loadSubagent,
    } as unknown as SubagentManager;
    const profileManager = {
      loadProfile: vi.fn(),
    } as unknown as ProfileManager;
    const { factory } = createScopeFactory();
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
    });

    await expect(
      orchestrator.launch({
        name: subagentName,
        runConfig: defaultRunConfig,
      }),
    ).rejects.toThrow(/unknown-helper/i);
    expect(loadSubagent).toHaveBeenCalledWith(subagentName);
    expect(factory).not.toHaveBeenCalled();
  });

  it('loads profile referenced by subagent config and merges behavioural prompt segments', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'docs-helper',
      profile: 'docs-profile',
      systemPrompt: 'You are a concise documentation assistant.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const subagentManager = {
      loadSubagent,
    } as unknown as SubagentManager;

    const loadProfile = vi.fn().mockResolvedValue(baseProfile);
    const profileManager = {
      loadProfile,
    } as unknown as ProfileManager;

    const { factory, fakeScope } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('config');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
    });

    const extraPrompt = 'Prioritize API surface summaries before examples.';
    const runResult = await orchestrator.launch({
      name: subagentConfig.name,
      runConfig: defaultRunConfig,
      behaviourPrompts: [extraPrompt],
    });

    expect(loadSubagent).toHaveBeenCalledWith(subagentConfig.name);
    expect(loadProfile).toHaveBeenCalledWith(subagentConfig.profile);
    expect(factory).toHaveBeenCalledTimes(1);

    const factoryCall = factory.mock.calls[0];
    const [, passedConfig, promptConfig, modelConfig, runConfigArg] =
      factoryCall;

    expect(passedConfig).toBe(foregroundConfig);
    expect(promptConfig.systemPrompt).toContain(subagentConfig.systemPrompt);
    expect(promptConfig.systemPrompt).toContain(extraPrompt);

    expect(modelConfig.model).toBe(baseProfile.model);
    expect(modelConfig.temp).toBe(baseProfile.modelParams.temperature);
    expect(modelConfig.top_p).toBe(baseProfile.modelParams.top_p);
    expect(runConfigArg).toEqual(defaultRunConfig);

    expect(runResult.scope).toBe(fakeScope);
  });

  it('derives max_turns from profile maxTurnsPerPrompt when not provided explicitly', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'planner-helper',
      profile: 'planner-profile',
      systemPrompt: 'Explain plans thoroughly.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const profileWithTurns: Profile = {
      ...baseProfile,
      ephemeralSettings: {
        ...baseProfile.ephemeralSettings,
        maxTurnsPerPrompt: 1_000,
      },
    };

    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const subagentManager = {
      loadSubagent,
    } as unknown as SubagentManager;

    const loadProfile = vi.fn().mockResolvedValue(profileWithTurns);
    const profileManager = {
      loadProfile,
    } as unknown as ProfileManager;

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('profile-turns');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_time_minutes).toBe(Number.POSITIVE_INFINITY);
    expect(runConfigArg.max_turns).toBe(1_000);
  });

  it('omits max_turns when profile requests unlimited turns', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'unbounded-helper',
      profile: 'unbounded-profile',
      systemPrompt: 'Work without turn limits.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const profileUnlimited: Profile = {
      ...baseProfile,
      ephemeralSettings: {
        ...baseProfile.ephemeralSettings,
        maxTurnsPerPrompt: -1,
      },
    };

    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const subagentManager = {
      loadSubagent,
    } as unknown as SubagentManager;
    const loadProfile = vi.fn().mockResolvedValue(profileUnlimited);
    const profileManager = {
      loadProfile,
    } as unknown as ProfileManager;

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('profile-unbounded');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_time_minutes).toBe(Number.POSITIVE_INFINITY);
    expect(runConfigArg.max_turns).toBeUndefined();
  });

  it('defaults to unlimited runtime when neither profile nor request specify limits', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'default-helper',
      profile: 'default-profile',
      systemPrompt: 'Assist without additional limits.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const subagentManager = {
      loadSubagent,
    } as unknown as SubagentManager;

    const loadProfile = vi.fn().mockResolvedValue(baseProfile);
    const profileManager = {
      loadProfile,
    } as unknown as ProfileManager;

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('default-runtime');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_time_minutes).toBe(Number.POSITIVE_INFINITY);
    expect(runConfigArg.max_turns).toBeUndefined();
  });
});

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
    expect(loaderArgs.profile.settings.tools?.allowed).toEqual(
      profile.ephemeralSettings['tools.allowed'],
    );

    expect(scopeFactory).toHaveBeenCalledTimes(1);
    const overrides = scopeFactory.mock.calls[0][7];
    expect(overrides?.runtimeBundle).toBe(runtimeBundle);

    expect(result.scope).toBe(scope);
    expect(result.agentId).toBe('planner-1');
    expect(result.dispose).toBeTypeOf('function');
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

    await firstRun.dispose?.();
    await secondRun.dispose?.();

    expect(firstBundle.history.clear).toHaveBeenCalled();
    expect(secondBundle.history.clear).toHaveBeenCalled();
  });
});
