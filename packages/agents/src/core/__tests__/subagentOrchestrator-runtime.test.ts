import {
  createSessionSettingsFixture,
  subagentSessionPorts,
} from '../../api/__tests__/helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

/**
 * Runtime assembly tests extracted from the original monolithic
 * subagentOrchestrator.test.ts so no file-level max-lines disable is needed.
 * Load-balancer profile tests live in subagentOrchestrator-runtime.part2.test.ts.
 */

import { describe, expect, it, vi } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
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

    const foregroundConfig1 = makeForegroundConfig();
    const foregroundSettings1 = createSessionSettingsFixture(foregroundConfig1);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings1),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig1,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
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
    expect<unknown>(overrides.runtimeBundle).toBe(runtimeBundle);

    expect(result.scope).toBe(scope);
    expect(result.agentId).toBe('planner-1');
    expect(result.dispose).toBeTypeOf('function');
  });

  it('uses an isolated providerManager for provider-backed subagent runtimes (Issue #2410)', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);

    const parentProviderManager = { getActiveProvider: vi.fn() };
    const config = makeForegroundConfig();

    const runtimeBundle = createRuntimeBundle('provider-backed');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'planner-provider-backed',
    } as unknown as SubAgentScopeInstance;
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockResolvedValue(scope);

    const foregroundConfig2 = config;
    const foregroundSettings2 = createSessionSettingsFixture(foregroundConfig2);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings2),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig2,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    await orchestrator.launch({
      name: subagentConfig.name,
      runConfig,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    // The subagent gets its OWN isolated providerManager, not the parent's
    expect(loaderArgs.profile.providerManager).not.toBe(parentProviderManager);
    expect(loaderArgs.profile.providerManager).toBeDefined();
    expect(loaderArgs.profile.contentGeneratorConfig).not.toHaveProperty(
      'providerManager',
    );
    expect(loaderArgs.profile.config).not.toHaveProperty(
      'contentGeneratorFactory',
    );
    expect(
      loaderArgs.profile.contentGeneratorConfig.contentGeneratorFactory,
    ).toHaveProperty('createContentGenerator');
  });

  it('cleans up the isolated runtime when launch fails after runtime assembly', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const activate = vi.fn().mockResolvedValue(undefined);
    const mediaRoot = mkdtempSync(join(tmpdir(), 'llxprt-child-runtime-'));
    const mediaStore = new LocalMediaStore({
      rootDirectory: mediaRoot,
      quotaBytes: 1024 * 1024,
    });
    const createIsolated = runtimeModule.createIsolatedRuntimeContext;
    const createIsolatedRuntimeContextSpy = vi
      .spyOn(runtimeModule, 'createIsolatedRuntimeContext')
      .mockImplementation((options, settingsService) => {
        const handle = createIsolated(options, settingsService);
        return {
          ...handle,
          activate,
          cleanup: async () => {
            await handle.cleanup();
            await cleanup();
          },
        };
      });
    const executeProviderActivationSpy = vi
      .spyOn(activationExecutor, 'executeProviderActivation')
      .mockResolvedValue({ authFailed: false, infoMessages: [] });

    const runtimeBundle = createRuntimeBundle('post-bundle-failure');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockRejectedValue(new Error('scope creation failed'));

    const foregroundConfig3 = makeForegroundConfig();
    const foregroundSettings3 = createSessionSettingsFixture(foregroundConfig3);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings3),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig3,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
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
      // The orchestrator owns the isolated Config it constructed, so its
      // teardown disposes it after the handle cleanup (children first).
    } finally {
      createIsolatedRuntimeContextSpy.mockRestore();
      executeProviderActivationSpy.mockRestore();
      await mediaStore.close();
      rmSync(mediaRoot, { recursive: true, force: true });
    }
  });

  it('builds the subagent runtime through agent-owned assembly: a Config carrying working agent factories and runtime managers threads the SAME session bus (issue #3222, #2320)', async () => {
    // RED basis (main @ 5bedbd238): the orchestrator calls
    // createIsolatedRuntimeContext WITHOUT a config — providers constructs one
    // and stamps CLI-registered factories onto it, so in a process with no CLI
    // import the subagent Config carries NO agent factories at all.
    const isolatedHome = mkdtempSync(join(tmpdir(), 'issue3222-orchestrator-'));
    const previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = isolatedHome;

    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const loadProfile = vi.fn().mockResolvedValue(profile);
    const profileManager = { loadProfile } as unknown as ProfileManager;
    const orchestratorBus = new MessageBus();

    let capturedOptions:
      | Parameters<typeof runtimeModule.createIsolatedRuntimeContext>[0]
      | undefined;
    const createIsolated = runtimeModule.createIsolatedRuntimeContext;
    const isolatedSpy = vi
      .spyOn(runtimeModule, 'createIsolatedRuntimeContext')
      .mockImplementation((options, settingsService) => {
        capturedOptions = options;
        const handle = createIsolated(options, settingsService);
        return { ...handle, activate: vi.fn().mockResolvedValue(undefined) };
      });
    const executeProviderActivationSpy = vi
      .spyOn(activationExecutor, 'executeProviderActivation')
      .mockResolvedValue({ authFailed: false, infoMessages: [] });

    const runtimeBundle = createRuntimeBundle('agent-owned-assembly');
    const runtimeLoader = vi.fn().mockResolvedValue(runtimeBundle);
    const scope = {
      runtimeContext: runtimeBundle.runtimeContext,
      getAgentId: () => 'planner-agent-owned',
    } as unknown as SubAgentScopeInstance;
    const scopeFactory = vi
      .fn<typeof SubAgentScope.create>()
      .mockResolvedValue(scope);

    try {
      const foregroundConfig4 = makeForegroundConfig();
      const foregroundSettings4 =
        createSessionSettingsFixture(foregroundConfig4);
      const orchestrator = new SubagentOrchestrator({
        workspaceTrust: foregroundSettings4.workspaceTrust,
        createChildSettings: () =>
          foregroundSettings4.settingsOwner.createChildStore(),
        readRunPolicy: () =>
          foregroundSettings4.settingsOwner.readSubagentRunPolicy(),

        instructions: emptyInstructionReads,
        workspacePaths: fixturePaths(),
        readMcpInstructions: () => undefined,
        subagentManager: { loadSubagent } as unknown as SubagentManager,
        profileManager,
        foregroundConfig: foregroundConfig4,
        toolRegistry: fixtureToolSelection(),
        scopeFactory,
        runtimeLoader,
        messageBus: orchestratorBus,
      });

      const result = await orchestrator.launch({
        name: subagentConfig.name,
        runConfig,
      });
      await result.dispose();

      expect(capturedOptions).toBeDefined();
      const options = capturedOptions;
      // #2320 invariant: the SAME concrete session bus threads to child
      // scheduling — the orchestrator passes its own bus, nothing else.
      expect(options?.messageBus).toBe(orchestratorBus);
      // Agent-owned assembly: the orchestrator hands providers a Config it
      // built itself, carrying the three agent runtime factories and the
      // runtime managers.
      const config = options?.config;
      expect(config).toBeInstanceOf(Config);
      expect(config && 'agentClientFactory' in config).toBe(false);
      expect(config).not.toHaveProperty('taskToolRegistration');
      expect(config).not.toHaveProperty('profileManager');
      expect(config).not.toHaveProperty('subagentManager');
    } finally {
      isolatedSpy.mockRestore();
      executeProviderActivationSpy.mockRestore();
      if (previousConfigHome === undefined) {
        delete process.env.LLXPRT_CONFIG_HOME;
      } else {
        process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
      }
      rmSync(isolatedHome, { recursive: true, force: true });
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

    const foregroundConfig5 = makeForegroundConfig();
    const foregroundSettings5 = createSessionSettingsFixture(foregroundConfig5);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings5),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig5,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const foregroundConfig6 = makeForegroundConfig();
    const foregroundSettings6 = createSessionSettingsFixture(foregroundConfig6);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings6),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig6,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const foregroundConfig7 = makeForegroundConfig();
    const foregroundSettings7 = createSessionSettingsFixture(foregroundConfig7);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings7),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig7,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

      const foregroundConfig8 = makeForegroundConfig();
      const foregroundSettings8 =
        createSessionSettingsFixture(foregroundConfig8);
      const orchestrator = new SubagentOrchestrator({
        workspaceTrust: foregroundSettings8.workspaceTrust,
        createChildSettings: () =>
          foregroundSettings8.settingsOwner.createChildStore(),
        readRunPolicy: () =>
          foregroundSettings8.settingsOwner.readSubagentRunPolicy(),

        instructions: emptyInstructionReads,
        workspacePaths: fixturePaths(),
        readMcpInstructions: () => undefined,
        subagentManager: { loadSubagent } as unknown as SubagentManager,
        profileManager: { loadProfile } as unknown as ProfileManager,
        foregroundConfig: foregroundConfig8,
        toolRegistry: fixtureToolSelection(),
        scopeFactory,
        runtimeLoader,
        messageBus: new MessageBus(),
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

    const foregroundConfig9 = makeForegroundConfig();
    const foregroundSettings9 = createSessionSettingsFixture(foregroundConfig9);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings9),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig9,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    await orchestrator.launch({
      name: qwenSubagent.name,
    });

    const loaderArgs = runtimeLoader.mock.calls[0][0];
    expect(loaderArgs.profile.state.baseUrl).toBe(qwenBaseUrl);
  });

  it('forwards user-agent ephemeral setting to subagent SettingsService (Issue #2410)', async () => {
    const kimiEphemeralSettings = {
      'context-limit': 20000,
      'user-agent': 'RooCode/1.0',
    };
    const kimiProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'kimi-for-coding',
      modelParams: {},
      ephemeralSettings: kimiEphemeralSettings,
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

    const foregroundConfig10 = makeForegroundConfig();
    const foregroundSettings10 =
      createSessionSettingsFixture(foregroundConfig10);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings10),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig10,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const foregroundConfig11 = makeForegroundConfig();
    const foregroundSettings11 =
      createSessionSettingsFixture(foregroundConfig11);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings11),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig11,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const foregroundConfig12 = makeForegroundConfig();
    const foregroundSettings12 =
      createSessionSettingsFixture(foregroundConfig12);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings12),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig12,
      toolRegistry: fixtureToolSelection(),
      scopeFactory,
      runtimeLoader,
      messageBus: new MessageBus(),
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

    const originalBundle = createRuntimeBundle('dispose');
    const disposeSpy = vi.fn();
    const clearSpy = vi.fn();
    const history = {
      ...originalBundle.history,
      dispose: disposeSpy,
      clear: clearSpy,
    };
    const bundle = {
      ...originalBundle,
      history,
      runtimeContext: { ...originalBundle.runtimeContext, history },
    };

    const runtimeLoader = vi.fn().mockResolvedValue(bundle);

    const foregroundConfig13 = makeForegroundConfig();
    const foregroundSettings13 =
      createSessionSettingsFixture(foregroundConfig13);
    const orchestrator = new SubagentOrchestrator({
      ...subagentSessionPorts(foregroundSettings13),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig13,
      toolRegistry: fixtureToolSelection(),
      scopeFactory: vi.fn<typeof SubAgentScope.create>().mockResolvedValue({
        runtimeContext: bundle.runtimeContext,
        getAgentId: () => 'planner-dispose',
      } as unknown as SubAgentScopeInstance),
      runtimeLoader,
      messageBus: new MessageBus(),
    });

    const run = await orchestrator.launch({
      name: subagentConfig.name,
      runConfig,
    });

    await run.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

function fixtureToolSelection(): import('@vybestack/llxprt-code-tools').ToolSelection {
  return new ToolRegistry(
    { getCoreTools: () => [], isTrustedFolder: () => true },
    new CoreMessageBusAdapter(new MessageBus()),
    assembleTaskSchemaPolicy(new SettingsService()),
  );
}
