import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  createSessionSettingsFixture,
  subagentSessionPorts,
} from '../../api/__tests__/helpers/session-settings-fixture.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { createTestChildOrchestrator } from './child-launch-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

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

import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import {
  loadAgentRuntime,
  type AgentRuntimeLoaderOptions,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import {
  ConfirmationOutcome,
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-policy/confirmation-bus/types.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import { describe, expect, it, vi } from 'bun:test';
import { useOwnedCredentials } from '../../api/__tests__/helpers/owned-credential-fixture.js';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';

import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { RunConfig } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubAgentScope, type SubAgentScopeFactory } from '../subagent.js';

import {
  createRuntimeBundle,
  fakeChildScope,
  fixtureToolSelection,
  makeForegroundConfig,
} from './subagentOrchestrator-test-helpers.js';

describe('SubagentOrchestrator - Runtime Assembly', () => {
  const credentials = useOwnedCredentials();
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

    const scope = fakeChildScope({
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      getAgentId: () => 'planner-1',
    });
    const scopeFactory = vi.fn<SubAgentScopeFactory>().mockResolvedValue(scope);

    const foregroundConfig1 = makeForegroundConfig();
    const foregroundSettings1 = createSessionSettingsFixture(foregroundConfig1);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
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
    const [, scopeRuntime] = scopeFactory.mock.calls[0];
    expect(scopeRuntime.admittedRuntime).toBe(runtimeBundle.runtimeContext);
    expect(scopeRuntime.contentGenerator).toBe(runtimeBundle.contentGenerator);
    expect(result.identity.runtimeId).toBe(
      runtimeBundle.runtimeContext.state.runtimeId,
    );

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
    const scope = fakeChildScope({
      getAgentId: () => 'planner-provider-backed',
    });
    const scopeFactory = vi.fn<SubAgentScopeFactory>().mockResolvedValue(scope);

    const foregroundConfig2 = config;
    const foregroundSettings2 = createSessionSettingsFixture(foregroundConfig2);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
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
    const childProfile: Profile = {
      ...profile,
      provider: 'openai',
      model: 'gpt-4o',
    };
    const loadProfile = vi.fn().mockResolvedValue(childProfile);
    let loadedOptions: AgentRuntimeLoaderOptions | undefined;
    const runtimeLoader = async (options: AgentRuntimeLoaderOptions) => {
      loadedOptions = options;
      expect(options.profile.providerManager?.getActiveProvider().name).toBe(
        childProfile.provider,
      );
      expect(options.profile.config.getModel()).toBe(childProfile.model);
      expect(await credentials().listProviders(0)).toStrictEqual([]);
      expect(credentials().snapshot()).toStrictEqual([0]);
      return loadAgentRuntime(options);
    };
    const scopeFactory = vi
      .fn<SubAgentScopeFactory>()
      .mockRejectedValue(new Error('scope creation failed'));

    const foregroundConfig3 = makeForegroundConfig();
    const foregroundSettings3 = createSessionSettingsFixture(foregroundConfig3);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: credentials().authority,
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

    await expect(
      orchestrator.launch({
        name: subagentConfig.name,
        runConfig,
      }),
    ).rejects.toThrow('scope creation failed');

    if (loadedOptions === undefined)
      throw new Error('Child loader not reached');
    expect(credentials().snapshot()).toStrictEqual([1]);
    await expect(
      loadedOptions.mediaStore.getStoredByteLength(),
    ).rejects.toThrow(/closed/i);
    expect(() => loadedOptions.profile.readRuntimeSettings?.()).toThrow(
      'Session settings owner is closed',
    );
    expect(loadedOptions.profile.config).not.toBe(foregroundConfig3);
    expect(foregroundSettings3.settingsOwner.readSelectedModel()).toBe(
      'gemini-1.5-flash',
    );
  });

  it('builds the subagent runtime through agent-owned assembly: a Config carrying working agent factories and runtime managers threads the SAME session bus (issue #3222, #2320)', async () => {
    const loadSubagent = vi.fn().mockResolvedValue(subagentConfig);
    const childProfile: Profile = {
      ...profile,
      provider: 'openai',
      model: 'gpt-4o',
    };
    const loadProfile = vi.fn().mockResolvedValue(childProfile);
    const profileManager = { loadProfile } as unknown as ProfileManager;
    const orchestratorBus = new MessageBus();

    const requests: string[] = [];
    const unsubscribe = orchestratorBus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        requests.push(request.toolCall.name ?? '');
        orchestratorBus.respondToConfirmation(
          request.correlationId,
          ConfirmationOutcome.ProceedOnce,
        );
      },
    );
    let childConfig: Config | undefined;
    const runtimeLoader = async (options: AgentRuntimeLoaderOptions) => {
      childConfig = options.profile.config;
      return loadAgentRuntime(options);
    };
    const scopeFactory: SubAgentScopeFactory = async (...args) => {
      const { messageBus } = args[2];
      expect(
        await messageBus.requestConfirmation({ name: 'write_file' }, {}),
      ).toBe(true);
      return SubAgentScope.create(...args);
    };

    try {
      const foregroundConfig4 = makeForegroundConfig();
      const foregroundSettings4 =
        createSessionSettingsFixture(foregroundConfig4);
      const orchestrator = createTestChildOrchestrator({
        credentialAuthority: credentials().authority,
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
      try {
        expect(requests).toStrictEqual(['write_file']);
        expect(childConfig).toBeInstanceOf(Config);
        if (childConfig === undefined)
          throw new Error('Child loader not reached');
        expect(childConfig).not.toBe(foregroundConfig4);
        expect('agentClientFactory' in childConfig).toBe(false);
        expect(childConfig).not.toHaveProperty('taskToolRegistration');
        expect(childConfig).not.toHaveProperty('profileManager');
        expect(childConfig).not.toHaveProperty('subagentManager');
        expect(result.identity.provider).toBe(childProfile.provider);
        expect(result.identity.runtimeId).toBe(childConfig.getSessionId());
        expect(await credentials().listProviders(0)).toStrictEqual([]);
      } finally {
        await result.dispose();
      }
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(
        await orchestratorBus.requestConfirmation({ name: 'read_file' }, {}),
      ).toBe(true);
      expect(requests).toStrictEqual(['write_file', 'read_file']);
    } finally {
      unsubscribe();
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

    const scope = fakeChildScope({
      getAgentId: () => 'planner-2',
    });
    const scopeFactory = vi.fn<SubAgentScopeFactory>().mockResolvedValue(scope);

    const foregroundConfig5 = makeForegroundConfig();
    const foregroundSettings5 = createSessionSettingsFixture(foregroundConfig5);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
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

    const scope = fakeChildScope({
      getAgentId: () => 'planner-overlap',
    });
    const scopeFactory = vi.fn<SubAgentScopeFactory>().mockResolvedValue(scope);

    const foregroundConfig6 = makeForegroundConfig();
    const foregroundSettings6 = createSessionSettingsFixture(foregroundConfig6);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
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

    const scope = fakeChildScope({
      getAgentId: () => 'qwencoder-1',
    });
    const scopeFactory = vi.fn<SubAgentScopeFactory>().mockResolvedValue(scope);

    const foregroundConfig7 = makeForegroundConfig();
    const foregroundSettings7 = createSessionSettingsFixture(foregroundConfig7);
    const settingsService =
      foregroundSettings7.settingsOwner.createChildStore();
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
      ...subagentSessionPorts(foregroundSettings7),
      createChildSettings: () => settingsService,

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
      const scope = fakeChildScope({
        getAgentId: () => 'vertex-helper-1',
      });
      const scopeFactory = vi
        .fn<SubAgentScopeFactory>()
        .mockResolvedValue(scope);

      const foregroundConfig8 = makeForegroundConfig();
      const foregroundSettings8 =
        createSessionSettingsFixture(foregroundConfig8);
      const settingsService =
        foregroundSettings8.settingsOwner.createChildStore();
      const orchestrator = createTestChildOrchestrator({
        credentialAuthority: new CredentialAuthority(),
        workspaceTrust: foregroundSettings8.workspaceTrust,
        createChildSettings: () => settingsService,
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

    const scope = fakeChildScope({
      getAgentId: () => 'qwencoder-1',
    });
    const scopeFactory = vi.fn<SubAgentScopeFactory>().mockResolvedValue(scope);

    const foregroundConfig9 = makeForegroundConfig();
    const foregroundSettings9 = createSessionSettingsFixture(foregroundConfig9);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
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

    const scope = fakeChildScope({
      getAgentId: () => 'kimicoder-1',
    });
    const scopeFactory = vi.fn<SubAgentScopeFactory>().mockResolvedValue(scope);

    const foregroundConfig10 = makeForegroundConfig();
    const foregroundSettings10 =
      createSessionSettingsFixture(foregroundConfig10);
    const settingsService =
      foregroundSettings10.settingsOwner.createChildStore();
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
      ...subagentSessionPorts(foregroundSettings10),
      createChildSettings: () => settingsService,

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

    const scope = fakeChildScope({
      getAgentId: () => 'codeanalyzer-1',
    });
    const scopeFactory = vi.fn<SubAgentScopeFactory>().mockResolvedValue(scope);

    const foregroundConfig11 = makeForegroundConfig();
    const foregroundSettings11 =
      createSessionSettingsFixture(foregroundConfig11);
    const settingsService =
      foregroundSettings11.settingsOwner.createChildStore();
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
      ...subagentSessionPorts(foregroundSettings11),
      createChildSettings: () => settingsService,

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
      .fn<SubAgentScopeFactory>()
      .mockImplementation(async () => {
        sequence += 1;
        return fakeChildScope({
          dispose: async () => {},
          getAgentId: () => `planner-${sequence}`,
        });
      });

    const foregroundConfig12 = makeForegroundConfig();
    const foregroundSettings12 =
      createSessionSettingsFixture(foregroundConfig12);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
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
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
      ...subagentSessionPorts(foregroundSettings13),

      instructions: emptyInstructionReads,
      workspacePaths: fixturePaths(),
      readMcpInstructions: () => undefined,
      subagentManager: { loadSubagent } as unknown as SubagentManager,
      profileManager: { loadProfile } as unknown as ProfileManager,
      foregroundConfig: foregroundConfig13,
      toolRegistry: fixtureToolSelection(),
      scopeFactory: vi.fn<SubAgentScopeFactory>().mockResolvedValue(
        fakeChildScope({
          dispose: async () => {},
          getAgentId: () => 'planner-dispose',
        }),
      ),
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
