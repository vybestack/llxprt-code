import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  SettingsService,
  LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
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
import {
  loadBalancer,
  standardProfile,
} from './helpers/profile-owner-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function profile(
  policy: 'failover' | 'roundrobin' = 'failover',
): LoadBalancerProfile {
  return {
    version: 1,
    type: 'loadbalancer',
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: {},
    policy,
    profiles: ['first', 'second'],
  };
}

describe('Load balancer policy at the profile owner', () => {
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
  let callerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let callerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

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
    const factories = configureProviderRuntimeFactories(
      callerConfig,
      callerManager,
    );
    callerTokenizer = factories.tokenizerFactory;
    callerContent = factories.contentGeneratorFactory;
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

  beforeEach(async () => {
    await profileStore.saveProfile('first', standardProfile());
    await profileStore.saveProfile('second', {
      ...standardProfile(),
      provider: 'openai',
    });
  });

  for (const [title, policy, strategy] of [
    [
      'should map policy "failover" to strategy "failover"',
      'failover',
      'failover',
    ],
    [
      'should map policy "roundrobin" to strategy "round-robin"',
      'roundrobin',
      'round-robin',
    ],
    [
      'should have failover strategy when policy is failover',
      'failover',
      'failover',
    ],
    [
      'should have round-robin strategy when policy is roundrobin',
      'roundrobin',
      'round-robin',
    ],
  ] satisfies Array<
    [string, 'failover' | 'roundrobin', 'failover' | 'round-robin']
  >) {
    it(`${title}`, async () => {
      await profileApplication.applySnapshot(profile(policy));
      expect(loadBalancer(callerManager).getLoadBalancerConfig().strategy).toBe(
        strategy,
      );
    });
  }

  it('should create LoadBalancingProvider with failover strategy from policy', async () => {
    await profileApplication.applySnapshot(profile());
    expect(loadBalancer(callerManager).name).toBe('load-balancer');
    expect(loadBalancer(callerManager).getLoadBalancerConfig().strategy).toBe(
      'failover',
    );
  });

  it('should register LoadBalancingProvider with providerManager', async () => {
    await profileApplication.applySnapshot(profile());
    expect(callerManager.getProviderByName('load-balancer')?.name).toBe(
      'load-balancer',
    );
    expect(
      loadBalancer(callerManager).getLoadBalancerConfig().subProfiles,
    ).toHaveLength(2);
  });

  it('should pass ephemeral settings to LoadBalancingProviderConfig', async () => {
    await profileApplication.applySnapshot({
      ...profile(),
      ephemeralSettings: standardProfile({
        failover_retry_count: 3,
        failover_retry_delay_ms: 1000,
        'context-limit': 100000,
      }).ephemeralSettings,
    });
    expect(
      loadBalancer(callerManager).getLoadBalancerConfig()
        .lbProfileEphemeralSettings,
    ).toStrictEqual({
      failover_retry_count: 3,
      failover_retry_delay_ms: 1000,
      'context-limit': 100000,
    });
  });

  it('should pass empty ephemeral settings when none provided', async () => {
    await profileApplication.applySnapshot(profile());
    expect(
      loadBalancer(callerManager).getLoadBalancerConfig()
        .lbProfileEphemeralSettings,
    ).toStrictEqual({});
  });

  it('should include profile name in LoadBalancingProviderConfig', async () => {
    await profileApplication.applySnapshot(profile(), {
      profileName: 'myCustomFailoverLB',
    });
    expect(
      loadBalancer(callerManager).getLoadBalancerConfig().profileName,
    ).toBe('myCustomFailoverLB');
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
