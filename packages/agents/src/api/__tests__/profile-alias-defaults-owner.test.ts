import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
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
  writeProviderAliasConfig,
  loadProviderAliasEntries,
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
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { TokenStore } from '@vybestack/llxprt-code-auth';
import {
  ProfileDefinitionReads,
  ProfileDefinitionWrites,
  ProviderSwitcher,
} from '@vybestack/llxprt-code-core';
import {
  assembleProfileApplication,
  type AgentProfileApplication,
} from '../profileApplicationAssembly.js';
import { setActiveModel } from '../providerMutations.js';
import { standardProfile } from './helpers/profile-owner-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Profile alias default ownership', () => {
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

  afterEach(async () => {
    await runCleanupSteps([() => profileOAuth.dispose(), () => callerClose()]);
  });

  const credentials = useOwnedCredentials();
  let callerConfig: Config;
  let callerSettings: SettingsService;
  let callerSettingsOwner: SessionSettingsOwner;
  let callerPolicy: RuntimePolicyOwner;
  let callerMcp: McpRuntimeOwner;
  let callerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let callerOwner: SessionClientOwner;
  let callerClose: () => Promise<void>;
  const callerFactories = createAgentRuntimeFactoryBindings();
  let callerRelease: AcquisitionRelease;
  let callerFiles: ProviderFileLifecycle;
  let callerRuntimeId: string;
  let callerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let callerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let callerContent: ReturnType<typeof createRuntimeContentGeneratorFactory>;

  async function openCaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'caller-adoption-')),
    );
    callerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    callerSettings = new SettingsService();
    callerPolicy = new RuntimePolicyOwner(callerConfig);
    injectConfirmationForcingPolicy(callerPolicy.session.confirmation);
    callerMcp = await buildTestMcpRuntime(
      callerConfig,
      callerPolicy.session.messageBus,
      {},
      undefined,
      callerPolicy,
    );
    acquireCallerProviders();
    const media = new SessionMediaOwner(
      callerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    callerOwner = await SessionClientOwner.create(
      callerConfig,
      assembleTaskSchemaPolicy(callerSettings),
      callerManager,
      callerFactories.agentClientFactory,
      media.store,
      callerMcp.readInstructions,
      callerMcp.workspacePaths,
      callerSettingsOwner,
      callerContent,
      callerTokenizer,
    );
    callerOwner.bindMcpRuntime(callerMcp);
    callerOwner.bindProviderFiles(callerFiles, (provider) =>
      callerOAuth.composeRetryOperations(provider),
    );
    callerOwner.bindHooks();
    callerClose = settleEngineRelease.bind(
      undefined,
      [
        () => callerOwner.dispose(),
        () => callerRelease.close(),
        () => media.dispose(),
        () => callerMcp.dispose(),
        () => callerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        callerConfig,
        callerSettings,
        callerSettingsOwner,
        callerManager,
        callerOAuth,
        callerRuntimeId,
        callerTokenizer,
        undefined,
      );
      await callerMcp.initialize();
      await activateCallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, callerClose);
    }
  }
  function acquireCallerProviders(): void {
    callerRuntimeId = 'caller-' + randomUUID();
    callerRelease = new AcquisitionRelease();
    callerSettingsOwner = new SessionSettingsOwner(callerSettings);
    callerRelease.acquire('settings', () => callerSettingsOwner.dispose());
    callerSettingsOwner.initializeProviderSelection(
      callerConfig.getProvider(),
      callerConfig.getModel(),
    );
    callerSettingsOwner.bindTelemetry(callerConfig);
    callerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [callerRuntimeId, callerConfig.getSessionId()])
      callerRelease.acquire('files', () =>
        releaseAdoptedFileScope(callerFiles, scope),
      );
    callerManager = acquirePreferredProviderManager(
      callerConfig,
      callerSettings,
      callerSettingsOwner,
      callerFiles,
      callerRuntimeId,
      credentials().authority,
      callerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(callerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    callerTokenizer = factoriesTokenizer;
    callerContent = factoriesContent;
    callerOAuth = acquirePreferredOAuth(
      undefined,
      callerPolicy.session.messageBus,
      callerConfig,
      callerSettings,
      callerManager,
      callerRuntimeId,
      callerMcp.profileDefinitions,
      credentials().authority,
      callerRelease,
      undefined,
    );
  }
  async function activateCallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      callerConfig,
      { provider: callerConfig.getProvider(), model: callerConfig.getModel() },
      assembleProviderSwitch(
        callerConfig,
        callerSettings,
        callerManager,
        callerOAuth,
        () => 'agent',
        () => callerOwner.refreshAuth(),
        callerSettingsOwner,
      ),
      callerSettings,
      callerManager,
      (method) => callerOwner.refreshAuth(method),
      assembleModelSelection(callerSettingsOwner),
    );
    requireCallerActivation(activation);
    await callerOwner.initializeTools();
    await callerOwner.getAgentClient().startChat();
  }

  let profileStore: ProfileDefinitionReads & ProfileDefinitionWrites;
  let profileOAuth: OAuthManager;
  let profileSwitch: ProviderSwitcher;
  let profileApplication: AgentProfileApplication;
  let profileAuthenticationRequests: string[];
  beforeEach(async () => {
    await openCaller('plain-text.jsonl');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const providers = new Map<string, FakeProvider>();
    for (const name of ['openai', 'anthropic', 'gemini', 'zai', 'openrouter']) {
      const provider = new FakeProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        callerConfig.getTargetDir(),
      );
      provider.name = name;
      provider.baseProviderConfig = { baseURL: '' };
      callerManager.registerProvider(provider);
      providers.set(name, provider);
    }

    profileStore = {
      ...callerMcp.profileDefinitions,
      ...callerMcp.profileWrites,
    };
    profileOAuth = new OAuthManager(emptyTokenStore(), undefined, {
      config: callerConfig,
      messageBus: callerPolicy.session.messageBus,
    });
    profileAuthenticationRequests = [];
    for (const name of providers.keys())
      profileOAuth.registerProvider({
        name,
        initiateAuth: async () => {
          profileAuthenticationRequests.push(name);
          throw new Error('Unexpected interactive authentication');
        },
        getToken: async () => null,
        refreshToken: async () => null,
      });
    profileSwitch = assembleProviderSwitch(
      callerConfig,
      callerSettings,
      callerManager,
      profileOAuth,
      () => undefined,
      () => callerOwner.refreshAuth(),
      callerSettingsOwner,
    );
    profileApplication = assembleProfileApplication(
      callerSettings,
      callerManager,
      profileOAuth,
      profileSwitch,
      callerSettingsOwner,
      profileStore,
    );
  });

  it('resolves profile values over shipped Opus 5 alias defaults', async () => {
    const shipped = loadProviderAliasEntries().find(
      (entry) => entry.alias === 'anthropic' && entry.source === 'builtin',
    );
    if (!shipped) throw new Error('Missing builtin anthropic alias');
    writeProviderAliasConfig('anthropic', shipped.config);
    const values = {
      'reasoning.effortWireFormat': 'openai',
      'reasoning.enabledWireFormat': 'openrouter',
      'reasoning.effortMap': { low: 'profile-low' },
      'reasoning.enabledMap': { false: null },
    };
    await profileApplication.applySnapshot({
      ...standardProfile(values),
      model: 'claude-opus-5',
    });
    for (const [key, value] of Object.entries(values))
      expect(callerSettingsOwner.readNamedParameter(key)).toStrictEqual(value);
  });

  it('applies target model defaults without leaking old provider values', async () => {
    const application = profileApplication;
    callerSettingsOwner.writeUserParameter(
      'reasoning.effortWireFormat',
      'openai-responses',
    );
    callerSettingsOwner.writeUserParameter(
      'reasoning.enabledWireFormat',
      'thinking',
    );
    callerSettingsOwner.writeUserParameter('reasoning.effortMap', {
      low: 'old-provider-low',
    });
    callerSettingsOwner.writeUserParameter('reasoning.enabledMap', {
      false: null,
    });
    writeProviderAliasConfig('anthropic', {
      baseProvider: 'anthropic',
      ephemeralSettings: {
        'reasoning.effortWireFormat': 'openrouter',
        'reasoning.enabledWireFormat': 'openrouter',
      },
      modelDefaults: [
        {
          pattern: '^claude-opus-4-6$',
          ephemeralSettings: {
            'reasoning.effortWireFormat': 'anthropic',
            'reasoning.effortMap': { high: 'model-high' },
          },
        },
      ],
    });
    await application.applySnapshot({
      ...standardProfile(),
      model: 'claude-opus-4-6',
    });
    expect(
      callerSettingsOwner.readNamedParameter('reasoning.effortWireFormat'),
    ).toBe('anthropic');
    expect(
      callerSettingsOwner.readNamedParameter('reasoning.enabledWireFormat'),
    ).toBe('openrouter');
    expect(
      callerSettingsOwner.readNamedParameter('reasoning.effortMap'),
    ).toStrictEqual({
      high: 'model-high',
    });
    expect(
      callerSettingsOwner.readNamedParameter('reasoning.enabledMap'),
    ).toBeUndefined();
  });

  it('keeps an explicit profile selector equal to the old default through later model changes', async () => {
    const settings = callerSettings;
    const application = profileApplication;
    writeProviderAliasConfig('zai', {
      baseProvider: 'anthropic',
      modelDefaults: [
        {
          pattern: '^glm-5\\.2$',
          ephemeralSettings: { 'reasoning.effortWireFormat': 'anthropic' },
        },
      ],
    });
    await application.applySnapshot({
      ...standardProfile({ 'reasoning.effortWireFormat': 'anthropic' }),
      provider: 'zai',
      model: 'glm-5.2',
    });
    await setActiveModel(
      'glm-5.4',
      assembleModelSelection(callerSettingsOwner),
      settings,
      callerManager.getActiveProvider(),
    );
    expect(callerSettingsOwner.readSelectedModel()).toBe('glm-5.4');
    expect(
      callerSettingsOwner.readNamedParameter('reasoning.effortWireFormat'),
    ).toBe('anthropic');
  });

  it('keeps an explicit profile selector through a later provider switch', async () => {
    const application = profileApplication;
    const switchProvider = profileSwitch;
    writeProviderAliasConfig('anthropic', {
      baseProvider: 'anthropic',
      ephemeralSettings: { 'reasoning.enabledWireFormat': 'thinking' },
    });
    writeProviderAliasConfig('openrouter', {
      baseProvider: 'openai',
      ephemeralSettings: { 'reasoning.enabledWireFormat': 'openrouter' },
    });
    await application.applySnapshot(
      standardProfile({ 'reasoning.enabledWireFormat': 'thinking' }),
    );
    expect(
      callerSettingsOwner.readNamedParameter('reasoning.enabledWireFormat'),
    ).toBe('thinking');
    await switchProvider('openrouter');
    expect(callerManager.getActiveProviderName()).toBe('openrouter');
    expect(
      callerSettingsOwner.readNamedParameter('reasoning.enabledWireFormat'),
    ).toBe('thinking');
  });

  it('keeps explicit profile maps equal to provider defaults through model changes', async () => {
    const settings = callerSettings;
    const application = profileApplication;
    writeProviderAliasConfig('anthropic', {
      baseProvider: 'anthropic',
      ephemeralSettings: { 'reasoning.effortMap': { high: 'provider-high' } },
      modelDefaults: [
        {
          pattern: '^claude-opus-4-6$',
          ephemeralSettings: { 'reasoning.effortMap': { high: 'model-high' } },
        },
      ],
    });
    await application.applySnapshot({
      ...standardProfile({ 'reasoning.effortMap': { high: 'provider-high' } }),
      model: 'claude-sonnet-4-5-20250929',
    });
    await setActiveModel(
      'claude-opus-4-6',
      assembleModelSelection(callerSettingsOwner),
      settings,
      callerManager.getActiveProvider(),
    );
    expect(
      callerSettingsOwner.readNamedParameter('reasoning.effortMap'),
    ).toStrictEqual({
      high: 'provider-high',
    });
  });
});

function emptyTokenStore(): TokenStore {
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected token store mutation');
  };
  return {
    getToken: async () => null,
    saveToken: unexpected,
    removeToken: unexpected,
    listProviders: async () => [],
    listBuckets: async () => [],
    getBucketStats: unexpected,
    acquireRefreshLock: unexpected,
    releaseRefreshLock: unexpected,
    acquireAuthLock: unexpected,
    releaseAuthLock: unexpected,
  };
}
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
