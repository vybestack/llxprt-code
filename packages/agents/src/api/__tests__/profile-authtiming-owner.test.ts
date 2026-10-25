import {
  createCapturedSessionOwner,
  ownerClients,
} from './helpers/session-client-capture.js';
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
import { standardProfile } from './helpers/profile-owner-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Profile credential timing at the owner', () => {
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

  for (const directive of ['auth-key', 'auth-keyfile', 'base-url']) {
    it(`installs ${directive} in SettingsService before switching providers`, async () => {
      const settings = callerSettings;
      const manager = callerManager;
      const oauth = profileOAuth;
      const store = profileStore;
      const switchProvider = profileSwitch;
      const directory = callerConfig.getTargetDir();
      const keyfile = join(directory, 'credential');
      await writeFile(keyfile, ' file-key\n');
      const values: Record<string, string> = {
        'auth-keyfile': keyfile,
        'base-url': 'https://custom.invalid',
        'auth-key': 'direct-key',
      };
      const value = values[directive];
      const observed: unknown[] = [];
      const application = assembleProfileApplication(
        settings,
        manager,
        oauth,
        async (name, options) => {
          observed.push(
            settings.getProviderSettings(name)[
              directive === 'auth-keyfile' ? 'auth-key' : directive
            ],
          );
          return switchProvider(name, options);
        },
        callerSettingsOwner,
        store,
      );
      await application.applySnapshot(standardProfile({ [directive]: value }));
      expect(observed).toStrictEqual([
        directive === 'auth-keyfile' ? 'file-key' : value,
      ]);
    });
  }

  it('has SettingsService auth available when the switch starts', async () => {
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
        observed.push(settings.getProviderSettings(name)['auth-key']);
        return switchProvider(name, options);
      },
      callerSettingsOwner,
      store,
    );
    await application.applySnapshot(
      standardProfile({ 'auth-key': 'ready-before-switch' }),
    );
    expect(observed).toStrictEqual(['ready-before-switch']);
  });

  it('hydrates legacy model parameter auth into ephemerals', async () => {
    await profileApplication.applySnapshot({
      ...standardProfile(),
      modelParams: {
        authKey: 'legacy-auth-key',
        'base-url': 'https://legacy.invalid',
      },
    });
    expect(callerSettingsOwner.readNamedParameter('auth-key')).toBe(
      'legacy-auth-key',
    );
    expect(callerSettingsOwner.readNamedParameter('base-url')).toBe(
      'https://legacy.invalid',
    );
    expect(callerSettings.getProviderSettings('anthropic')['auth-key']).toBe(
      'legacy-auth-key',
    );
    expect(
      callerSettings.getProviderSettings('anthropic').authKey,
    ).toBeUndefined();
  });

  it('clears provider auth and base-url when omitted', async () => {
    await profileApplication.applySnapshot(
      standardProfile({
        'auth-key': 'old-key',
        'base-url': 'https://old.invalid',
      }),
    );
    await profileApplication.applySnapshot(standardProfile());
    expect(
      callerSettings.getProviderSettings('anthropic')['auth-key'],
    ).toBeUndefined();
    expect(callerSettingsOwner.readNamedParameter('base-url')).toBeUndefined();
  });

  it('treats explicit null auth and base-url as clear directives', async () => {
    await profileApplication.applySnapshot(
      standardProfile({
        'auth-key': 'old-key',
        'base-url': 'https://old.invalid',
      }),
    );
    await profileApplication.applySnapshot(
      standardProfile({ 'auth-key': null, 'base-url': null }),
    );
    expect(
      callerSettings.getProviderSettings('anthropic')['auth-key'],
    ).toBeUndefined();
    expect(callerSettingsOwner.readNamedParameter('base-url')).toBeUndefined();
  });

  it('does not trigger OAuth when a keyfile profile is used with model discovery', async () => {
    const application = profileApplication;
    const directory = callerConfig.getTargetDir();
    const oauth = profileOAuth;
    const authenticationRequests = profileAuthenticationRequests;
    const manager = callerManager;
    const settings = callerSettings;
    await oauth.toggleOAuthEnabled('anthropic');
    const keyfile = join(directory, 'keyfile');
    await writeFile(keyfile, 'discovery-key');
    await application.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile }),
    );
    await manager.getAvailableModels('anthropic');
    expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'discovery-key',
    );
    expect(authenticationRequests).toStrictEqual([]);
  });

  it('clears stale state before installing auth and applies remaining settings after switching', async () => {
    const settings = callerSettings;
    const manager = callerManager;
    const oauth = profileOAuth;
    const store = profileStore;
    const switchProvider = profileSwitch;
    callerSettingsOwner.writeUserParameter('old-setting', 'stale');
    callerSettingsOwner.writeUserParameter('auth-key', 'old-auth');
    const observed: unknown[] = [];
    const application = assembleProfileApplication(
      settings,
      manager,
      oauth,
      async (name, options) => {
        observed.push({
          old: callerSettingsOwner.readNamedParameter('old-setting'),
          auth: callerSettingsOwner.readNamedParameter('auth-key'),
          context: callerSettingsOwner.readNamedParameter('context-limit'),
        });
        return switchProvider(name, options);
      },
      callerSettingsOwner,
      store,
    );
    await application.applySnapshot(
      standardProfile({ 'auth-key': 'new-auth', 'context-limit': 100000 }),
    );
    expect(observed).toStrictEqual([
      { old: undefined, auth: 'new-auth', context: undefined },
    ]);
    expect(callerSettingsOwner.readNamedParameter('context-limit')).toBe(
      100000,
    );
    expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'new-auth',
    );
  });

  it('reports keyfile read failure without blocking the provider switch', async () => {
    const result = await profileApplication.applySnapshot(
      standardProfile({
        'auth-keyfile': join(callerConfig.getTargetDir(), 'absent'),
      }),
    );
    expect(callerManager.getActiveProviderName()).toBe('anthropic');
    expect(result.warnings).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining('Failed to load keyfile'),
      ]),
    );
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
