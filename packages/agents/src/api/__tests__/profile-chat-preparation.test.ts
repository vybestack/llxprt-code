import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService, Profile } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { fromConfig } from '../fromConfig.js';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';
import { CoreEvent } from '@vybestack/llxprt-code-core/utils/events.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('profile-chat-preparation', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const builtCredentials = useOwnedCredentials();
  let builtCallerConfig: Config;
  let builtCallerSettings: SettingsService;
  let builtCallerSettingsOwner: SessionSettingsOwner;
  let builtCallerPolicy: RuntimePolicyOwner;
  let builtCallerMcp: McpRuntimeOwner;
  let builtCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let builtCallerOwner: SessionClientOwner;
  let builtCallerClose: () => Promise<void>;
  let builtCallerFactories: AgentRuntimeFactoryBindings;
  let builtCallerRelease: AcquisitionRelease;
  let builtCallerFiles: ProviderFileLifecycle;
  let builtCallerRuntimeId: string;
  let builtCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let builtCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let builtCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

  async function openbuiltCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'builtCaller-adoption-')),
    );
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...overrides,
      workingDir:
        overrides.workingDir === undefined
          ? directory
          : await realpath(overrides.workingDir),
    };
    const parameters = { ...toConfigParameters(selection), ...skillSettings };
    parameters.interactive = true;
    if (overrides.hooks !== undefined) parameters.enableHooks = true;
    if (
      overrides.filesystemOwner === undefined &&
      (overrides.harness?.includeProcessCwd ?? true)
    )
      parameters.includeDirectories = [
        ...(parameters.includeDirectories ?? []),
        process.cwd(),
      ];
    builtCallerConfig = new Config(parameters);
    builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    builtCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtCallerConfig.getInitialSettings(),
    ))
      builtCallerSettings.set(key, value);
    builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
    injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
    builtCallerMcp = await buildTestMcpRuntime(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      builtCallerPolicy,
      skillOperations,
    );
    acquirebuiltCallerProviders();
    const media = new SessionMediaOwner(
      builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    builtCallerOwner = await SessionClientOwner.create(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      builtCallerFactories.agentClientFactory,
      media.store,
      builtCallerMcp.readInstructions,
      builtCallerMcp.workspacePaths,
      builtCallerSettingsOwner,
      builtCallerContent,
      builtCallerTokenizer,
    );
    builtCallerOwner.bindMcpRuntime(builtCallerMcp);
    builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
      builtCallerOAuth.composeRetryOperations(provider),
    );
    builtCallerOwner.bindHooks();
    builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtCallerOwner.dispose(),
        () => builtCallerRelease.close(),
        () => media.dispose(),
        () => builtCallerMcp.dispose(),
        () => builtCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerSettingsOwner,
        builtCallerManager,
        builtCallerOAuth,
        builtCallerRuntimeId,
        builtCallerTokenizer,
        undefined,
      );
      await builtCallerMcp.initialize();
      await activatebuiltCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }
  }
  function acquirebuiltCallerProviders(): void {
    builtCallerRuntimeId = 'builtCaller-' + randomUUID();
    builtCallerRelease = new AcquisitionRelease();
    builtCallerSettingsOwner = new SessionSettingsOwner(builtCallerSettings);
    builtCallerRelease.acquire('settings', () =>
      builtCallerSettingsOwner.dispose(),
    );
    builtCallerSettingsOwner.initializeProviderSelection(
      builtCallerConfig.getProvider(),
      builtCallerConfig.getModel(),
    );
    builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
    builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      builtCallerRuntimeId,
      builtCallerConfig.getSessionId(),
    ])
      builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtCallerFiles, scope),
      );
    builtCallerManager = acquirePreferredProviderManager(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerSettingsOwner,
      builtCallerFiles,
      builtCallerRuntimeId,
      builtCredentials().authority,
      builtCallerRelease,
    );
    const factories = configureProviderRuntimeFactories(
      builtCallerConfig,
      builtCallerManager,
    );
    builtCallerTokenizer = factories.tokenizerFactory;
    builtCallerContent = factories.contentGeneratorFactory;
    builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerConfig,
      builtCallerSettings,
      builtCallerManager,
      builtCallerRuntimeId,
      builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      builtCallerRelease,
      undefined,
    );
  }
  async function activatebuiltCallerClient(
    intent: ProviderActivationIntent = {
      provider: builtCallerConfig.getProvider(),
      model: builtCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      builtCallerConfig,
      intent,
      assembleProviderSwitch(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerManager,
        builtCallerOAuth,
        () => 'agent',
        () => builtCallerOwner.refreshAuth(),
        builtCallerSettingsOwner,
      ),
      builtCallerSettings,
      builtCallerManager,
      (method) => builtCallerOwner.refreshAuth(method),
      assembleModelSelection(builtCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await builtCallerOwner.initializeTools();
    await builtCallerOwner.getAgentClient().startChat();
  }

  const otherCredentials = useOwnedCredentials();
  let otherCallerConfig: Config;
  let otherCallerSettings: SettingsService;
  let otherCallerSettingsOwner: SessionSettingsOwner;
  let otherCallerPolicy: RuntimePolicyOwner;
  let otherCallerMcp: McpRuntimeOwner;
  let otherCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let otherCallerOwner: SessionClientOwner;
  let otherCallerClose: () => Promise<void>;
  let otherCallerFactories: AgentRuntimeFactoryBindings;
  let otherCallerRelease: AcquisitionRelease;
  let otherCallerFiles: ProviderFileLifecycle;
  let otherCallerRuntimeId: string;
  let otherCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let otherCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let otherCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

  async function openotherCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'otherCaller-adoption-')),
    );
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...overrides,
      workingDir:
        overrides.workingDir === undefined
          ? directory
          : await realpath(overrides.workingDir),
    };
    const parameters = { ...toConfigParameters(selection), ...skillSettings };
    parameters.interactive = true;
    if (overrides.hooks !== undefined) parameters.enableHooks = true;
    if (
      overrides.filesystemOwner === undefined &&
      (overrides.harness?.includeProcessCwd ?? true)
    )
      parameters.includeDirectories = [
        ...(parameters.includeDirectories ?? []),
        process.cwd(),
      ];
    otherCallerConfig = new Config(parameters);
    otherCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    otherCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      otherCallerConfig.getInitialSettings(),
    ))
      otherCallerSettings.set(key, value);
    otherCallerPolicy = new RuntimePolicyOwner(otherCallerConfig);
    injectConfirmationForcingPolicy(otherCallerPolicy.session.confirmation);
    otherCallerMcp = await buildTestMcpRuntime(
      otherCallerConfig,
      otherCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      otherCallerPolicy,
      skillOperations,
    );
    acquireotherCallerProviders();
    const media = new SessionMediaOwner(
      otherCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    otherCallerOwner = await SessionClientOwner.create(
      otherCallerConfig,
      assembleTaskSchemaPolicy(otherCallerSettings),
      otherCallerManager,
      otherCallerFactories.agentClientFactory,
      media.store,
      otherCallerMcp.readInstructions,
      otherCallerMcp.workspacePaths,
      otherCallerSettingsOwner,
      otherCallerContent,
      otherCallerTokenizer,
    );
    otherCallerOwner.bindMcpRuntime(otherCallerMcp);
    otherCallerOwner.bindProviderFiles(otherCallerFiles, (provider) =>
      otherCallerOAuth.composeRetryOperations(provider),
    );
    otherCallerOwner.bindHooks();
    otherCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => otherCallerOwner.dispose(),
        () => otherCallerRelease.close(),
        () => media.dispose(),
        () => otherCallerMcp.dispose(),
        () => otherCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        otherCallerConfig,
        otherCallerSettings,
        otherCallerSettingsOwner,
        otherCallerManager,
        otherCallerOAuth,
        otherCallerRuntimeId,
        otherCallerTokenizer,
        undefined,
      );
      await otherCallerMcp.initialize();
      await activateotherCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, otherCallerClose);
    }
  }
  function acquireotherCallerProviders(): void {
    otherCallerRuntimeId = 'otherCaller-' + randomUUID();
    otherCallerRelease = new AcquisitionRelease();
    otherCallerSettingsOwner = new SessionSettingsOwner(otherCallerSettings);
    otherCallerRelease.acquire('settings', () =>
      otherCallerSettingsOwner.dispose(),
    );
    otherCallerSettingsOwner.initializeProviderSelection(
      otherCallerConfig.getProvider(),
      otherCallerConfig.getModel(),
    );
    otherCallerSettingsOwner.bindTelemetry(otherCallerConfig);
    otherCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      otherCallerRuntimeId,
      otherCallerConfig.getSessionId(),
    ])
      otherCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(otherCallerFiles, scope),
      );
    otherCallerManager = acquirePreferredProviderManager(
      otherCallerConfig,
      otherCallerSettings,
      otherCallerSettingsOwner,
      otherCallerFiles,
      otherCallerRuntimeId,
      otherCredentials().authority,
      otherCallerRelease,
    );
    const factories = configureProviderRuntimeFactories(
      otherCallerConfig,
      otherCallerManager,
    );
    otherCallerTokenizer = factories.tokenizerFactory;
    otherCallerContent = factories.contentGeneratorFactory;
    otherCallerOAuth = acquirePreferredOAuth(
      undefined,
      otherCallerPolicy.session.messageBus,
      otherCallerConfig,
      otherCallerSettings,
      otherCallerManager,
      otherCallerRuntimeId,
      otherCallerMcp.profileDefinitions,
      otherCredentials().authority,
      otherCallerRelease,
      undefined,
    );
  }
  async function activateotherCallerClient(
    intent: ProviderActivationIntent = {
      provider: otherCallerConfig.getProvider(),
      model: otherCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      otherCallerConfig,
      intent,
      assembleProviderSwitch(
        otherCallerConfig,
        otherCallerSettings,
        otherCallerManager,
        otherCallerOAuth,
        () => 'agent',
        () => otherCallerOwner.refreshAuth(),
        otherCallerSettingsOwner,
      ),
      otherCallerSettings,
      otherCallerManager,
      (method) => otherCallerOwner.refreshAuth(method),
      assembleModelSelection(otherCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await otherCallerOwner.initializeTools();
    await otherCallerOwner.getAgentClient().startChat();
  }

  it.each([false, true])(
    'preserves chat, history and IDE view after failed replacement (initialized: %s)',
    async (initialized) => {
      await openbuiltCaller('multi-turn-text.jsonl');
      await openotherCaller('multi-turn-text.jsonl');
      const agent = await fromConfig({
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        agentClient: initialized
          ? builtCallerOwner.getAgentClient()
          : undefined,
        providerManager: builtCallerManager,
        config: builtCallerConfig,
        mcpRuntime: builtCallerMcp,
        messageBus: builtCallerPolicy.session.messageBus,
      });
      const ownerB = await fromConfig({
        settingsOwner: otherCallerSettingsOwner,
        settingsService: otherCallerSettings,
        providerManager: otherCallerManager,
        config: otherCallerConfig,
        mcpRuntime: otherCallerMcp,
        messageBus: otherCallerPolicy.session.messageBus,
      });
      const provider = new FakeProvider(
        fileURLToPath(
          new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
        ),
        builtCallerConfig.getTargetDir(),
      );
      provider.name = 'replacement';
      builtCallerManager.registerProvider(provider);
      const { agentClient: client } = agent;
      const priorIde = ideContext.getIdeContext();
      const ownedClient = agent.ide.getIdeClient();
      if (ownedClient === undefined)
        throw new Error('Workspace IDE client missing');
      const contextReader = vi
        .spyOn(ownedClient, 'getIdeContext')
        .mockImplementation(() => ideContext.getIdeContext());
      agent.ide.setIdeMode(true);
      ideContext.setIdeContext({
        workspaceState: {
          openFiles: [
            { path: '/workspace/kept-editor.ts', timestamp: 1, isActive: true },
          ],
        },
      });
      if (initialized) {
        for await (const event of agent.stream('carried context')) {
          if (event.type === 'error') throw new Error(event.error.message);
        }
      } else {
        await client.storeHistoryForLaterUse([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'carried context' }],
          },
        ]);
      }
      const history = await agent.getHistory();
      const visibleHistory = client.getHistoryService();
      const listeners = builtCallerSettingsOwner[
        'modelNotifications'
      ].listeners(CoreEvent.ModelChanged);
      const beforeB = ownerB.captureProfile();
      const profile: Profile = {
        version: 1,
        provider: 'replacement',
        model: 'candidate',
        modelParams: {},
        ephemeralSettings: {},
      };
      let reads = 0;
      const failure = new Error('loop boundary after chat preparation');
      const boundary = vi
        .spyOn(builtCallerConfig, 'isInteractive')
        .mockImplementation(() => {
          if (++reads === 3) throw failure;
          return true;
        });
      try {
        await expect(agent.profiles.applySnapshot(profile)).rejects.toBe(
          failure,
        );
        boundary.mockRestore();
        expect(reads).toBe(3);
        expect(agent.agentClient).toBe(client);
        expect(client.hasChatInitialized()).toBe(initialized);
        expect(client.getHistoryService()).toBe(visibleHistory);
        expect(
          builtCallerSettingsOwner['modelNotifications'].listeners(
            CoreEvent.ModelChanged,
          ),
        ).toStrictEqual(listeners);
        expect(await agent.getHistory()).toStrictEqual(history);
        expect(ownerB.captureProfile()).toStrictEqual(beforeB);
        const eventsB = [];
        for await (const event of ownerB.stream('owner B still works'))
          eventsB.push(event);
        expect(eventsB.some((event) => event.type === 'error')).toBe(false);
        const events = [];
        for await (const event of agent.stream('continue carried context'))
          events.push(event);
        expect(events.some((event) => event.type === 'error')).toBe(false);
        const recoveredHistory = JSON.stringify(await agent.getHistory());
        expect(recoveredHistory).toContain('carried context');
        expect(
          recoveredHistory.split('/workspace/kept-editor.ts').length - 1,
        ).toBe(1);
        await agent.profiles.applySnapshot(profile);
        expect(agent.getProvider()).toBe('replacement');
        expect(agent.getModel()).toBe('candidate');
      } finally {
        if (priorIde) ideContext.setIdeContext(priorIde);
        else ideContext.clearIdeContext();
        boundary.mockRestore();
        await ownerB.dispose();
        await agent.dispose();
        await otherCallerClose();
        contextReader.mockRestore();
        await builtCallerClose();
      }
    },
    30000,
  );

  it('disposal after candidate chat creation discards the owned candidate and retains the borrowed client', async () => {
    await openbuiltCaller('multi-turn-text.jsonl');
    const agent = await fromConfig({
      settingsOwner: builtCallerSettingsOwner,
      settingsService: builtCallerSettings,
      agentClient: builtCallerOwner.getAgentClient(),
      providerManager: builtCallerManager,
      config: builtCallerConfig,
      mcpRuntime: builtCallerMcp,
      messageBus: builtCallerPolicy.session.messageBus,
    });
    const client = builtCallerOwner.getAgentClient();
    const provider = new FakeProvider(
      fileURLToPath(
        new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
      ),
      builtCallerConfig.getTargetDir(),
    );
    provider.name = 'replacement';
    builtCallerManager.registerProvider(provider);
    await client.storeHistoryForLaterUse([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'still owned by caller' }],
      },
    ]);
    const history = await agent.getHistory();
    const listeners = builtCallerSettingsOwner['modelNotifications'].listeners(
      CoreEvent.ModelChanged,
    );
    let reads = 0;
    let disposal: Promise<void> | undefined;
    const boundary = vi
      .spyOn(builtCallerConfig, 'isInteractive')
      .mockImplementation(() => {
        if (++reads === 3) disposal = agent.dispose();
        return true;
      });
    try {
      await expect(
        agent.profiles.applySnapshot({
          version: 1,
          provider: 'replacement',
          model: 'discarded',
          modelParams: {},
          ephemeralSettings: {},
        }),
      ).rejects.toThrow('cancelled');
      boundary.mockRestore();
      expect(disposal).toBeDefined();
      await disposal;
      expect(new Set([client, builtCallerOwner.getAgentClient()]).size).toBe(1);
      expect(client.hasChatInitialized()).toBe(true);
      expect(await client.getHistory()).toStrictEqual(history);
      expect(
        builtCallerSettingsOwner['modelNotifications'].listeners(
          CoreEvent.ModelChanged,
        ),
      ).toStrictEqual(listeners);
      const nextOwner = await fromConfig({
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        config: builtCallerConfig,
        mcpRuntime: builtCallerMcp,
        messageBus: builtCallerPolicy.session.messageBus,
      });
      try {
        const events = [];
        for await (const event of nextOwner.stream('continue'))
          events.push(event);
        expect(events.some((event) => event.type === 'error')).toBe(false);
      } finally {
        await nextOwner.dispose();
      }
    } finally {
      boundary.mockRestore();
      await disposal;
      await agent.dispose();
      await builtCallerClose();
    }
  }, 30000);
});

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
