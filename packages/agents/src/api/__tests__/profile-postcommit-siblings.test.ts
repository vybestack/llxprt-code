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
  spyOn,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import {
  OAuthManager,
  AnthropicOAuthProvider,
  CodexOAuthProvider,
} from '@vybestack/llxprt-code-providers/auth.js';
import { TokenStore, OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  ProfileDefinitionReads,
  ProfileDefinitionWrites,
  ProviderSwitcher,
} from '@vybestack/llxprt-code-core';
import { assembleProfileApplication } from '../profileApplicationAssembly.js';
import { fromConfig } from '../fromConfig.js';
import { CoreEvent } from '@vybestack/llxprt-code-core/utils/events.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from './helpers/provider-auth-fixtures.js';
import { standardProfile } from './helpers/profile-owner-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function causes(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(causes)
    : [error];
}

describe('profile postcommit sibling lifetime', () => {
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
    assembleProfileApplication(
      callerSettings,
      callerManager,
      profileOAuth,
      profileSwitch,
      callerSettingsOwner,
      profileStore,
    );
  });

  it('joins a paused LB member after another fails and uses captured member buckets', async () => {
    const entered = gate();
    const release = gate();
    const failed = gate();
    const failure = new Error('External token store unavailable');
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', onUnhandled);
    let postcommit = false;
    const published = (): void => {
      postcommit = true;
    };
    callerSettingsOwner['modelNotifications'].on(
      CoreEvent.ModelProfileChanged,
      published,
    );
    class Store extends MemoryTokenStore {
      override async getToken(
        provider: string,
        bucket?: string,
      ): Promise<OAuthToken | null> {
        if (postcommit && provider === 'codex') {
          failed.release();
          throw failure;
        }
        if (postcommit && provider === 'claudecode') {
          entered.release();
          await release.promise;
        }
        return super.getToken(provider, bucket);
      }
    }
    const store = new Store();
    const oauth = new OAuthManager(store, undefined, {
      config: callerConfig,
      messageBus: callerPolicy.session.messageBus,
    });
    oauth.registerProvider(new CodexOAuthProvider(globalThis.fetch, store));
    oauth.registerProvider(
      new AnthropicOAuthProvider(
        (input, init) => globalThis.fetch(input, init),
        store,
      ),
    );
    for (const provider of ['codex', 'claudecode']) {
      const model = new FakeProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        callerConfig.getTargetDir(),
      );
      model.name = provider;
      model.baseProviderConfig = { baseURL: 'https://api.anthropic.com' };
      callerManager.registerProvider(model);
      await oauth.toggleOAuthEnabled(provider);
      for (const bucket of ['primary', 'secondary'])
        await store.saveToken(
          provider,
          makeExpiredToken(`${provider}-${bucket}`),
          `${provider}-${bucket}`,
        );
    }
    const member = standardProfile();
    if (member.type === 'loadbalancer')
      throw new Error('Expected standard profile');
    for (const provider of ['codex', 'claudecode'])
      await profileStore.saveProfile(provider, {
        ...member,
        provider,
        auth: {
          type: 'oauth',
          buckets: [`${provider}-primary`, `${provider}-secondary`],
        },
      });
    const agent = await fromConfig({
      oauthManager: oauth,
      settingsOwner: callerSettingsOwner,
      settingsService: callerSettings,
      providerManager: callerManager,
      config: callerConfig,
      mcpRuntime: callerMcp,
      messageBus: callerPolicy.session.messageBus,
    });
    const transport = spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init) => {
        if (
          String(input) !== 'https://console.anthropic.com/v1/oauth/token' ||
          !(init?.body instanceof URLSearchParams) ||
          init.body.get('grant_type') !== 'refresh_token'
        )
          throw new Error(`Unexpected network request: ${String(input)}`);
        return Response.json({
          access_token: 'native-rotated-access',
          refresh_token: 'native-rotated-refresh',
          expires_in: 120,
        });
      },
    );
    let settled = false;
    const operation = agent.profiles
      .applySnapshot(
        {
          version: 1,
          type: 'loadbalancer',
          policy: 'roundrobin',
          profiles: ['codex', 'claudecode'],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        },
        { profileName: 'parent-not-on-disk' },
      )
      .then(
        (value) => {
          settled = true;
          return { value };
        },
        (error: unknown) => {
          settled = true;
          return { error };
        },
      );
    try {
      await Promise.race([
        Promise.all([entered.promise, failed.promise]),
        operation.then((outcome) => {
          if ('error' in outcome) throw outcome.error;
          throw new Error('Application completed before both storage barriers');
        }),
      ]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect({ settled, applying: agent.profiles.isApplying() }).toStrictEqual({
        settled: false,
        applying: true,
      });
      expect(unhandled).toStrictEqual([]);
      release.release();
      const outcome = await operation;
      expect(outcome).toHaveProperty('error.committed', true);
      if (!('error' in outcome))
        throw new Error('Expected committed store failure');
      expect(causes(outcome.error)).toContain(failure);
      postcommit = false;
      expect(
        (await store.getToken('claudecode', 'claudecode-primary'))
          ?.access_token,
      ).toBe('native-rotated-access');
      expect(await store.getToken('claudecode', 'default')).toBeNull();
      expect(
        oauth.getSessionBucket('claudecode', {
          providerId: 'claudecode',
          profileId: 'claudecode',
        }),
      ).toBe('claudecode-primary');
      callerSettingsOwner['modelNotifications'].off(
        CoreEvent.ModelProfileChanged,
        published,
      );
      await agent.profiles.applySnapshot({
        version: 1,
        provider: 'fake',
        model: 'recovered',
        modelParams: {},
        ephemeralSettings: {},
      });
      const events = [];
      for await (const event of agent.stream('continue after sibling failure', {
        mcpDiscovery: 'skip',
      }))
        events.push(event);
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      expect(events.filter((event) => event.type === 'done')).toStrictEqual([
        { type: 'done', reason: 'stop' },
      ]);
      expect(unhandled).toStrictEqual([]);
    } finally {
      release.release();
      await operation;
      callerSettingsOwner['modelNotifications'].off(
        CoreEvent.ModelProfileChanged,
        published,
      );
      process.off('unhandledRejection', onUnhandled);
      await agent.dispose();
      transport.mockRestore();
    }
  }, 30000);
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
