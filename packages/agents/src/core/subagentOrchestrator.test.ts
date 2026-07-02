/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubAgentScope } from './subagent.js';
import { type SubAgentScope as SubAgentScopeInstance } from './subagent.js';
import type { RunConfig } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubagentOrchestrator } from './subagentOrchestrator.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  makeForegroundConfig,
  createRuntimeBundle,
} from './__tests__/subagentOrchestrator-test-helpers.js';

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
const messageBusSubagentConfig: SubagentConfig = {
  name: 'messagebus-helper',
  profile: 'default-profile',
  systemPrompt: 'Assist.',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function buildMessageBusManagers() {
  const loadSubagent = vi.fn().mockResolvedValue(messageBusSubagentConfig);
  const subagentManager = {
    loadSubagent,
  } as unknown as SubagentManager;
  const loadProfile = vi.fn().mockResolvedValue(baseProfile);
  const profileManager = {
    loadProfile,
  } as unknown as ProfileManager;
  return { subagentManager, profileManager };
}

describe('SubagentOrchestrator - Config Resolution', () => {
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
    expect(runConfigArg).toStrictEqual(defaultRunConfig);

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

  it('defaults max_turns to 200 when neither profile nor request specify limits', async () => {
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
    expect(runConfigArg.max_turns).toBe(200);
  });

  it('defaults max_turns to the foreground config current maxTurnsPerPrompt when neither profile nor request specify limits', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'parent-default-helper',
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

    const configWithParentTurns = {
      ...foregroundConfig,
      getEphemeralSetting: (key: string) => {
        if (key === 'maxTurnsPerPrompt') {
          return 75;
        }
        return undefined;
      },
    } as unknown as Config;

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('parent-turns');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig: configWithParentTurns,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_time_minutes).toBe(Number.POSITIVE_INFINITY);
    expect(runConfigArg.max_turns).toBe(75);
  });

  it('reads the foreground config maxTurnsPerPrompt dynamically at launch time through a single orchestrator instance', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'dynamic-parent-helper',
      profile: 'default-profile',
      systemPrompt: 'Assist.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let parentMaxTurns = 50;
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const subagentManager = {
      loadSubagent,
    } as unknown as SubagentManager;

    const loadProfile = vi.fn().mockResolvedValue(baseProfile);
    const profileManager = {
      loadProfile,
    } as unknown as ProfileManager;

    const configWithDynamicTurns = {
      ...foregroundConfig,
      getEphemeralSetting: (key: string) => {
        if (key === 'maxTurnsPerPrompt') {
          return parentMaxTurns;
        }
        return undefined;
      },
    } as unknown as Config;

    const { factory } = createScopeFactory();
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig: configWithDynamicTurns,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: subagentConfig.name });

    parentMaxTurns = 250;

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , firstRunConfig] = factory.mock.calls[0];
    expect(firstRunConfig.max_turns).toBe(50);

    const [, , , , secondRunConfig] = factory.mock.calls[1];
    expect(secondRunConfig.max_turns).toBe(250);
  });

  it('falls back to 200 when foreground config has no current maxTurnsPerPrompt', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'no-parent-helper',
      profile: 'default-profile',
      systemPrompt: 'Assist.',
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
    const runtimeBundle = createRuntimeBundle('no-parent-turns');
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
    expect(runConfigArg.max_turns).toBe(200);
  });

  it('respects explicit request max_turns over foreground config maxTurnsPerPrompt', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'explicit-over-parent-helper',
      profile: 'default-profile',
      systemPrompt: 'Assist.',
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

    const configWithParentTurns = {
      ...foregroundConfig,
      getEphemeralSetting: (key: string) => {
        if (key === 'maxTurnsPerPrompt') {
          return 75;
        }
        return undefined;
      },
    } as unknown as Config;

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('explicit-over-parent');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig: configWithParentTurns,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({
      name: subagentConfig.name,
      runConfig: { max_turns: 10 },
    });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_turns).toBe(10);
  });

  it('respects profile maxTurnsPerPrompt over foreground config maxTurnsPerPrompt', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'profile-over-parent-helper',
      profile: 'profile-with-turns',
      systemPrompt: 'Assist.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const profileWithTurns: Profile = {
      ...baseProfile,
      ephemeralSettings: {
        ...baseProfile.ephemeralSettings,
        maxTurnsPerPrompt: 500,
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

    const configWithParentTurns = {
      ...foregroundConfig,
      getEphemeralSetting: (key: string) => {
        if (key === 'maxTurnsPerPrompt') {
          return 75;
        }
        return undefined;
      },
    } as unknown as Config;

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('profile-over-parent');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig: configWithParentTurns,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_turns).toBe(500);
  });

  it('omits max_turns when foreground config maxTurnsPerPrompt is unlimited (-1)', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'unlimited-parent-helper',
      profile: 'default-profile',
      systemPrompt: 'Assist.',
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

    const configWithUnlimitedParentTurns = {
      ...foregroundConfig,
      getEphemeralSetting: (key: string) => {
        if (key === 'maxTurnsPerPrompt') {
          return -1;
        }
        return undefined;
      },
    } as unknown as Config;

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('unlimited-parent-turns');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig: configWithUnlimitedParentTurns,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_turns).toBeUndefined();
  });

  it('falls back to 200 when foreground config maxTurnsPerPrompt is zero', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'zero-parent-helper',
      profile: 'default-profile',
      systemPrompt: 'Assist.',
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

    const configWithZeroParentTurns = {
      ...foregroundConfig,
      getEphemeralSetting: (key: string) => {
        if (key === 'maxTurnsPerPrompt') {
          return 0;
        }
        return undefined;
      },
    } as unknown as Config;

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('zero-parent-turns');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig: configWithZeroParentTurns,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_turns).toBe(200);
  });

  it('honors an already-aborted signal before beginning launch work', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'cancel-helper',
      profile: 'cancel-profile',
      systemPrompt: 'Do nothing',
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
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      orchestrator.launch(
        { name: subagentConfig.name, runConfig: defaultRunConfig },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(loadSubagent).not.toHaveBeenCalled();
    expect(runtimeLoader).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('SubagentOrchestrator - MessageBus threading (Issue #2312)', () => {
  it('threads the orchestrator messageBus into the scope factory overrides', async () => {
    const { subagentManager, profileManager } = buildMessageBusManagers();
    const { factory } = createScopeFactory();
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());
    const sessionMessageBus = new MessageBus();

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: sessionMessageBus,
    });

    await orchestrator.launch({ name: messageBusSubagentConfig.name });

    expect(factory).toHaveBeenCalledTimes(1);
    const factoryCall = factory.mock.calls[0];
    // SubAgentScope.create(name, config, prompt, model, run, toolConfig, outputConfig, overrides, signal)
    const overridesArg = factoryCall[7];
    expect(overridesArg).toBeDefined();
    expect(overridesArg?.messageBus).toBe(sessionMessageBus);
  });

  it('leaves overrides.messageBus undefined when no messageBus is configured', async () => {
    const { subagentManager, profileManager } = buildMessageBusManagers();
    const { factory } = createScopeFactory();
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());

    const orchestrator = new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
    });

    await orchestrator.launch({ name: messageBusSubagentConfig.name });

    expect(factory).toHaveBeenCalledTimes(1);
    const factoryCall = factory.mock.calls[0];
    const overridesArg = factoryCall[7];
    expect(overridesArg).toBeDefined();
    expect(overridesArg?.messageBus).toBeUndefined();
  });
});
