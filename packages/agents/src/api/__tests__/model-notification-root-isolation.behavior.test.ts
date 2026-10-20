import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
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
  type GenerateChatOptions,
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
import { assembleProfileApplication } from '../profileApplicationAssembly.js';
import { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Gate was not initialized');
  };
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('session-owned model notifications', () => {
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
    await runCleanupSteps([
      () => aProfileOAuth.dispose(),
      () => aCallerClose(),
    ]);
  });

  const aCredentials = useOwnedCredentials();
  let aCallerConfig: Config;
  let aCallerSettings: SettingsService;
  let aCallerSettingsOwner: SessionSettingsOwner;
  let aCallerPolicy: RuntimePolicyOwner;
  let aCallerMcp: McpRuntimeOwner;
  let aCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let aCallerOwner: SessionClientOwner;
  let aCallerClose: () => Promise<void>;
  const aCallerFactories = createAgentRuntimeFactoryBindings();
  let aCallerRelease: AcquisitionRelease;
  let aCallerFiles: ProviderFileLifecycle;
  let aCallerRuntimeId: string;
  let aCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let aCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let aCallerContent: ReturnType<typeof createRuntimeContentGeneratorFactory>;

  async function openACaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'aCaller-adoption-')),
    );
    aCallerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    aCallerSettings = new SettingsService();
    aCallerPolicy = new RuntimePolicyOwner(aCallerConfig);
    injectConfirmationForcingPolicy(aCallerPolicy.session.confirmation);
    aCallerMcp = await buildTestMcpRuntime(
      aCallerConfig,
      aCallerPolicy.session.messageBus,
      {},
      undefined,
      aCallerPolicy,
    );
    acquireACallerProviders();
    const media = new SessionMediaOwner(
      aCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    aCallerOwner = await createCapturedSessionOwner(
      aCallerConfig,
      assembleTaskSchemaPolicy(aCallerSettings),
      aCallerManager,
      aCallerFactories.agentClientFactory,
      media.store,
      aCallerMcp.readInstructions,
      aCallerMcp.workspacePaths,
      aCallerSettingsOwner,
      aCallerContent,
      aCallerTokenizer,
    );
    aCallerOwner.bindMcpRuntime(aCallerMcp);
    aCallerOwner.bindProviderFiles(aCallerFiles, (provider) =>
      aCallerOAuth.composeRetryOperations(provider),
    );
    aCallerOwner.bindHooks();
    aCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => aCallerOwner.dispose(),
        () => aCallerRelease.close(),
        () => media.dispose(),
        () => aCallerMcp.dispose(),
        () => aCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        aCallerConfig,
        aCallerSettings,
        aCallerSettingsOwner,
        aCallerManager,
        aCallerOAuth,
        aCallerRuntimeId,
        aCallerTokenizer,
        undefined,
      );
      await aCallerMcp.initialize();
      await activateACallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, aCallerClose);
    }
  }
  function acquireACallerProviders(): void {
    aCallerRuntimeId = 'aCaller-' + randomUUID();
    aCallerRelease = new AcquisitionRelease();
    aCallerSettingsOwner = new SessionSettingsOwner(aCallerSettings);
    aCallerRelease.acquire('settings', () => aCallerSettingsOwner.dispose());
    aCallerSettingsOwner.initializeProviderSelection(
      aCallerConfig.getProvider(),
      aCallerConfig.getModel(),
    );
    aCallerSettingsOwner.bindTelemetry(aCallerConfig);
    aCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [aCallerRuntimeId, aCallerConfig.getSessionId()])
      aCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(aCallerFiles, scope),
      );
    aCallerManager = acquirePreferredProviderManager(
      aCallerConfig,
      aCallerSettings,
      aCallerSettingsOwner,
      aCallerFiles,
      aCallerRuntimeId,
      aCredentials().authority,
      aCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(aCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    aCallerTokenizer = factoriesTokenizer;
    aCallerContent = factoriesContent;
    aCallerOAuth = acquirePreferredOAuth(
      undefined,
      aCallerPolicy.session.messageBus,
      aCallerConfig,
      aCallerSettings,
      aCallerManager,
      aCallerRuntimeId,
      aCallerMcp.profileDefinitions,
      aCredentials().authority,
      aCallerRelease,
      undefined,
    );
  }
  async function activateACallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      aCallerConfig,
      {
        provider: aCallerConfig.getProvider(),
        model: aCallerConfig.getModel(),
      },
      assembleProviderSwitch(
        aCallerConfig,
        aCallerSettings,
        aCallerManager,
        aCallerOAuth,
        () => 'agent',
        () => aCallerOwner.refreshAuth(),
        aCallerSettingsOwner,
      ),
      aCallerSettings,
      aCallerManager,
      (method) => aCallerOwner.refreshAuth(method),
      assembleModelSelection(aCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await aCallerOwner.initializeTools();
    await capturedSessionClient(aCallerOwner).startChat();
  }

  let aProfileStore: ProfileDefinitionReads & ProfileDefinitionWrites;
  let aProfileOAuth: OAuthManager;
  let aProfileSwitch: ProviderSwitcher;
  let aProfileAuthenticationRequests: string[];
  beforeEach(async () => {
    await openACaller('plain-text.jsonl');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const providers = new Map<string, FakeProvider>();
    for (const name of ['openai', 'anthropic', 'gemini', 'zai', 'openrouter']) {
      const provider = new FakeProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        aCallerConfig.getTargetDir(),
      );
      provider.name = name;
      provider.baseProviderConfig = { baseURL: '' };
      aCallerManager.registerProvider(provider);
      providers.set(name, provider);
    }

    aProfileStore = {
      ...aCallerMcp.profileDefinitions,
      ...aCallerMcp.profileWrites,
    };
    aProfileOAuth = new OAuthManager(emptyTokenStore(), undefined, {
      config: aCallerConfig,
      messageBus: aCallerPolicy.session.messageBus,
    });
    aProfileAuthenticationRequests = [];
    for (const name of providers.keys())
      aProfileOAuth.registerProvider({
        name,
        initiateAuth: async () => {
          aProfileAuthenticationRequests.push(name);
          throw new Error('Unexpected interactive authentication');
        },
        getToken: async () => null,
        refreshToken: async () => null,
      });
    aProfileSwitch = assembleProviderSwitch(
      aCallerConfig,
      aCallerSettings,
      aCallerManager,
      aProfileOAuth,
      () => undefined,
      () => aCallerOwner.refreshAuth(),
      aCallerSettingsOwner,
    );
    assembleProfileApplication(
      aCallerSettings,
      aCallerManager,
      aProfileOAuth,
      aProfileSwitch,
      aCallerSettingsOwner,
      aProfileStore,
    );
  });

  afterEach(async () => {
    await runCleanupSteps([
      () => bProfileOAuth.dispose(),
      () => bCallerClose(),
    ]);
  });

  const bCredentials = useOwnedCredentials();
  let bCallerConfig: Config;
  let bCallerSettings: SettingsService;
  let bCallerSettingsOwner: SessionSettingsOwner;
  let bCallerPolicy: RuntimePolicyOwner;
  let bCallerMcp: McpRuntimeOwner;
  let bCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let bCallerOwner: SessionClientOwner;
  let bCallerClose: () => Promise<void>;
  const bCallerFactories = createAgentRuntimeFactoryBindings();
  let bCallerRelease: AcquisitionRelease;
  let bCallerFiles: ProviderFileLifecycle;
  let bCallerRuntimeId: string;
  let bCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let bCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let bCallerContent: ReturnType<typeof createRuntimeContentGeneratorFactory>;

  async function openBCaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'bCaller-adoption-')),
    );
    bCallerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    bCallerSettings = new SettingsService();
    bCallerPolicy = new RuntimePolicyOwner(bCallerConfig);
    injectConfirmationForcingPolicy(bCallerPolicy.session.confirmation);
    bCallerMcp = await buildTestMcpRuntime(
      bCallerConfig,
      bCallerPolicy.session.messageBus,
      {},
      undefined,
      bCallerPolicy,
    );
    acquireBCallerProviders();
    const media = new SessionMediaOwner(
      bCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    bCallerOwner = await createCapturedSessionOwner(
      bCallerConfig,
      assembleTaskSchemaPolicy(bCallerSettings),
      bCallerManager,
      bCallerFactories.agentClientFactory,
      media.store,
      bCallerMcp.readInstructions,
      bCallerMcp.workspacePaths,
      bCallerSettingsOwner,
      bCallerContent,
      bCallerTokenizer,
    );
    bCallerOwner.bindMcpRuntime(bCallerMcp);
    bCallerOwner.bindProviderFiles(bCallerFiles, (provider) =>
      bCallerOAuth.composeRetryOperations(provider),
    );
    bCallerOwner.bindHooks();
    bCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => bCallerOwner.dispose(),
        () => bCallerRelease.close(),
        () => media.dispose(),
        () => bCallerMcp.dispose(),
        () => bCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        bCallerConfig,
        bCallerSettings,
        bCallerSettingsOwner,
        bCallerManager,
        bCallerOAuth,
        bCallerRuntimeId,
        bCallerTokenizer,
        undefined,
      );
      await bCallerMcp.initialize();
      await activateBCallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, bCallerClose);
    }
  }
  function acquireBCallerProviders(): void {
    bCallerRuntimeId = 'bCaller-' + randomUUID();
    bCallerRelease = new AcquisitionRelease();
    bCallerSettingsOwner = new SessionSettingsOwner(bCallerSettings);
    bCallerRelease.acquire('settings', () => bCallerSettingsOwner.dispose());
    bCallerSettingsOwner.initializeProviderSelection(
      bCallerConfig.getProvider(),
      bCallerConfig.getModel(),
    );
    bCallerSettingsOwner.bindTelemetry(bCallerConfig);
    bCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [bCallerRuntimeId, bCallerConfig.getSessionId()])
      bCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(bCallerFiles, scope),
      );
    bCallerManager = acquirePreferredProviderManager(
      bCallerConfig,
      bCallerSettings,
      bCallerSettingsOwner,
      bCallerFiles,
      bCallerRuntimeId,
      bCredentials().authority,
      bCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(bCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    bCallerTokenizer = factoriesTokenizer;
    bCallerContent = factoriesContent;
    bCallerOAuth = acquirePreferredOAuth(
      undefined,
      bCallerPolicy.session.messageBus,
      bCallerConfig,
      bCallerSettings,
      bCallerManager,
      bCallerRuntimeId,
      bCallerMcp.profileDefinitions,
      bCredentials().authority,
      bCallerRelease,
      undefined,
    );
  }
  async function activateBCallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      bCallerConfig,
      {
        provider: bCallerConfig.getProvider(),
        model: bCallerConfig.getModel(),
      },
      assembleProviderSwitch(
        bCallerConfig,
        bCallerSettings,
        bCallerManager,
        bCallerOAuth,
        () => 'agent',
        () => bCallerOwner.refreshAuth(),
        bCallerSettingsOwner,
      ),
      bCallerSettings,
      bCallerManager,
      (method) => bCallerOwner.refreshAuth(method),
      assembleModelSelection(bCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await bCallerOwner.initializeTools();
    await capturedSessionClient(bCallerOwner).startChat();
  }

  let bProfileStore: ProfileDefinitionReads & ProfileDefinitionWrites;
  let bProfileOAuth: OAuthManager;
  let bProfileSwitch: ProviderSwitcher;
  let bProfileAuthenticationRequests: string[];
  beforeEach(async () => {
    await openBCaller('plain-text.jsonl');
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const providers = new Map<string, FakeProvider>();
    for (const name of ['openai', 'anthropic', 'gemini', 'zai', 'openrouter']) {
      const provider = new FakeProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        bCallerConfig.getTargetDir(),
      );
      provider.name = name;
      provider.baseProviderConfig = { baseURL: '' };
      bCallerManager.registerProvider(provider);
      providers.set(name, provider);
    }

    bProfileStore = {
      ...bCallerMcp.profileDefinitions,
      ...bCallerMcp.profileWrites,
    };
    bProfileOAuth = new OAuthManager(emptyTokenStore(), undefined, {
      config: bCallerConfig,
      messageBus: bCallerPolicy.session.messageBus,
    });
    bProfileAuthenticationRequests = [];
    for (const name of providers.keys())
      bProfileOAuth.registerProvider({
        name,
        initiateAuth: async () => {
          bProfileAuthenticationRequests.push(name);
          throw new Error('Unexpected interactive authentication');
        },
        getToken: async () => null,
        refreshToken: async () => null,
      });
    bProfileSwitch = assembleProviderSwitch(
      bCallerConfig,
      bCallerSettings,
      bCallerManager,
      bProfileOAuth,
      () => undefined,
      () => bCallerOwner.refreshAuth(),
      bCallerSettingsOwner,
    );
    assembleProfileApplication(
      bCallerSettings,
      bCallerManager,
      bProfileOAuth,
      bProfileSwitch,
      bCallerSettingsOwner,
      bProfileStore,
    );
  });

  it('changes A without invalidating B chat, history or admitted model selection', async () => {
    await capturedSessionClient(aCallerOwner).startChat();
    await capturedSessionClient(bCallerOwner).startChat();
    const bClient = capturedSessionClient(bCallerOwner);
    const bChat = bClient.getChat();
    const bHistory = bClient.getHistory();
    const bModel = bCallerSettingsOwner.readSelectedModel();
    const bSequence = bClient.getCurrentSequenceModel();

    await aProfileSwitch('anthropic');

    expect(bClient.hasChatInitialized()).toBe(true);
    expect(bClient.getChat()).toBe(bChat);
    expect(bClient.getHistory()).toStrictEqual(bHistory);
    expect(bClient.getCurrentSequenceModel()).toBe(bSequence);
    expect(bCallerSettingsOwner.readSelectedModel()).toBe(bModel);
    expect(aCallerSettingsOwner.readSelectedProvider()).toBe('anthropic');

    const publication = aCallerSettingsOwner.beginModelPublication();
    aCallerSettingsOwner.chooseModel('changed-in-a');
    publication.commit();
    expect(bClient.getChat()).toBe(bChat);
    expect(bCallerSettingsOwner.readSelectedModel()).toBe(bModel);

    const notices: unknown[] = [];
    const release = aCallerSettingsOwner.subscribeModelChanges((profile) => {
      notices.push(profile);
    });
    await expect(aProfileSwitch('missing-provider')).rejects.toThrow(
      "Provider 'missing-provider' not found",
    );
    expect(notices).toStrictEqual([]);
    release();
    expect(bClient.getChat()).toBe(bChat);
    await aCallerClose();
    expect(bClient.getChat()).toBe(bChat);
    await bClient.startChat();
    expect(bClient.hasChatInitialized()).toBe(true);
  });

  it('keeps B admitted request and chat usable while its provider response is held during A switch', async () => {
    const entered = gate();
    const releaseResponse = gate();
    const admittedModels: unknown[] = [];
    class HeldProvider extends FakeProvider {
      override async *generateChatCompletion(
        options: GenerateChatOptions | IContent[],
      ): AsyncIterableIterator<IContent> {
        if (Array.isArray(options))
          throw new Error('Expected admitted provider request');
        admittedModels.push(options.invocation?.getEphemeral('model'));
        entered.resolve();
        await releaseResponse.promise;
        yield* super.generateChatCompletion(options);
      }
    }
    bCallerManager.registerProvider(
      new HeldProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        bCallerConfig.getTargetDir(),
      ),
    );
    const agentB = await fromConfig(
      bCallerConfig,
      bCallerSettings,
      {},
      bCallerSettingsOwner,
      bCallerManager,
      bProfileOAuth,
      bCallerPolicy.session.messageBus,
      bCallerMcp,
    );
    await fixtureAgentResources(agentB).publishedClient(agentB).startChat();
    const chat = fixtureAgentResources(agentB)
      .publishedClient(agentB)
      .getChat();
    const model = bCallerSettingsOwner.readSelectedModel();
    const completion = (async () => {
      const events = [];
      for await (const event of agentB.stream('Keep this request bound to B', {
        mcpDiscovery: 'skip',
      }))
        events.push(event);
      return events;
    })();
    try {
      await entered.promise;
      await aProfileSwitch('anthropic');
      expect(
        fixtureAgentResources(agentB).publishedClient(agentB).getChat(),
      ).toBe(chat);
      releaseResponse.resolve();
      const events = await completion;
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      expect(events.some((event) => event.type === 'done')).toBe(true);
      expect(admittedModels).toStrictEqual([model]);
      expect(
        fixtureAgentResources(agentB)
          .publishedClient(agentB)
          .hasChatInitialized(),
      ).toBe(true);
      expect(
        fixtureAgentResources(agentB).publishedClient(agentB).getChat(),
      ).toBe(chat);
      expect(
        (await agentB.getHistory()).some(
          (message) => message.speaker === 'human',
        ),
      ).toBe(true);
    } finally {
      releaseResponse.resolve();
      await completion;
      await agentB.dispose();
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
