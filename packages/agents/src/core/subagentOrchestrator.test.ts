import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { fixtureToolSelection } from './__tests__/subagentOrchestrator-test-helpers.js';

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

import { describe, expect, it, vi } from 'bun:test';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RunConfig } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubagentOrchestrator } from './subagentOrchestrator.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  makeForegroundConfig,
  createRuntimeBundle,
  createOrchestratorForTurns,
  createScopeFactory,
  extractRunConfig,
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
  max_output_tokens_total: 128_000_000,
};

const foregroundConfig = makeForegroundConfig();

/**
 * Creates a foreground {@link Config} whose `getEphemeralSetting` returns the
 * given value for `maxTurnsPerPrompt` and `undefined` for all other keys.
 * When `value` is `undefined` the accessor is still present but returns
 * `undefined` (missing value) — distinct from omitting the accessor entirely.
 */
function makeConfigWithMaxTurns(value: unknown): Config {
  return makeForegroundConfig({ maxTurnsPerPrompt: value });
}

/**
 * Shared assertion: launches through a real orchestrator built by
 * {@link createOrchestratorForTurns}, then asserts the materialized
 * `runConfig.max_turns` equals the expected value. Every case exercises the
 * real orchestrator scope, so `runConfig.max_turns` is the actual value the
 * subagent receives (not a mock artifact).
 */
async function launchAndExtract(
  orchestrator: SubagentOrchestrator,
  factory: ReturnType<typeof createScopeFactory>['factory'],
  subagentName: string,
): Promise<RunConfig> {
  await orchestrator.launch({ name: subagentName });
  return extractRunConfig(factory);
}

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

describe('SubagentOrchestrator - token-usage identity (issue #3130)', () => {
  it('gives the subagent runtime its own id, the parent runtime id, and its name', async () => {
    const subagentConfig: SubagentConfig = {
      name: 'burn-attribution',
      profile: 'analysis-profile',
      systemPrompt: 'Analyse.',
      level: 'project',
      filePath: '/tmp/burn-attribution.md',
    };
    const subagentManager = {
      loadSubagent: vi.fn().mockResolvedValue(subagentConfig),
    } as unknown as SubagentManager;
    const profileManager = {
      loadProfile: vi.fn().mockResolvedValue(baseProfile),
    } as unknown as ProfileManager;
    const { factory } = createScopeFactory();
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());
    const foregroundConfig = makeForegroundConfig();

    const ownedSettings1 = createSessionSettingsFixture(foregroundConfig);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: ownedSettings1.workspaceTrust,
      createChildSettings: () =>
        ownedSettings1.settingsOwner.createChildStore(),
      readRunPolicy: () => ownedSettings1.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    await orchestrator.launch({ name: subagentConfig.name });

    expect(runtimeLoader).toHaveBeenCalledTimes(1);
    const loaderOptions = runtimeLoader.mock.calls[0][0];
    const state = loaderOptions.profile.state;

    // Its own runtime, distinct from the parent's.
    expect(state.runtimeId).not.toBe('primary-session');
    // Burn rolls up to the invoking parent.
    expect(state.parentRuntimeId).toBe('primary-session');
    expect(state.subagentName).toBe(subagentConfig.name);
  });
});

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

    const ownedSettings2 = createSessionSettingsFixture(foregroundConfig);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: ownedSettings2.workspaceTrust,
      createChildSettings: () =>
        ownedSettings2.settingsOwner.createChildStore(),
      readRunPolicy: () => ownedSettings2.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const ownedSettings3 = createSessionSettingsFixture(foregroundConfig);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: ownedSettings3.workspaceTrust,
      createChildSettings: () =>
        ownedSettings3.settingsOwner.createChildStore(),
      readRunPolicy: () => ownedSettings3.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const ownedSettings4 = createSessionSettingsFixture(foregroundConfig);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: ownedSettings4.workspaceTrust,
      createChildSettings: () =>
        ownedSettings4.settingsOwner.createChildStore(),
      readRunPolicy: () => ownedSettings4.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const ownedSettings5 = createSessionSettingsFixture(foregroundConfig);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: ownedSettings5.workspaceTrust,
      createChildSettings: () =>
        ownedSettings5.settingsOwner.createChildStore(),
      readRunPolicy: () => ownedSettings5.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const ownedSettings6 = createSessionSettingsFixture(foregroundConfig);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: ownedSettings6.workspaceTrust,
      createChildSettings: () =>
        ownedSettings6.settingsOwner.createChildStore(),
      readRunPolicy: () => ownedSettings6.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_time_minutes).toBe(Number.POSITIVE_INFINITY);
    expect(runConfigArg.max_turns).toBeUndefined();
  });

  it('defaults max_turns to 1000 when neither profile nor request specify limits', async () => {
    const { orchestrator, factory } = createOrchestratorForTurns({
      subagentName: 'default-helper',
      profile: baseProfile,
    });
    const runConfigArg = await launchAndExtract(
      orchestrator,
      factory,
      'default-helper',
    );
    expect(runConfigArg.max_time_minutes).toBe(Number.POSITIVE_INFINITY);
    expect(runConfigArg.max_turns).toBe(1000);
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

    const configWithParentTurns = makeConfigWithMaxTurns(75);

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('parent-turns');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const foregroundRoot1 = configWithParentTurns;
    const foregroundSettings1 = createSessionSettingsFixture(foregroundRoot1);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: foregroundSettings1.workspaceTrust,
      createChildSettings: () =>
        foregroundSettings1.settingsOwner.createChildStore(),
      readRunPolicy: () =>
        foregroundSettings1.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig: foregroundRoot1,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const parentMaxTurns = 50;
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const subagentManager = {
      loadSubagent,
    } as unknown as SubagentManager;

    const loadProfile = vi.fn().mockResolvedValue(baseProfile);
    const profileManager = {
      loadProfile,
    } as unknown as ProfileManager;

    const configWithDynamicTurns = makeForegroundConfig({
      maxTurnsPerPrompt: parentMaxTurns,
    });

    const { factory } = createScopeFactory();
    const runtimeLoader = vi.fn().mockResolvedValue(createRuntimeBundle());

    const foregroundRoot2 = configWithDynamicTurns;
    const foregroundSettings2 = createSessionSettingsFixture(foregroundRoot2);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: foregroundSettings2.workspaceTrust,
      createChildSettings: () =>
        foregroundSettings2.settingsOwner.createChildStore(),
      readRunPolicy: () =>
        foregroundSettings2.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig: foregroundRoot2,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    await orchestrator.launch({ name: subagentConfig.name });

    foregroundSettings2.settingsOwner.writeUserParameter(
      'maxTurnsPerPrompt',
      250,
    );

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , firstRunConfig] = factory.mock.calls[0];
    expect(firstRunConfig.max_turns).toBe(50);

    const [, , , , secondRunConfig] = factory.mock.calls[1];
    expect(secondRunConfig.max_turns).toBe(250);
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

    const configWithParentTurns = makeConfigWithMaxTurns(75);

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('explicit-over-parent');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const foregroundRoot3 = configWithParentTurns;
    const foregroundSettings3 = createSessionSettingsFixture(foregroundRoot3);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: foregroundSettings3.workspaceTrust,
      createChildSettings: () =>
        foregroundSettings3.settingsOwner.createChildStore(),
      readRunPolicy: () =>
        foregroundSettings3.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig: foregroundRoot3,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const configWithParentTurns = makeConfigWithMaxTurns(75);

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('profile-over-parent');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const foregroundRoot4 = configWithParentTurns;
    const foregroundSettings4 = createSessionSettingsFixture(foregroundRoot4);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: foregroundSettings4.workspaceTrust,
      createChildSettings: () =>
        foregroundSettings4.settingsOwner.createChildStore(),
      readRunPolicy: () =>
        foregroundSettings4.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig: foregroundRoot4,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const configWithUnlimitedParentTurns = makeConfigWithMaxTurns(-1);

    const { factory } = createScopeFactory();
    const runtimeBundle = createRuntimeBundle('unlimited-parent-turns');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);

    const foregroundRoot5 = configWithUnlimitedParentTurns;
    const foregroundSettings5 = createSessionSettingsFixture(foregroundRoot5);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: foregroundSettings5.workspaceTrust,
      createChildSettings: () =>
        foregroundSettings5.settingsOwner.createChildStore(),
      readRunPolicy: () =>
        foregroundSettings5.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig: foregroundRoot5,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    await orchestrator.launch({ name: subagentConfig.name });

    const [, , , , runConfigArg] = factory.mock.calls[0];
    expect(runConfigArg.max_turns).toBeUndefined();
  });

  it.each([
    {
      caseName: 'the accessor returns no value',
      subagentName: 'missing-parent-value-helper',
      foregroundConfig: makeConfigWithMaxTurns(undefined),
    },
    {
      caseName: 'the foreground value is zero',
      subagentName: 'zero-parent-helper',
      foregroundConfig: makeConfigWithMaxTurns(0),
    },
    {
      caseName: 'the foreground value is NaN',
      subagentName: 'nan-parent-helper',
      foregroundConfig: makeConfigWithMaxTurns(Number.NaN),
    },
    {
      caseName: 'the foreground value is infinite',
      subagentName: 'infinity-parent-helper',
      foregroundConfig: makeConfigWithMaxTurns(Number.POSITIVE_INFINITY),
    },
    {
      caseName: 'the foreground value is not a number',
      subagentName: 'string-parent-helper',
      foregroundConfig: makeConfigWithMaxTurns('not-a-number'),
    },
    {
      caseName: 'the foreground accessor is unavailable',
      subagentName: 'no-parent-accessor-helper',
      foregroundConfig,
    },
  ])(
    'falls back to 1000 when $caseName',
    async ({ subagentName, foregroundConfig }) => {
      const { orchestrator, factory } = createOrchestratorForTurns({
        subagentName,
        profile: baseProfile,
        foregroundConfig,
      });

      const runConfigArg = await launchAndExtract(
        orchestrator,
        factory,
        subagentName,
      );

      expect(runConfigArg.max_turns).toBe(1000);
    },
  );

  it('keeps explicit task max_turns -1 unlimited even when profile and foreground both cap', async () => {
    const profileWithCap: Profile = {
      ...baseProfile,
      ephemeralSettings: {
        ...baseProfile.ephemeralSettings,
        maxTurnsPerPrompt: 300,
      },
    };

    const configWithForegroundCap = makeConfigWithMaxTurns(75);

    const { orchestrator, factory } = createOrchestratorForTurns({
      subagentName: 'task-unlimited-helper',
      profileName: 'capped-profile',
      profile: profileWithCap,
      foregroundConfig: configWithForegroundCap,
    });

    await orchestrator.launch({
      name: 'task-unlimited-helper',
      runConfig: { max_turns: -1 },
    });

    const runConfigArg = extractRunConfig(factory);
    // -1 means unlimited: max_turns is omitted entirely so neither the
    // 300-turn profile cap nor the 75-turn foreground cap is applied.
    expect(runConfigArg.max_turns).toBeUndefined();
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

    const ownedSettings7 = createSessionSettingsFixture(foregroundConfig);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: ownedSettings7.workspaceTrust,
      createChildSettings: () =>
        ownedSettings7.settingsOwner.createChildStore(),
      readRunPolicy: () => ownedSettings7.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
      subagentManager,
      profileManager,
      foregroundConfig,
      scopeFactory: factory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const ownedSettings8 = createSessionSettingsFixture(foregroundConfig);
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: ownedSettings8.workspaceTrust,
      createChildSettings: () =>
        ownedSettings8.settingsOwner.createChildStore(),
      readRunPolicy: () => ownedSettings8.settingsOwner.readSubagentRunPolicy(),
      toolRegistry: fixtureToolSelection(),
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      instructions: emptyInstructionReads,
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
    expect(overridesArg.messageBus).toBe(sessionMessageBus);
  });
});
