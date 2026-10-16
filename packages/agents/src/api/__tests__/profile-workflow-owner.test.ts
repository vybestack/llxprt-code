import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  writeProviderAliasConfig,
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
  vi,
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
import { standardProfile } from './helpers/profile-owner-fixture.js';
import { applyProfileCascade } from '../profileApplication.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Profile cascade workflow at the owner', () => {
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

  let profileProviders: ReadonlyMap<string, FakeProvider>;
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
    profileProviders = providers;
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

  it('sets keyfile ephemeral and provider credential before switching', async () => {
    const directory = callerConfig.getTargetDir();
    const settings = callerSettings;
    const manager = callerManager;
    const oauth = profileOAuth;
    const store = profileStore;
    const switchProvider = profileSwitch;
    const keyfile = join(directory, 'key');
    await writeFile(keyfile, ' file-key\n');
    const observed: unknown[] = [];
    const application = assembleProfileApplication(
      settings,
      manager,
      oauth,
      async (name, options) => {
        observed.push({
          keyfile: callerSettingsOwner.readNamedParameter('auth-keyfile'),
          key: settings.getProviderSettings(name)['auth-key'],
        });
        return switchProvider(name, options);
      },
      callerSettingsOwner,
      store,
    );
    await application.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile }),
    );
    expect(observed).toStrictEqual([{ keyfile, key: 'file-key' }]);
  });

  it('sets base-url in ephemeral and provider settings before switching', async () => {
    const settings = callerSettings;
    const manager = callerManager;
    const oauth = profileOAuth;
    const store = profileStore;
    const switchProvider = profileSwitch;
    const observed: unknown[] = [];
    const application = assembleProfileApplication(
      settings,
      manager,
      oauth,
      async (name, options) => {
        observed.push([
          callerSettingsOwner.readNamedParameter('base-url'),
          settings.getProviderSettings(name)['base-url'],
        ]);
        return switchProvider(name, options);
      },
      callerSettingsOwner,
      store,
    );
    await application.applySnapshot(
      standardProfile({ 'base-url': 'https://custom.api.com/v1' }),
    );
    expect(observed).toStrictEqual([
      ['https://custom.api.com/v1', 'https://custom.api.com/v1'],
    ]);
  });

  it('resolves auth-key-name from secure storage and preserves the reference', async () => {
    const storage = vi
      .spyOn(callerConfig.getProviderKeys(), 'getKey')
      .mockResolvedValue(' named-credential ');
    try {
      await profileApplication.applySnapshot(
        standardProfile({ 'auth-key-name': 'chutes' }),
      );
      expect(callerSettingsOwner.readNamedParameter('auth-key-name')).toBe(
        'chutes',
      );
      expect(
        callerSettingsOwner.readNamedParameter('auth-key'),
      ).toBeUndefined();
      expect(callerSettings.getProviderSettings('anthropic')['auth-key']).toBe(
        'named-credential',
      );
    } finally {
      storage.mockRestore();
    }
  });

  it('applies the issue 2477 Z.ai profile without Gemini fallback', async () => {
    const storage = vi
      .spyOn(callerConfig.getProviderKeys(), 'getKey')
      .mockResolvedValue(' zai-key ');
    try {
      const result = await profileApplication.applySnapshot({
        ...standardProfile({
          'auth-key-name': 'zai',
          'base-url': 'https://api.z.ai/api/anthropic',
        }),
        model: 'glm-5.2',
      });
      expect(result).toMatchObject({
        providerName: 'anthropic',
        modelName: 'glm-5.2',
        baseUrl: 'https://api.z.ai/api/anthropic',
      });
      expect(callerManager.getActiveProviderName()).toBe('anthropic');
      expect(callerSettingsOwner.readSelectedModel()).toBe('glm-5.2');
      expect(callerSettingsOwner.readNamedParameter('auth-key-name')).toBe(
        'zai',
      );
      expect(callerSettings.getProviderSettings('anthropic')['auth-key']).toBe(
        'zai-key',
      );
      expect(
        result.warnings.some((warning) => warning.includes('fallback')),
      ).toBe(false);
    } finally {
      storage.mockRestore();
    }
  });

  it('sets GCP project and location as owner ephemerals without changing the environment', async () => {
    await profileApplication.applySnapshot(
      standardProfile({
        GOOGLE_CLOUD_PROJECT: 'my-project',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
      }),
    );
    for (const [key, value] of Object.entries({
      GOOGLE_CLOUD_PROJECT: 'my-project',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
    })) {
      expect(callerSettingsOwner.readNamedParameter(key)).toBe(value);
      expect(process.env[key]).not.toBe(value);
    }
  });

  it('falls back to the direct key when the keyfile is empty', async () => {
    const keyfile = join(callerConfig.getTargetDir(), 'empty');
    await writeFile(keyfile, ' \n');
    await profileApplication.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile, 'auth-key': 'fallback-key' }),
    );
    expect(callerSettingsOwner.readNamedParameter('auth-key')).toBe(
      'fallback-key',
    );
    expect(callerSettings.getProviderSettings('anthropic')['auth-key']).toBe(
      'fallback-key',
    );
  });

  it('applies non-auth ephemeral settings after provider switching', async () => {
    await profileApplication.applySnapshot(
      standardProfile({
        'context-limit': 200000,
        streaming: 'enabled',
        'custom-setting': 'value',
      }),
    );
    expect(callerSettingsOwner.readNamedParameter('context-limit')).toBe(
      200000,
    );
    expect(callerSettingsOwner.readNamedParameter('streaming')).toBe('enabled');
    expect(callerSettingsOwner.readNamedParameter('custom-setting')).toBe(
      'value',
    );
  });

  it('keeps explicit context-limit after real model default recomputation', async () => {
    writeProviderAliasConfig('anthropic', {
      baseProvider: 'anthropic',
      modelDefaults: [
        {
          pattern: '^default-model$',
          ephemeralSettings: { 'context-limit': 4096 },
        },
      ],
    });
    await profileApplication.applySnapshot({
      ...standardProfile({ 'context-limit': 200000 }),
      model: 'default-model',
    });
    expect(callerSettingsOwner.readNamedParameter('context-limit')).toBe(
      200000,
    );
  });

  it('does not reinstall sensitive auth ephemerals during non-auth application', async () => {
    const keyfile = join(callerConfig.getTargetDir(), 'secret');
    await writeFile(keyfile, 'private-key');
    await profileApplication.applySnapshot(
      standardProfile({
        'auth-keyfile': keyfile,
        'context-limit': 100000,
        'base-url': 'https://example.invalid',
        GOOGLE_CLOUD_PROJECT: 'project',
        GOOGLE_CLOUD_LOCATION: 'location',
      }),
    );
    expect(callerSettingsOwner.readNamedParameter('auth-key')).toBeUndefined();
    expect(callerSettingsOwner.readNamedParameter('auth-keyfile')).toBe(
      keyfile,
    );
    expect(callerSettingsOwner.readNamedParameter('context-limit')).toBe(
      100000,
    );
    expect(callerSettingsOwner.readNamedParameter('base-url')).toBe(
      'https://example.invalid',
    );
    expect(callerSettingsOwner.readNamedParameter('GOOGLE_CLOUD_PROJECT')).toBe(
      'project',
    );
    expect(
      callerSettingsOwner.readNamedParameter('GOOGLE_CLOUD_LOCATION'),
    ).toBe('location');
  });

  it('clears old ephemerals omitted from the next profile', async () => {
    await profileApplication.applySnapshot(
      standardProfile({ 'old-setting': 'stale', 'context-limit': 200000 }),
    );
    await profileApplication.applySnapshot(
      standardProfile({ streaming: 'enabled' }),
    );
    expect(
      callerSettingsOwner.readNamedParameter('old-setting'),
    ).toBeUndefined();
    expect(
      callerSettingsOwner.readNamedParameter('context-limit'),
    ).toBeUndefined();
    expect(callerSettingsOwner.readNamedParameter('streaming')).toBe('enabled');
  });

  it('sets the requested model and returns it', async () => {
    const result = await profileApplication.applySnapshot({
      ...standardProfile(),
      model: 'gpt-4o-mini',
    });
    expect(result.modelName).toBe('gpt-4o-mini');
    expect(callerSettingsOwner.readSelectedModel()).toBe('gpt-4o-mini');
  });

  it('falls back to the provider default when the profile model is empty', async () => {
    const result = await profileApplication.applySnapshot({
      ...standardProfile(),
      model: '',
    });
    expect(result.modelName).toBe('fake-model');
    expect(result.modelName.length).toBeGreaterThan(0);
    expect(callerSettingsOwner.readSelectedModel()).toBe(result.modelName);
  });

  it('applies model parameters and clears stale parameters', async () => {
    await profileApplication.applySnapshot({
      ...standardProfile(),
      modelParams: { temperature: 0.5, max_tokens: 1000, 'old-param': 'stale' },
    });
    await profileApplication.applySnapshot({
      ...standardProfile(),
      modelParams: { temperature: 0.9, 'top-p': 0.95 },
    });
    const settings = callerSettings.getProviderSettings('anthropic');
    expect(settings).toMatchObject({ temperature: 0.9, 'top-p': 0.95 });
    expect(settings.max_tokens).toBeUndefined();
    expect(settings['old-param']).toBeUndefined();
  });

  it('includes the selected model info message', async () => {
    const result = await profileApplication.applySnapshot({
      ...standardProfile(),
      model: 'gpt-4o-mini',
      provider: 'openai',
    });
    expect(result.infoMessages).toContain(
      "Model set to 'gpt-4o-mini' for provider 'openai'.",
    );
  });

  it('rejects a missing model when neither the provider nor config supplies a default', async () => {
    const settings = callerSettings;
    const store = profileStore;
    const providers = profileProviders;
    const provider = providers.get('anthropic');
    if (!provider) throw new Error('Missing fixture provider');
    provider.name = 'no-default';
    provider.getDefaultModel = () => '';
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      callerSettings,
    );
    manager.registerProvider(provider);
    manager.setActiveProvider('no-default');
    configureProviderTokenizer(manager);
    callerSettingsOwner.chooseModel('');
    await expect(
      applyProfileCascade(
        { ...standardProfile(), provider: 'no-default', model: '' },
        {},
        settings,
        manager,
        store,
        async () => ({
          changed: false,
          infoMessages: [],
          previousProvider: 'no-default',
          nextProvider: 'no-default',
        }),
        assembleModelSelection(callerSettingsOwner),
        {
          readEndpoint: () =>
            callerSettingsOwner.readNamedParameter('base-url'),
          applyParameter: (key, value) =>
            callerSettingsOwner.writeUserParameter(key, value),
        },
        (name) => callerConfig.getProviderKeys().getKey(name),
      ),
    ).rejects.toThrow('does not specify a model');
  });

  it('rejects an unregistered active provider at the explicit manager boundary', async () => {
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      callerSettings,
    );
    expect(() => manager.setActiveProvider('unregistered')).toThrow(
      "Provider 'unregistered' not found",
    );
    expect(manager.hasActiveProvider()).toBe(false);
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
