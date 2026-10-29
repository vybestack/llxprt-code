import {
  createCapturedSessionOwner,
  ownerClients,
} from './helpers/session-client-capture.js';
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
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { preparePreferredProviderCompletion } from '../preferred-provider-acquisition.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from './helpers/provider-acquisition.js';
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
import { buildAgentClientFactory } from '../agentBootstrap.js';
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

function profile(profiles = ['first', 'second']): LoadBalancerProfile {
  return {
    version: 1,
    type: 'loadbalancer',
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: {},
    policy: 'roundrobin',
    profiles,
  };
}

describe('Load balancer profile detection at the owner', () => {
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
    callerOwner = await createCapturedSessionOwner(
      callerConfig,
      assembleTaskSchemaPolicy(callerSettings),
      callerManager,
      buildAgentClientFactory(),
      media.store,
      callerMcp.readInstructions,
      callerMcp.workspacePaths,
      callerSettingsOwner,
      callerContent,
      callerTokenizer,
    );
    callerOwner.bindMcpRuntime(callerMcp);
    callerOwner.clients.bindProviderFiles(callerFiles, (provider) =>
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
        process.env.LLXPRT_FAKE_RESPONSES,
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
        () => callerOwner.clients.refreshAuth(),
        callerSettingsOwner,
      ),
      callerSettings,
      callerManager,
      (method) => callerOwner.clients.refreshAuth(method),
      assembleModelSelection(callerSettingsOwner),
    );
    requireCallerActivation(activation);
    await callerOwner.initializeTools();
    const clients = ownerClients(callerOwner);
    await clients[clients.length - 1].startChat();
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
      () => callerOwner.clients.refreshAuth(),
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
      model: 'second-model',
    });
    await profileStore.saveProfile('third', {
      ...standardProfile(),
      provider: 'gemini',
      model: 'third-model',
    });
  });

  it('detects the type loadbalancer profiles format', async () => {
    await profileApplication.applySnapshot(profile());
    expect(
      loadBalancer(callerManager)
        .getLoadBalancerConfig()
        .subProfiles.map((member) => member.name),
    ).toStrictEqual(['first', 'second']);
  });

  it('does not detect standard profiles as load balancers', async () => {
    await profileApplication.applySnapshot(standardProfile());
    expect(callerManager.getProviderByName('load-balancer')).toBeUndefined();
  });

  it('loads each sub-profile from the durable ProfileManager', async () => {
    await profileApplication.applySnapshot(
      profile(['first', 'second', 'third']),
    );
    expect(
      loadBalancer(callerManager).getLoadBalancerConfig().subProfiles,
    ).toMatchObject([
      { name: 'first', providerName: 'anthropic', model: 'selected-model' },
      { name: 'second', providerName: 'openai', model: 'second-model' },
      { name: 'third', providerName: 'gemini', model: 'third-model' },
    ]);
  });

  it('extracts the full configuration from loaded sub-profiles', async () => {
    await profileStore.saveProfile('first', {
      ...standardProfile({
        'auth-key': 'member-key',
        'base-url': 'https://member.invalid',
        'context-limit': 4096,
      }),
      modelParams: { temperature: 0.3 },
    });
    await profileApplication.applySnapshot(profile(['first']));
    expect(
      loadBalancer(callerManager).getLoadBalancerConfig().subProfiles[0],
    ).toMatchObject({
      name: 'first',
      providerName: 'anthropic',
      model: 'selected-model',
      authToken: 'member-key',
      baseURL: 'https://member.invalid',
      modelParams: { temperature: 0.3 },
      ephemeralSettings: { 'context-limit': 4096 },
    });
  });

  it('fails fast when a referenced profile does not exist', async () => {
    await expect(
      profileApplication.applySnapshot(profile(['missing'])),
    ).rejects.toThrow('does not exist');
    expect(callerManager.getProviderByName('load-balancer')).toBeUndefined();
  });

  it('includes both the load balancer and missing member in the error', async () => {
    await expect(
      profileApplication.applySnapshot(profile(['missingSubProfile']), {
        profileName: 'myLB',
      }),
    ).rejects.toThrow(
      'Load balancer profile "myLB" references profile "missingSubProfile"',
    );
  });

  it('rejects circular references to another load balancer', async () => {
    await profileStore.saveProfile('nested', profile(['first']));
    await expect(
      profileApplication.applySnapshot(profile(['nested'])),
    ).rejects.toThrow('cannot reference another loadbalancer');
    expect(callerManager.getProviderByName('load-balancer')).toBeUndefined();
  });

  it('creates LoadBalancingProvider with resolved member configurations', async () => {
    await profileApplication.applySnapshot(profile());
    expect(loadBalancer(callerManager).name).toBe('load-balancer');
    expect(
      loadBalancer(callerManager).getLoadBalancerConfig().subProfiles,
    ).toHaveLength(2);
  });

  it('registers LoadBalancingProvider as load-balancer', async () => {
    await profileApplication.applySnapshot(profile());
    expect(callerManager.getProviderByName('load-balancer')?.name).toBe(
      'load-balancer',
    );
  });

  it('sets load-balancer as the active provider', async () => {
    await profileApplication.applySnapshot(profile());
    expect(callerManager.getActiveProviderName()).toBe('load-balancer');
  });

  it('returns load-balancer as providerName', async () => {
    const result = await profileApplication.applySnapshot(profile());
    expect(result.providerName).toBe('load-balancer');
  });

  it('applies top-level ephemeral settings', async () => {
    await profileApplication.applySnapshot({
      ...profile(),
      ephemeralSettings: { 'context-limit': 100000, streaming: 'enabled' },
    });
    expect(callerSettingsOwner.readNamedParameter('context-limit')).toBe(
      100000,
    );
    expect(callerSettingsOwner.readNamedParameter('streaming')).toBe('enabled');
  });

  it('applies top-level contextLimit to both metadata and runtime context-limit', async () => {
    await profileApplication.applySnapshot({
      ...profile(),
      contextLimit: 200000,
      ephemeralSettings: { 'context-limit': 100000 },
    });
    expect(
      (await loadBalancer(callerManager).getModels())[0]?.contextWindow,
    ).toBe(200000);
    expect(callerSettingsOwner.readNamedParameter('context-limit')).toBe(
      200000,
    );
  });

  it('checks type loadbalancer before the old inline format', async () => {
    const input = { ...profile(['first']), loadBalancer: { subProfiles: [] } };
    await profileApplication.applySnapshot(input);
    expect(
      loadBalancer(callerManager).getLoadBalancerConfig().subProfiles,
    ).toMatchObject([{ name: 'first' }]);
  });

  it('ignores the old inline subProfiles format', async () => {
    const input = {
      ...standardProfile(),
      provider: 'gemini',
      model: 'test-model',
      loadBalancer: { subProfiles: [{ provider: 'openai', model: 'unused' }] },
    };
    const result = await profileApplication.applySnapshot(input);
    expect(callerManager.getProviderByName('load-balancer')).toBeUndefined();
    expect(result.providerName).toBe('gemini');
    expect(result.modelName).toBe('test-model');
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
