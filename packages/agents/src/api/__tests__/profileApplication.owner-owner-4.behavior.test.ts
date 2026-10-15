import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  SettingsService,
  ProfileManager,
  type Profile,
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
  configureProviderRuntimeFactories,
  writeProviderAliasConfig,
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
import { fromConfig } from '../index.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { TokenStore, OAuthToken } from '@vybestack/llxprt-code-auth';

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

  it('serializes the same owner and captures queued input without rebasing it after rollback', async () => {
    const reached = deferred<void>();
    const release = deferred<OAuthToken | null>();
    const failure = new Error('credential read failed');
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
    const {
      tokenizerFactory: a_builtCallerTokenizer,
      contentGeneratorFactory: a_builtCallerContent,
    } = configureProviderRuntimeFactories(
      a_builtCallerConfig,
      a_builtCallerManager,
    );
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
    );
    const a_builtCallerMedia = new SessionMediaOwner(
      a_builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const a_builtCallerOwner = await SessionClientOwner.create(
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
      await a_builtCallerOwner.getAgentClient().startChat();
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
    const a_agent = await fromConfig({
      oauthManager: a_oauthManager,
      providerFileLifecycle: a_builtCallerFiles,
      settingsOwner: a_builtCallerSettingsOwner,
      settingsService: a_builtCallerSettings,
      agentClient: a_builtCallerOwner.getAgentClient(),
      providerManager: a_builtCallerManager,
      runtimeFactoryBindings: a_builtCallerFactories,
      config: a_builtCallerConfig,
      mcpRuntime: a_builtCallerMcp,
      messageBus: a_builtCallerPolicy.session.messageBus,
      sessionId: 'same-profile-owner-label',
    });
    ownerCloses.push(() =>
      runCleanupSteps([() => a_agent.dispose(), () => a_builtCallerClose()]),
    );
    delete process.env.LLXPRT_FAKE_RESPONSES;
    a_builtCallerSettingsOwner.writeUserParameter('context-limit', 8192);
    a_builtCallerSettings.setCurrentProfileName(`${a_label}-prior`);
    a_agent.setDefaultProfileName(`${a_label}-default`);
    await a_profiles.saveProfile('selected', a_agent.captureProfile());
    const first = a_agent.profiles
      .applySnapshot({
        version: 1,
        provider: 'fake',
        model: 'a-pending',
        modelParams: {},
        ephemeralSettings: { 'auth-keyfile': a_keyfile },
        auth: { type: 'oauth', buckets: ['external-boundary'] },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    try {
      await reached.promise;
      const input: Profile = {
        version: 1,
        provider: 'fake',
        model: 'a-queued',
        modelParams: { temperature: 0.9 },
        ephemeralSettings: {},
      };
      const queued = a_agent.profiles.applySnapshot(input, {
        profileName: 'queued',
      });
      input.model = 'caller-mutated';
      input.modelParams.temperature = 0.1;
      expect(a_builtCallerSettingsOwner.readSelectedModel()).toBe('a-pending');
      release.reject(failure);
      expect(await first).toBe(failure);
      await queued;
      expect(a_agent.captureProfile()).toMatchObject({
        model: 'a-queued',
        modelParams: { temperature: 0.9 },
      });
      expect(a_agent.getActiveProfileName()).toBe('queued');
    } finally {
      release.reject(failure);
      await first;
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
