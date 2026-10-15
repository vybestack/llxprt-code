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
  isResolvedSubProfile,
  type ResolvedSubProfile,
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
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import {
  assembleProfileApplication,
  type AgentProfileApplication,
} from '../profileApplicationAssembly.js';
import { memberOptions as options } from './helpers/member-auth-options.js';
import {
  loadBalancer,
  standardProfile,
} from './helpers/profile-owner-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

async function member(
  store: ProfileDefinitionWrites,
  application: AgentProfileApplication,
  manager: RuntimeProviderManager,
  ephemerals: Record<string, unknown>,
): Promise<ResolvedSubProfile> {
  await store.saveProfile('member', standardProfile(ephemerals));
  await application.applySnapshot({
    ...standardProfile(),
    type: 'loadbalancer',
    profiles: ['member'],
    policy: 'roundrobin',
  });
  const result = loadBalancer(manager).getLoadBalancerConfig().subProfiles[0];
  if (!isResolvedSubProfile(result))
    throw new Error('Expected resolved member');
  return result;
}
describe('Load balancer member credentials at use time', () => {
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

  it('resolves each named member key into delegate options only at use time', async () => {
    const reads: string[] = [];
    const storage = vi
      .spyOn(callerConfig.getProviderKeys(), 'getKey')
      .mockImplementation(async (name) => {
        reads.push(name);
        return `resolved-${name}`;
      });
    try {
      await profileStore.saveProfile(
        'chutes',
        standardProfile({ 'auth-key-name': 'chutes' }),
      );
      await profileStore.saveProfile(
        'router',
        standardProfile({ 'auth-key-name': 'openrouter' }),
      );
      await profileApplication.applySnapshot({
        ...standardProfile(),
        type: 'loadbalancer',
        profiles: ['chutes', 'router'],
        policy: 'roundrobin',
      });
      expect(reads).toStrictEqual([]);
      const members =
        loadBalancer(callerManager).getLoadBalancerConfig().subProfiles;
      const first = members[0];
      const second = members[1];
      if (!isResolvedSubProfile(first) || !isResolvedSubProfile(second))
        throw new Error('Expected resolved members');
      expect(first.authToken).toBeUndefined();
      expect(second.authToken).toBeUndefined();
      const firstOptions = await options(first, callerConfig.getProviderKeys());
      expect(firstOptions.resolved?.authToken).toBe('resolved-chutes');
      expect(firstOptions.metadata?.profileId).toBe('chutes');
      expect(reads).toStrictEqual(['chutes']);
      const secondOptions = await options(
        second,
        callerConfig.getProviderKeys(),
      );
      expect(secondOptions.resolved?.authToken).toBe('resolved-openrouter');
      expect(secondOptions.metadata?.profileId).toBe('router');
      expect(first.authToken).toBeUndefined();
      expect(second.authToken).toBeUndefined();
    } finally {
      storage.mockRestore();
    }
  });

  it('reads a rotated named key without caching plaintext', async () => {
    const storage = vi
      .spyOn(callerConfig.getProviderKeys(), 'getKey')
      .mockResolvedValue(' key-A ');
    try {
      const resolved = await member(
        profileStore,
        profileApplication,
        callerManager,
        { 'auth-key-name': 'chutes' },
      );
      const first = await options(resolved, callerConfig.getProviderKeys());
      storage.mockResolvedValue(' key-B ');
      const second = await options(resolved, callerConfig.getProviderKeys());
      expect(first.resolved?.authToken).toBe('key-A');
      expect(second.resolved?.authToken).toBe('key-B');
      expect(resolved.authToken).toBeUndefined();
    } finally {
      storage.mockRestore();
    }
  });

  it('reads keyfile rotation between attempts without storing plaintext', async () => {
    const keyfile = join(callerConfig.getTargetDir(), 'rotating');
    await writeFile(keyfile, ' first-file-key ');
    const resolved = await member(
      profileStore,
      profileApplication,
      callerManager,
      { 'auth-keyfile': keyfile },
    );
    const first = await options(resolved, callerConfig.getProviderKeys());
    await writeFile(keyfile, ' second-file-key ');
    const second = await options(resolved, callerConfig.getProviderKeys());
    expect([
      first.resolved?.authToken,
      second.resolved?.authToken,
    ]).toStrictEqual(['first-file-key', 'second-file-key']);
    expect(resolved.authToken).toBeUndefined();
  });

  it('prefers explicit auth-key over auth-key-name', async () => {
    const storage = vi
      .spyOn(callerConfig.getProviderKeys(), 'getKey')
      .mockImplementation(async () => {
        throw new Error('Named key must not be read');
      });
    try {
      const resolved = await member(
        profileStore,
        profileApplication,
        callerManager,
        {
          'auth-key': 'direct-key',
          'auth-key-name': 'chutes',
        },
      );
      expect(resolved.authKeyName).toBeUndefined();
      expect(
        (await options(resolved, callerConfig.getProviderKeys())).resolved
          ?.authToken,
      ).toBe('direct-key');
    } finally {
      storage.mockRestore();
    }
  });

  it('continues without a token when the named key is missing at use time', async () => {
    const storage = vi
      .spyOn(callerConfig.getProviderKeys(), 'getKey')
      .mockResolvedValue(null);
    try {
      const resolved = await member(
        profileStore,
        profileApplication,
        callerManager,
        { 'auth-key-name': 'missing' },
      );
      expect(resolved.authKeyName).toBe('missing');
      expect(
        (await options(resolved, callerConfig.getProviderKeys())).resolved
          ?.authToken,
      ).toBeUndefined();
      expect(resolved.authToken).toBeUndefined();
    } finally {
      storage.mockRestore();
    }
  });

  it('falls back to the rotated member keyfile when the named key is missing', async () => {
    const storage = vi
      .spyOn(callerConfig.getProviderKeys(), 'getKey')
      .mockResolvedValue(null);
    try {
      const keyfile = join(callerConfig.getTargetDir(), 'fallback');
      await writeFile(keyfile, 'stale-file-key');
      const resolved = await member(
        profileStore,
        profileApplication,
        callerManager,
        {
          'auth-key-name': 'missing',
          'auth-keyfile': keyfile,
        },
      );
      await writeFile(keyfile, ' fresh-file-key ');
      expect(
        (await options(resolved, callerConfig.getProviderKeys())).resolved
          ?.authToken,
      ).toBe('fresh-file-key');
      expect(resolved.authToken).toBeUndefined();
      expect(resolved.authKeyfile).toBe(keyfile);
    } finally {
      storage.mockRestore();
    }
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
