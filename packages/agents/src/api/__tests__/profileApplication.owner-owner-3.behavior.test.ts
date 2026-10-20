import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
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
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import { type Agent } from '../index.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { TokenStore, OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  CoreEvent,
  type ModelProfileInfoPayload,
} from '@vybestack/llxprt-code-core/utils/events.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred not initialized');
  };
  let reject: (error: unknown) => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function tokenReadBoundary(read: TokenStore['getToken']): TokenStore {
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected token-store write or lock');
  };
  return {
    getToken: read,
    saveToken: unexpected,
    removeToken: unexpected,
    listProviders: unexpected,
    listBuckets: unexpected,
    getBucketStats: unexpected,
    acquireRefreshLock: unexpected,
    releaseRefreshLock: unexpected,
    acquireAuthLock: unexpected,
    releaseAuthLock: unexpected,
  };
}

function observe(
  agent: Agent,
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  manager: ReturnType<typeof acquirePreferredProviderManager>,
): object {
  return {
    provider: agent.getProvider(),
    model: agent.getModel(),
    status: agent.getProviderStatus(),
    profile: agent.getActiveProfileName(),
    snapshot: agent.captureProfile(),
    configProvider: config.getProvider(),
    configModel: config.getModel(),
    managerProvider: manager.getActiveProviderName(),
    settings: settings.exportForStateSnapshot(),
    ephemerals: settingsOwner.captureNamedParameters(),
    modelDefaultOwnership:
      settingsOwner.captureDefaultClassification().modelKeys,
    providerDefaultOwnership:
      settingsOwner.captureDefaultClassification().providerEntries,
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
describe('public profile application ownership outside ALS', () => {
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

  let directory: string;

  let previousHome: string | undefined;

  let previousData: string | undefined;

  let previousFake: string | undefined;

  let ownerCloses: Array<() => Promise<void>>;

  usePromptFixture();

  beforeEach(async () => {
    const evidence = join(tmpdir(), 'llxprt-profile-application-owner');
    await mkdir(evidence, { recursive: true });
    directory = await mkdtemp(join(evidence, 'fixture-'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    previousData = process.env.LLXPRT_DATA_HOME;
    previousFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'user');
    process.env.LLXPRT_DATA_HOME = join(directory, 'data');
    writeProviderAliasConfig('fake', {
      baseProvider: 'openai',
      modelDefaults: [
        {
          pattern: '^a-selected$',
          ephemeralSettings: { 'reasoning.enabled': true },
        },
        {
          pattern: '^b-selected$',
          ephemeralSettings: { 'reasoning.enabled': false },
        },
      ],
    });
    ownerCloses = [];
  });

  afterEach(async () => {
    try {
      await runCleanupSteps([...ownerCloses].reverse());
    } finally {
      if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = previousHome;
      if (previousData === undefined) delete process.env.LLXPRT_DATA_HOME;
      else process.env.LLXPRT_DATA_HOME = previousData;
      if (previousFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousFake;
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function createSelection(agent: Agent, model: string): Promise<void> {
    await agent.profiles.create('selected', {
      name: 'selected',
      provider: 'fake',
      model,
      modelParams: { temperature: model.startsWith('a') ? 0.2 : 0.8 },
    });
  }

  it('rolls back after the owning external token store fails while another same-label owner commits', async () => {
    const reached = deferred<void>();
    const release = deferred<OAuthToken | null>();
    const failure = new Error('owner A credential storage unavailable');
    const a_label = 'a';
    const a_tokenStore = tokenReadBoundary(async () => {
      reached.resolve();
      return release.promise;
    });
    const a_workingDir = join(directory, a_label);
    await mkdir(a_workingDir, { recursive: true });
    const a_keyfile = join(a_workingDir, 'credential.txt');
    await writeFile(a_keyfile, `fake-${a_label}-credential`, { mode: 0o600 });
    const a_builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const a_builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const a_builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
      model: `${a_label}-initial`,
      workingDir: a_workingDir,
      sessionId: 'same-profile-owner-label',
      settings: { profileDirectory: join(a_workingDir, 'durable-profiles') },
    };
    const a_builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...a_builtCallerOverrides,
      workingDir:
        a_builtCallerOverrides.workingDir === undefined
          ? a_builtCallerDirectory
          : await realpath(a_builtCallerOverrides.workingDir),
    };
    const a_builtCallerParameters = {
      ...toConfigParameters(a_builtCallerSelection),
      ...{},
    };
    a_builtCallerParameters.interactive = true;

    a_builtCallerParameters.includeDirectories = [
      ...(a_builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const a_builtCallerConfig = new Config(a_builtCallerParameters);
    const a_builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const a_builtCallerSettings = new SettingsService();
    for (const [a_key, a_value] of Object.entries(
      a_builtCallerConfig.getInitialSettings(),
    ))
      a_builtCallerSettings.set(a_key, a_value);
    const a_builtCallerPolicy = new RuntimePolicyOwner(a_builtCallerConfig);
    injectConfirmationForcingPolicy(a_builtCallerPolicy.session.confirmation);
    const a_builtCallerMcp = await buildTestMcpRuntime(
      a_builtCallerConfig,
      a_builtCallerPolicy.session.messageBus,
      a_builtCallerOverrides,
      undefined,
      a_builtCallerPolicy,
      undefined,
    );
    const a_builtCallerRuntimeId = 'caller-' + randomUUID();
    const a_builtCallerRelease = new AcquisitionRelease();
    const a_builtCallerSettingsOwner = new SessionSettingsOwner(
      a_builtCallerSettings,
    );
    a_builtCallerRelease.acquire('settings', () =>
      a_builtCallerSettingsOwner.dispose(),
    );
    a_builtCallerSettingsOwner.initializeProviderSelection(
      a_builtCallerConfig.getProvider(),
      a_builtCallerConfig.getModel(),
    );
    a_builtCallerSettingsOwner.bindTelemetry(a_builtCallerConfig);
    const a_builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const a_scope of [
      a_builtCallerRuntimeId,
      a_builtCallerConfig.getSessionId(),
    ])
      a_builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(a_builtCallerFiles, a_scope),
      );
    const a_builtCallerManager = acquirePreferredProviderManager(
      a_builtCallerConfig,
      a_builtCallerSettings,
      a_builtCallerSettingsOwner,
      a_builtCallerFiles,
      a_builtCallerRuntimeId,
      builtCredentials().authority,
      a_builtCallerRelease,
    );
    const a_builtCallerTokenizer =
      configureProviderTokenizer(a_builtCallerManager);
    const a_builtCallerContent = createRuntimeContentGeneratorFactory();
    const a_builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      a_builtCallerPolicy.session.messageBus,
      a_builtCallerConfig,
      a_builtCallerSettings,
      a_builtCallerManager,
      a_builtCallerRuntimeId,
      a_builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      a_builtCallerRelease,
      undefined,
    );
    const a_builtCallerMedia = new SessionMediaOwner(
      a_builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const a_builtCallerOwner = await createCapturedSessionOwner(
      a_builtCallerConfig,
      assembleTaskSchemaPolicy(a_builtCallerSettings),
      a_builtCallerManager,
      a_builtCallerFactories.agentClientFactory,
      a_builtCallerMedia.store,
      a_builtCallerMcp.readInstructions,
      a_builtCallerMcp.workspacePaths,
      a_builtCallerSettingsOwner,
      a_builtCallerContent,
      a_builtCallerTokenizer,
    );
    a_builtCallerOwner.bindMcpRuntime(a_builtCallerMcp);
    a_builtCallerOwner.bindProviderFiles(a_builtCallerFiles, (a_provider) =>
      a_builtCallerOAuth.composeRetryOperations(a_provider),
    );
    a_builtCallerOwner.bindHooks();
    const a_builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => a_builtCallerOwner.dispose(),
        () => a_builtCallerRelease.close(),
        () => a_builtCallerMedia.dispose(),
        () => a_builtCallerMcp.dispose(),
        () => a_builtCallerConfig.dispose(),
        () => rm(a_builtCallerDirectory, { recursive: true, force: true }),
      ],
      a_builtCallerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        a_builtCallerConfig,
        a_builtCallerSettings,
        a_builtCallerSettingsOwner,
        a_builtCallerManager,
        a_builtCallerOAuth,
        a_builtCallerRuntimeId,
        a_builtCallerTokenizer,
        undefined,
      );
      await a_builtCallerMcp.initialize();
      const a_activation = await executeProviderActivation(
        a_builtCallerConfig,
        {
          provider: a_builtCallerConfig.getProvider(),
          model: a_builtCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          a_builtCallerConfig,
          a_builtCallerSettings,
          a_builtCallerManager,
          a_builtCallerOAuth,
          () => 'agent',
          () => a_builtCallerOwner.refreshAuth(),
          a_builtCallerSettingsOwner,
        ),
        a_builtCallerSettings,
        a_builtCallerManager,
        (a_method) => a_builtCallerOwner.refreshAuth(a_method),
        assembleModelSelection(a_builtCallerSettingsOwner),
      );
      requireCallerActivation(a_activation);
      await a_builtCallerOwner.initializeTools();
      await capturedSessionClient(a_builtCallerOwner).startChat();
    } catch (a_primary) {
      await cleanupAfterFailure(a_primary, a_builtCallerClose);
    }
    const a_profiles = new ProfileManager(
      join(a_workingDir, 'durable-profiles'),
    );
    let a_oauthManager: OAuthManager | undefined;
    {
      const a_oauth = new OAuthManager(a_tokenStore, undefined, {
        config: a_builtCallerConfig,
        messageBus: a_builtCallerPolicy.session.messageBus,
      });
      a_oauth.registerProvider({
        name: 'fake',
        initiateAuth: async () => {
          throw new Error('Unexpected interactive authentication');
        },
        getToken: async () => null,
        refreshToken: async () => null,
      });
      a_oauth.registerProvider({
        name: 'fake-target',
        initiateAuth: async () => {
          throw new Error('Unexpected interactive authentication');
        },
        getToken: async () => null,
        refreshToken: async () => null,
      });
      await a_oauth.toggleOAuthEnabled('fake');
      await a_oauth.toggleOAuthEnabled('fake-target');
      const a_target = new FakeProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        a_workingDir,
      );
      a_target.name = 'fake-target';
      a_builtCallerManager.registerProvider(a_target);
      a_oauthManager = a_oauth;
    }
    const a_agent = await fromConfig(
      a_builtCallerConfig,
      a_builtCallerSettings,
      { sessionId: 'same-profile-owner-label' },
      a_builtCallerSettingsOwner,
      a_builtCallerManager,
      a_oauthManager,
      a_builtCallerPolicy.session.messageBus,
      a_builtCallerMcp,
      undefined,
      capturedSessionClient(a_builtCallerOwner),
      a_builtCallerFiles,
      undefined,
      undefined,
      a_builtCallerFactories,
    );
    ownerCloses.push(() =>
      runCleanupSteps([() => a_agent.dispose(), () => a_builtCallerClose()]),
    );
    delete process.env.LLXPRT_FAKE_RESPONSES;
    a_builtCallerSettingsOwner.writeUserParameter('context-limit', 8192);
    a_builtCallerSettings.setCurrentProfileName(`${a_label}-prior`);
    a_agent.setDefaultProfileName(`${a_label}-default`);
    await a_profiles.saveProfile('selected', a_agent.captureProfile());
    const b_label = 'b';

    const b_workingDir = join(directory, b_label);
    await mkdir(b_workingDir, { recursive: true });
    const b_keyfile = join(b_workingDir, 'credential.txt');
    await writeFile(b_keyfile, `fake-${b_label}-credential`, { mode: 0o600 });
    const b_builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const b_builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const b_builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
      model: `${b_label}-initial`,
      workingDir: b_workingDir,
      sessionId: 'same-profile-owner-label',
      settings: { profileDirectory: join(b_workingDir, 'durable-profiles') },
    };
    const b_builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...b_builtCallerOverrides,
      workingDir:
        b_builtCallerOverrides.workingDir === undefined
          ? b_builtCallerDirectory
          : await realpath(b_builtCallerOverrides.workingDir),
    };
    const b_builtCallerParameters = {
      ...toConfigParameters(b_builtCallerSelection),
      ...{},
    };
    b_builtCallerParameters.interactive = true;

    b_builtCallerParameters.includeDirectories = [
      ...(b_builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const b_builtCallerConfig = new Config(b_builtCallerParameters);
    const b_builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const b_builtCallerSettings = new SettingsService();
    for (const [b_key, b_value] of Object.entries(
      b_builtCallerConfig.getInitialSettings(),
    ))
      b_builtCallerSettings.set(b_key, b_value);
    const b_builtCallerPolicy = new RuntimePolicyOwner(b_builtCallerConfig);
    injectConfirmationForcingPolicy(b_builtCallerPolicy.session.confirmation);
    const b_builtCallerMcp = await buildTestMcpRuntime(
      b_builtCallerConfig,
      b_builtCallerPolicy.session.messageBus,
      b_builtCallerOverrides,
      undefined,
      b_builtCallerPolicy,
      undefined,
    );
    const b_builtCallerRuntimeId = 'caller-' + randomUUID();
    const b_builtCallerRelease = new AcquisitionRelease();
    const b_builtCallerSettingsOwner = new SessionSettingsOwner(
      b_builtCallerSettings,
    );
    b_builtCallerRelease.acquire('settings', () =>
      b_builtCallerSettingsOwner.dispose(),
    );
    b_builtCallerSettingsOwner.initializeProviderSelection(
      b_builtCallerConfig.getProvider(),
      b_builtCallerConfig.getModel(),
    );
    b_builtCallerSettingsOwner.bindTelemetry(b_builtCallerConfig);
    const b_builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const b_scope of [
      b_builtCallerRuntimeId,
      b_builtCallerConfig.getSessionId(),
    ])
      b_builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(b_builtCallerFiles, b_scope),
      );
    const b_builtCallerManager = acquirePreferredProviderManager(
      b_builtCallerConfig,
      b_builtCallerSettings,
      b_builtCallerSettingsOwner,
      b_builtCallerFiles,
      b_builtCallerRuntimeId,
      builtCredentials().authority,
      b_builtCallerRelease,
    );
    const b_builtCallerTokenizer =
      configureProviderTokenizer(b_builtCallerManager);
    const b_builtCallerContent = createRuntimeContentGeneratorFactory();
    const b_builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      b_builtCallerPolicy.session.messageBus,
      b_builtCallerConfig,
      b_builtCallerSettings,
      b_builtCallerManager,
      b_builtCallerRuntimeId,
      b_builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      b_builtCallerRelease,
      undefined,
    );
    const b_builtCallerMedia = new SessionMediaOwner(
      b_builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const b_builtCallerOwner = await createCapturedSessionOwner(
      b_builtCallerConfig,
      assembleTaskSchemaPolicy(b_builtCallerSettings),
      b_builtCallerManager,
      b_builtCallerFactories.agentClientFactory,
      b_builtCallerMedia.store,
      b_builtCallerMcp.readInstructions,
      b_builtCallerMcp.workspacePaths,
      b_builtCallerSettingsOwner,
      b_builtCallerContent,
      b_builtCallerTokenizer,
    );
    b_builtCallerOwner.bindMcpRuntime(b_builtCallerMcp);
    b_builtCallerOwner.bindProviderFiles(b_builtCallerFiles, (b_provider) =>
      b_builtCallerOAuth.composeRetryOperations(b_provider),
    );
    b_builtCallerOwner.bindHooks();
    const b_builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => b_builtCallerOwner.dispose(),
        () => b_builtCallerRelease.close(),
        () => b_builtCallerMedia.dispose(),
        () => b_builtCallerMcp.dispose(),
        () => b_builtCallerConfig.dispose(),
        () => rm(b_builtCallerDirectory, { recursive: true, force: true }),
      ],
      b_builtCallerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        b_builtCallerConfig,
        b_builtCallerSettings,
        b_builtCallerSettingsOwner,
        b_builtCallerManager,
        b_builtCallerOAuth,
        b_builtCallerRuntimeId,
        b_builtCallerTokenizer,
        undefined,
      );
      await b_builtCallerMcp.initialize();
      const b_activation = await executeProviderActivation(
        b_builtCallerConfig,
        b_builtCallerSelection.activation ?? {
          provider: b_builtCallerConfig.getProvider(),
          model: b_builtCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          b_builtCallerConfig,
          b_builtCallerSettings,
          b_builtCallerManager,
          b_builtCallerOAuth,
          () => 'agent',
          () => b_builtCallerOwner.refreshAuth(),
          b_builtCallerSettingsOwner,
        ),
        b_builtCallerSettings,
        b_builtCallerManager,
        (b_method) => b_builtCallerOwner.refreshAuth(b_method),
        assembleModelSelection(b_builtCallerSettingsOwner),
      );
      requireCallerActivation(b_activation);
      await b_builtCallerOwner.initializeTools();
      await capturedSessionClient(b_builtCallerOwner).startChat();
    } catch (b_primary) {
      await cleanupAfterFailure(b_primary, b_builtCallerClose);
    }
    const b_profiles = new ProfileManager(
      join(b_workingDir, 'durable-profiles'),
    );
    let b_oauthManager: OAuthManager | undefined;

    const b_agent = await fromConfig(
      b_builtCallerConfig,
      b_builtCallerSettings,
      { sessionId: 'same-profile-owner-label' },
      b_builtCallerSettingsOwner,
      b_builtCallerManager,
      b_oauthManager,
      b_builtCallerPolicy.session.messageBus,
      b_builtCallerMcp,
      undefined,
      capturedSessionClient(b_builtCallerOwner),
      b_builtCallerFiles,
      undefined,
      undefined,
      b_builtCallerFactories,
    );
    ownerCloses.push(() =>
      runCleanupSteps([() => b_agent.dispose(), () => b_builtCallerClose()]),
    );
    delete process.env.LLXPRT_FAKE_RESPONSES;
    b_builtCallerSettingsOwner.writeUserParameter('context-limit', 16384);
    b_builtCallerSettings.setCurrentProfileName(`${b_label}-prior`);
    b_agent.setDefaultProfileName(`${b_label}-default`);
    await b_profiles.saveProfile('selected', b_agent.captureProfile());
    await a_agent.profiles.create('selected', {
      name: 'selected',
      provider: 'fake',
      model: 'a-selected',
      authKeyFile: a_keyfile,
      baseUrl: 'https://a-original.invalid/v1',
      modelParams: { temperature: 0.2 },
    });
    await a_agent.profiles.apply('selected');
    const beforeA = observe(
      a_agent,
      a_builtCallerConfig,
      a_builtCallerSettings,
      a_builtCallerSettingsOwner,
      a_builtCallerManager,
    );
    const providerA = a_builtCallerManager.getActiveProvider();
    const replacementKey = join(directory, 'replacement-credential.txt');
    await writeFile(replacementKey, 'fake-replacement-credential', {
      mode: 0o600,
    });
    await a_profiles.saveProfile('failing', {
      version: 1,
      provider: 'fake-target',
      model: 'a-mutated',
      modelParams: { temperature: 0.6 },
      ephemeralSettings: {
        'auth-keyfile': replacementKey,
        'base-url': 'https://mutated.invalid/v1',
      },
      auth: { type: 'oauth', buckets: ['external-boundary'] },
    });
    const models: string[] = [];
    const onModel = (model: string): void => {
      models.push(model);
    };
    b_builtCallerSettingsOwner['modelNotifications'].on(
      CoreEvent.ModelChanged,
      onModel,
    );
    const publications: ModelProfileInfoPayload[] = [];
    const onPublication = (event: ModelProfileInfoPayload): void => {
      publications.push(event);
    };
    b_builtCallerSettingsOwner['modelNotifications'].on(
      CoreEvent.ModelProfileChanged,
      onPublication,
    );
    const pendingA = a_agent.profiles.load('failing');
    const rejectedA = pendingA.then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await reached.promise;
      expect(a_builtCallerSettingsOwner.readSelectedModel()).toBe('a-mutated');
      expect(a_builtCallerManager.getActiveProviderName()).toBe('fake-target');
      await expect(a_agent.setModel('must-not-rebase')).rejects.toMatchObject({
        code: 'busy',
      });
      expect(
        a_builtCallerSettings.getProviderSettings('fake-target'),
      ).toMatchObject({
        'auth-key': 'fake-replacement-credential',
        'base-url': 'https://mutated.invalid/v1',
      });
      await b_profiles.saveProfile('succeeding', {
        version: 1,
        provider: 'fake',
        model: 'b-selected',
        modelParams: { temperature: 0.7 },
        ephemeralSettings: {
          'auth-keyfile': b_keyfile,
          'base-url': 'https://b.invalid/v1',
        },
      });
      await b_agent.profiles.load('succeeding');
      const otherTurn = [];
      for await (const event of b_agent.stream(
        'owner B continues independently',
      ))
        otherTurn.push(event);
      expect(otherTurn.some((event) => event.type === 'error')).toBe(false);
      expect(otherTurn.some((event) => event.type === 'done')).toBe(true);
      const committedB = observe(
        b_agent,
        b_builtCallerConfig,
        b_builtCallerSettings,
        b_builtCallerSettingsOwner,
        b_builtCallerManager,
      );
      release.reject(failure);
      expect(await rejectedA).toBe(failure);
      expect(
        observe(
          a_agent,
          a_builtCallerConfig,
          a_builtCallerSettings,
          a_builtCallerSettingsOwner,
          a_builtCallerManager,
        ),
      ).toStrictEqual(beforeA);
      expect(a_builtCallerManager.getActiveProvider()).toBe(providerA);
      expect(
        observe(
          b_agent,
          b_builtCallerConfig,
          b_builtCallerSettings,
          b_builtCallerSettingsOwner,
          b_builtCallerManager,
        ),
      ).toStrictEqual(committedB);
      expect(b_agent.getModel()).toBe('b-selected');
      expect(models).toStrictEqual(['b-selected']);
      expect(publications.map((event) => event.model)).toStrictEqual([
        'b-selected',
      ]);
      await createSelection(a_agent, 'a-next');
      await a_agent.profiles.apply('selected');
      expect(
        a_builtCallerSettingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();
    } finally {
      b_builtCallerSettingsOwner['modelNotifications'].off(
        CoreEvent.ModelProfileChanged,
        onPublication,
      );
      b_builtCallerSettingsOwner['modelNotifications'].off(
        CoreEvent.ModelChanged,
        onModel,
      );
      release.reject(failure);
      await rejectedA;
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
