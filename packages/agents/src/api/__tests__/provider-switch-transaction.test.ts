import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
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
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
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
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
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

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function replacement(workingDir: string): FakeProvider {
  const provider = new FakeProvider(
    fileURLToPath(new URL('./fixtures/multi-turn-text.jsonl', import.meta.url)),
    workingDir,
  );
  provider.name = 'replacement';
  return provider;
}

describe('provider switch transaction ownership', () => {
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

  const firstCredentials = useOwnedCredentials();
  let firstCallerConfig: Config;
  let firstCallerSettings: SettingsService;
  let firstCallerSettingsOwner: SessionSettingsOwner;
  let firstCallerPolicy: RuntimePolicyOwner;
  let firstCallerMcp: McpRuntimeOwner;
  let firstCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let firstCallerOwner: SessionClientOwner;
  let firstCallerClose: () => Promise<void>;
  let firstCallerFactories: AgentRuntimeFactoryBindings;
  let firstCallerRelease: AcquisitionRelease;
  let firstCallerFiles: ProviderFileLifecycle;
  let firstCallerRuntimeId: string;
  let firstCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let firstCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let firstCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function openfirstCaller(
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
      await mkdtemp(join(tmpdir(), 'firstCaller-adoption-')),
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
    firstCallerConfig = new Config(parameters);
    firstCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    firstCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      firstCallerConfig.getInitialSettings(),
    ))
      firstCallerSettings.set(key, value);
    firstCallerPolicy = new RuntimePolicyOwner(firstCallerConfig);
    injectConfirmationForcingPolicy(firstCallerPolicy.session.confirmation);
    firstCallerMcp = await buildTestMcpRuntime(
      firstCallerConfig,
      firstCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      firstCallerPolicy,
      skillOperations,
    );
    acquirefirstCallerProviders();
    const media = new SessionMediaOwner(
      firstCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    firstCallerOwner = await SessionClientOwner.create(
      firstCallerConfig,
      assembleTaskSchemaPolicy(firstCallerSettings),
      firstCallerManager,
      firstCallerFactories.agentClientFactory,
      media.store,
      firstCallerMcp.readInstructions,
      firstCallerMcp.workspacePaths,
      firstCallerSettingsOwner,
      firstCallerContent,
      firstCallerTokenizer,
    );
    firstCallerOwner.bindMcpRuntime(firstCallerMcp);
    firstCallerOwner.bindProviderFiles(firstCallerFiles, (provider) =>
      firstCallerOAuth.composeRetryOperations(provider),
    );
    firstCallerOwner.bindHooks();
    firstCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => firstCallerOwner.dispose(),
        () => firstCallerRelease.close(),
        () => media.dispose(),
        () => firstCallerMcp.dispose(),
        () => firstCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerSettingsOwner,
        firstCallerManager,
        firstCallerOAuth,
        firstCallerRuntimeId,
        firstCallerTokenizer,
        undefined,
      );
      await firstCallerMcp.initialize();
      await activatefirstCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, firstCallerClose);
    }
  }
  function acquirefirstCallerProviders(): void {
    firstCallerRuntimeId = 'firstCaller-' + randomUUID();
    firstCallerRelease = new AcquisitionRelease();
    firstCallerSettingsOwner = new SessionSettingsOwner(firstCallerSettings);
    firstCallerRelease.acquire('settings', () =>
      firstCallerSettingsOwner.dispose(),
    );
    firstCallerSettingsOwner.initializeProviderSelection(
      firstCallerConfig.getProvider(),
      firstCallerConfig.getModel(),
    );
    firstCallerSettingsOwner.bindTelemetry(firstCallerConfig);
    firstCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      firstCallerRuntimeId,
      firstCallerConfig.getSessionId(),
    ])
      firstCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(firstCallerFiles, scope),
      );
    firstCallerManager = acquirePreferredProviderManager(
      firstCallerConfig,
      firstCallerSettings,
      firstCallerSettingsOwner,
      firstCallerFiles,
      firstCallerRuntimeId,
      firstCredentials().authority,
      firstCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(firstCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    firstCallerTokenizer = factoriesTokenizer;
    firstCallerContent = factoriesContent;
    firstCallerOAuth = acquirePreferredOAuth(
      undefined,
      firstCallerPolicy.session.messageBus,
      firstCallerConfig,
      firstCallerSettings,
      firstCallerManager,
      firstCallerRuntimeId,
      firstCallerMcp.profileDefinitions,
      firstCredentials().authority,
      firstCallerRelease,
      undefined,
    );
  }
  async function activatefirstCallerClient(
    intent: ProviderActivationIntent = {
      provider: firstCallerConfig.getProvider(),
      model: firstCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      firstCallerConfig,
      intent,
      assembleProviderSwitch(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerManager,
        firstCallerOAuth,
        () => 'agent',
        () => firstCallerOwner.refreshAuth(),
        firstCallerSettingsOwner,
      ),
      firstCallerSettings,
      firstCallerManager,
      (method) => firstCallerOwner.refreshAuth(method),
      assembleModelSelection(firstCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await firstCallerOwner.initializeTools();
    await firstCallerOwner.getAgentClient().startChat();
  }

  const secondCredentials = useOwnedCredentials();
  let secondCallerConfig: Config;
  let secondCallerSettings: SettingsService;
  let secondCallerSettingsOwner: SessionSettingsOwner;
  let secondCallerPolicy: RuntimePolicyOwner;
  let secondCallerMcp: McpRuntimeOwner;
  let secondCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let secondCallerOwner: SessionClientOwner;
  let secondCallerClose: () => Promise<void>;
  let secondCallerFactories: AgentRuntimeFactoryBindings;
  let secondCallerRelease: AcquisitionRelease;
  let secondCallerFiles: ProviderFileLifecycle;
  let secondCallerRuntimeId: string;
  let secondCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let secondCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let secondCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function opensecondCaller(
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
      await mkdtemp(join(tmpdir(), 'secondCaller-adoption-')),
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
    secondCallerConfig = new Config(parameters);
    secondCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    secondCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      secondCallerConfig.getInitialSettings(),
    ))
      secondCallerSettings.set(key, value);
    secondCallerPolicy = new RuntimePolicyOwner(secondCallerConfig);
    injectConfirmationForcingPolicy(secondCallerPolicy.session.confirmation);
    secondCallerMcp = await buildTestMcpRuntime(
      secondCallerConfig,
      secondCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      secondCallerPolicy,
      skillOperations,
    );
    acquiresecondCallerProviders();
    const media = new SessionMediaOwner(
      secondCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    secondCallerOwner = await SessionClientOwner.create(
      secondCallerConfig,
      assembleTaskSchemaPolicy(secondCallerSettings),
      secondCallerManager,
      secondCallerFactories.agentClientFactory,
      media.store,
      secondCallerMcp.readInstructions,
      secondCallerMcp.workspacePaths,
      secondCallerSettingsOwner,
      secondCallerContent,
      secondCallerTokenizer,
    );
    secondCallerOwner.bindMcpRuntime(secondCallerMcp);
    secondCallerOwner.bindProviderFiles(secondCallerFiles, (provider) =>
      secondCallerOAuth.composeRetryOperations(provider),
    );
    secondCallerOwner.bindHooks();
    secondCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => secondCallerOwner.dispose(),
        () => secondCallerRelease.close(),
        () => media.dispose(),
        () => secondCallerMcp.dispose(),
        () => secondCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerSettingsOwner,
        secondCallerManager,
        secondCallerOAuth,
        secondCallerRuntimeId,
        secondCallerTokenizer,
        undefined,
      );
      await secondCallerMcp.initialize();
      await activatesecondCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, secondCallerClose);
    }
  }
  function acquiresecondCallerProviders(): void {
    secondCallerRuntimeId = 'secondCaller-' + randomUUID();
    secondCallerRelease = new AcquisitionRelease();
    secondCallerSettingsOwner = new SessionSettingsOwner(secondCallerSettings);
    secondCallerRelease.acquire('settings', () =>
      secondCallerSettingsOwner.dispose(),
    );
    secondCallerSettingsOwner.initializeProviderSelection(
      secondCallerConfig.getProvider(),
      secondCallerConfig.getModel(),
    );
    secondCallerSettingsOwner.bindTelemetry(secondCallerConfig);
    secondCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      secondCallerRuntimeId,
      secondCallerConfig.getSessionId(),
    ])
      secondCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(secondCallerFiles, scope),
      );
    secondCallerManager = acquirePreferredProviderManager(
      secondCallerConfig,
      secondCallerSettings,
      secondCallerSettingsOwner,
      secondCallerFiles,
      secondCallerRuntimeId,
      secondCredentials().authority,
      secondCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(secondCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    secondCallerTokenizer = factoriesTokenizer;
    secondCallerContent = factoriesContent;
    secondCallerOAuth = acquirePreferredOAuth(
      undefined,
      secondCallerPolicy.session.messageBus,
      secondCallerConfig,
      secondCallerSettings,
      secondCallerManager,
      secondCallerRuntimeId,
      secondCallerMcp.profileDefinitions,
      secondCredentials().authority,
      secondCallerRelease,
      undefined,
    );
  }
  async function activatesecondCallerClient(
    intent: ProviderActivationIntent = {
      provider: secondCallerConfig.getProvider(),
      model: secondCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      secondCallerConfig,
      intent,
      assembleProviderSwitch(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerManager,
        secondCallerOAuth,
        () => 'agent',
        () => secondCallerOwner.refreshAuth(),
        secondCallerSettingsOwner,
      ),
      secondCallerSettings,
      secondCallerManager,
      (method) => secondCallerOwner.refreshAuth(method),
      assembleModelSelection(secondCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await secondCallerOwner.initializeTools();
    await secondCallerOwner.getAgentClient().startChat();
  }

  it('rejects replacement failure and restores the switching owner without disturbing a successful same-label sibling', async () => {
    await openfirstCaller('multi-turn-text.jsonl');
    await opensecondCaller('multi-turn-text.jsonl');
    firstCallerConfig.adoptSessionId('same-label');
    secondCallerConfig.adoptSessionId('same-label');
    const a = await fromConfig({
      settingsOwner: firstCallerSettingsOwner,
      settingsService: firstCallerSettings,
      agentClient: firstCallerOwner.getAgentClient(),
      providerManager: firstCallerManager,
      config: firstCallerConfig,
      mcpRuntime: firstCallerMcp,
      messageBus: firstCallerPolicy.session.messageBus,
    });
    const b = await fromConfig({
      settingsOwner: secondCallerSettingsOwner,
      settingsService: secondCallerSettings,
      agentClient: secondCallerOwner.getAgentClient(),
      providerManager: secondCallerManager,
      config: secondCallerConfig,
      mcpRuntime: secondCallerMcp,
      messageBus: secondCallerPolicy.session.messageBus,
    });
    const managerA = firstCallerManager;
    const managerB = secondCallerManager;

    managerA.registerProvider(replacement(firstCallerConfig.getTargetDir()));
    managerB.registerProvider(replacement(secondCallerConfig.getTargetDir()));
    const settingsA = firstCallerSettings;
    firstCallerSettingsOwner.writeUserParameter('auth-key', 'first-owner-key');
    firstCallerSettingsOwner.writeUserParameter('reasoning.enabled', false);
    const originalProvider = managerA.getProviderByName('fake');
    if (!originalProvider) throw new Error('Missing original fixture provider');
    const before = {
      settings: structuredClone(settingsA.exportForStateSnapshot()),
      provider: originalProvider,
      client: firstCallerOwner.getAgentClient(),
    };
    const ephemerals = structuredClone(
      firstCallerSettingsOwner.captureNamedParameters(),
    );
    const failure = new Error('owner client replacement rejected');
    let started = (): void => {};
    let release = (): void => {};
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rejectInitialization = async (): Promise<void> => {
      started();
      await gate;
      throw failure;
    };
    const switchA = assembleProviderSwitch(
      firstCallerConfig,
      settingsA,
      managerA,
      null,
      () => 'agent',
      rejectInitialization,
      firstCallerSettingsOwner,
    );
    const switchB = assembleProviderSwitch(
      secondCallerConfig,
      secondCallerSettings,
      managerB,
      null,
      () => 'subagent',
      () => secondCallerOwner.refreshAuth(),
      secondCallerSettingsOwner,
    );
    try {
      const pending = switchA('replacement');
      const observed = pending.then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      await entered;
      const sibling = await switchB('replacement');
      expect(sibling.changed).toBe(true);
      const siblingState = {
        global: {
          activeProvider: 'replacement',
          'base-url': 'http://fake-provider.local',
        },
        providers: {
          fake: { model: undefined },
          replacement: {
            'base-url': 'http://fake-provider.local',
            model: 'fake-model',
          },
        },
      };
      release();
      expect(await observed).toStrictEqual({ error: failure });
      expect(settingsA.exportForStateSnapshot()).toStrictEqual(before.settings);
      expect(firstCallerSettingsOwner.captureNamedParameters()).toStrictEqual(
        ephemerals,
      );
      expect(managerA.getActiveProvider()).toBe(before.provider);
      expect(firstCallerOwner.getAgentClient()).toBe(before.client);
      const siblingSnapshot = secondCallerSettings.exportForStateSnapshot();
      expect({
        global: siblingSnapshot.global,
        providers: Object.fromEntries(
          Object.entries(siblingSnapshot.providers).map(([name, values]) => [
            name,
            { ...values },
          ]),
        ),
        ...('tools' in siblingSnapshot ? { tools: siblingSnapshot.tools } : {}),
      }).toStrictEqual(siblingState);
      for await (const event of a.stream('Continue on the restored owner')) {
        if (event.type === 'error') throw new Error(event.error.message);
      }
      for await (const event of b.stream('Continue on the committed sibling')) {
        if (event.type === 'error') throw new Error(event.error.message);
      }
      expect(JSON.stringify(await a.getHistory())).toContain('restored owner');
      expect(JSON.stringify(await b.getHistory())).toContain(
        'committed sibling',
      );
    } finally {
      release();
      await a.dispose();
      await b.dispose();
      await firstCallerClose();
      await secondCallerClose();
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
