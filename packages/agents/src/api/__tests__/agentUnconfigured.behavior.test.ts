import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
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
import {
  OwnershipRecord,
  StableDisplayCallbacksHolder,
} from '../agentBootstrap.js';
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
  afterEach as disposeOwnedPolicies,
  vi,
  beforeEach,
  afterEach,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import {
  AgentConfig,
  ProviderActivationIntent,
  EditorCallbacks,
} from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { ApprovalMode } from '@vybestack/llxprt-code-policy';
import {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  RuntimeProviderManager,
  UNCONFIGURED_PROVIDER,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import { AgentDeps, AgentImpl } from '../agentImpl.js';
import { AgentEvent } from '../event-types.js';
import { LoopHolder } from '../loop/rebuildLoop.js';
import { DisplayCallbacks } from '../../core/agenticLoop/types.js';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const createFilesystem = installTestWorkspaceFilesystem();

/**
 * Behavioral tests proving an Agent backed by a manager with no active
 * provider fails closed on every model-dependent operation (#2481).
 *
 * Uses a REAL recording client whose generation methods are vi.fn spies so we
 * can assert ZERO calls reached the client — the fail-closed guard fires
 * BEFORE any model/client/MCP interaction.
 */

function makeUnconfiguredProviderManager(): RuntimeProviderManager {
  const keys = new CredentialAuthority().createProviderKeyStorage();
  return {
    getProviderKeys: () => keys,
    hasActiveProvider: () => false,
    getActiveProvider: () => undefined,
    getActiveProviderName: () => undefined,
    listProviders: () => [],
    setConfig: () => {},
    registerProvider: () => {},
    setActiveProvider: () => {},
    clearActiveProvider: () => {},
    getAvailableModels: async () => [],
    accumulateSessionTokens: () => {},
    getSessionTokenUsage: () => ({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    }),
    getProviderMetrics: () => null,
    resetSessionTokenUsage: () => {},
    setTokenizerFactory: () => {},
    getTokenizerFactory: () => undefined,
  } as unknown as RuntimeProviderManager;
}

function makeUnconfiguredRuntimeState(): AgentRuntimeState {
  return {
    runtimeId: 'test-unconfigured-runtime',
    provider: UNCONFIGURED_PROVIDER,
    model: PLACEHOLDER_MODEL,
    sessionId: 'test-unconfigured-session',
    updatedAt: Date.now(),
  };
}

/**
 * Builds a client with vi.fn spies on every generation entry-point.
 * The spies are returned so tests can assert they were never called.
 */
function makeRecordingClient(): AgentClientContract & {
  __spies: {
    generateDirectMessage: ReturnType<typeof vi.fn>;
    generateJson: ReturnType<typeof vi.fn>;
    generateEmbedding: ReturnType<typeof vi.fn>;
    startChat: ReturnType<typeof vi.fn>;
    getChat: ReturnType<typeof vi.fn>;
  };
} {
  const generateDirectMessage = vi.fn(async () => ({
    content: { blocks: [] },
  }));
  const generateJson = vi.fn(async () => ({}));
  const generateEmbedding = vi.fn(async () => []);
  const startChat = vi.fn(async () => {});
  const getChat = vi.fn();

  const client = {
    isInitialized: () => true,
    bindTelemetry: () => {},
    bindRuntimeSettings: () => {},
    clearTools: () => {},
    getHistory: async () => [],
    setHistory: async () => {},
    addHistory: async () => {},
    restoreHistory: async () => {},
    resetChat: async () => {},
    updateSystemInstruction: async () => {},
    addDirectoryContext: async () => {},
    getChat,
    getHistoryService: () => null,
    storeHistoryServiceForReuse: () => {},
    hasChatInitialized: () => false,
    startChat,
    generateDirectMessage,
    generateJson,
    generateEmbedding,
    getCurrentSequenceModel: () => null,
  } as unknown as AgentClientContract;

  return Object.assign(client, {
    __spies: {
      generateDirectMessage,
      generateJson,
      generateEmbedding,
      startChat,
      getChat,
    },
  });
}

function makeLoopHolder(): LoopHolder {
  return {
    current: undefined,
    activeRunController: undefined,
    subscriptions: [],
  };
}

function makeOwnership(): OwnershipRecord {
  return {
    config: {
      dispose: async () => {},
    } as unknown as Config,
    messageBus: {} as MessageBus,
    loopHolder: makeLoopHolder(),
    runtimeState: makeUnconfiguredRuntimeState(),
    injectedSchedulerHandles: [],
    configOwnership: 'agent',
    disposed: false,
    lspShutDown: false,
    extensionsDisposed: false,
    sessionLocks: [],
    sessionLocksReleased: false,
  } as unknown as OwnershipRecord;
}

describe('AgentImpl: fail-closed when unconfigured (#2481)', () => {
  disposeOwnedPolicies(async () => {
    await Promise.all(ownedPolicies.splice(0).map((owner) => owner.dispose()));
  });

  async function makeDeps(
    manager: RuntimeProviderManager,
    client: AgentClientContract,
  ): Promise<AgentDeps> {
    const config = new Config({
      sessionId: 'test-unconfigured-session',
      targetDir: '/tmp',
      cwd: '/tmp',
      debugMode: false,
      model: PLACEHOLDER_MODEL,
      telemetry: { enabled: false },
    });
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    settingsOwner.bindTelemetry(config);
    const policy = ownPolicy();
    const workspace = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    disposeOwnedPolicies(async () => {
      await settingsOwner.dispose();
      await workspace.dispose();
      await config.dispose();
    });
    const messageBus = workspace.messageBus;
    const filesystem = createFilesystem({
      targetDir: config.getTargetDir(),
      isTrusted: () => true,
    });
    const mediaStore = new LocalMediaStore({
      rootDirectory: '/tmp/agent-unconfigured-media',
      quotaBytes: 1024,
    });
    Object.assign(client, {
      mediaStore,
      assertConfig: (candidate: Config) => {
        if (candidate !== config) throw new Error('Unexpected Config');
      },
      assertProviderManager: (candidate: RuntimeProviderManager) => {
        if (candidate !== manager)
          throw new Error('Unexpected provider manager');
      },
    });
    const factoriesTokenizer = configureProviderTokenizer(manager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    const sessionClient = await SessionClientOwner.create(
      config,
      assembleTaskSchemaPolicy(settingsService),
      manager,
      () => client,
      mediaStore,
      () => undefined,
      filesystem.paths,
      settingsOwner,
      factoriesContent,
      factoriesTokenizer,
      client,
    );
    const providerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    sessionClient.bindProviderFiles(providerFiles, () => ({}));
    sessionClient.bindMcpRuntime(workspace);
    sessionClient.bindHooks();
    disposeOwnedPolicies(() => sessionClient.dispose());
    return {
      settingsOwner,
      workspaceSkills: {
        list: () => [],
        find: () => undefined,
        activate: async () => {
          throw new Error('No skills configured');
        },
        reload: async () => {},
        isAdminEnabled: () => true,
      },
      mediaStore,
      sessionClient,
      taskLaunchOwner: new TaskLaunchOwner(new AsyncTaskManager()),
      shellOwner: new ShellJobOwner(() =>
        resolveShellJobSettings(settingsService),
      ),
      switchProvider: async () => {
        throw new Error('Unexpected provider switch');
      },
      config,
      mcpOperations: {
        trust: policy.trust,
        ide: {
          getClient: () => undefined,
          isEnabled: () => false,
          setEnabled: () => {},
        },
        profileDefinitions: workspace.profileDefinitions,
        profileWrites: workspace.profileWrites,
        subagentDefinitions: workspace.subagentDefinitions,
        subagentWrites: workspace.subagentWrites,
        checkpointOperations: workspace.checkpointOperations,
        closeAdmission: () => {},
        listPrompts: () => [],
        listResources: () => [],
        workspacePaths: filesystem.paths,
        workspaceFiles: filesystem.files,
        workspaceIgnore: filesystem.ignore,
        workspaceScans: filesystem.scans,
        workspaceSearch: filesystem.search,
        addWorkspaceDirectory: (directory) =>
          filesystem.addDirectory(directory),
        lspInspection: {
          read: async () => ({
            configured: undefined,
            alive: false,
            reason: undefined,
            statuses: [],
          }),
        },
        policyInspection: ownPolicy().session.inspection,
        performOAuth: async () => {
          throw new Error('Unexpected MCP OAuth');
        },
        readOAuthCredentials: async () => null,
        readServerSettings: () => ({
          mcpServers: {},
          blockedMcpServers: [],
          settingsMcpServers: {},
        }),
        subscribeStatus: () => () => {},
        reload: async () => {},
        findResource: () => undefined,
        readResource: async () => {
          throw new Error('No MCP server configured');
        },
        status: () => undefined,
        refresh: async () => {},
        awaitDiscovery: async () => new Map(),
      },
      providerManager: manager,
      oauthManager: {
        dispose: async () => {},
        attachAddItemToProviders: () => {},
      } as unknown as OAuthManager,
      settingsService,
      runtimeId: 'test-unconfigured-runtime',
      runtimeHandle: { cleanup: () => {} },
      messageBus,
      loopHolder: makeLoopHolder(),
      runtimeState: makeUnconfiguredRuntimeState(),
      ownership: makeOwnership(),
      sessionIdentityOwnership: 'config',
      rebuildLoop: () => {},
      resolveClient: () => client,
      displayCallbacks: {} as unknown as DisplayCallbacks,
      editorCallbacksHolder: { editorCallbacks: {} as EditorCallbacks },
      displayCallbacksHolder: {} as unknown as StableDisplayCallbacksHolder,
    };
  }

  let manager: RuntimeProviderManager;
  let client: ReturnType<typeof makeRecordingClient>;
  let deps: AgentDeps;
  let agent: AgentImpl;

  beforeEach(async () => {
    manager = makeUnconfiguredProviderManager();
    client = makeRecordingClient();
    deps = await makeDeps(manager, client);
    agent = new AgentImpl(deps, async () => {
      throw new Error('Unexpected model selection');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stream yields error + done with actionable /setup message', async () => {
    const {
      errorEvent,
      doneEvent,
      errorIdx,
      doneIdx,
      doneTyped,
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
      streamYieldsErrorDoneWithActionableSetupMessageObservation2,
    } = await observeStreamYieldsErrorDoneWithActionableSetupMessage();
    expect(errorEvent).toBeDefined();
    expect(doneEvent).toBeDefined();
    expect(
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
    ).toContain('/setup');
    expect(streamYieldsErrorDoneWithActionableSetupMessageObservation2).toBe(
      'error',
    );
    expect(errorIdx).toBeLessThan(doneIdx);
    expect(doneTyped.finished).toBeUndefined();
  });

  const observeStreamYieldsErrorDoneWithActionableSetupMessage = async () => {
    const events: AgentEvent[] = [];
    for await (const event of agent.stream('hello')) {
      events.push(event);
    }
    const errorEvent = events.find((e) => e.type === 'error');
    const doneEvent = events.find((e) => e.type === 'done');

    // Event contract: the error event precedes the done event, and the done
    // event carries reason 'error' without a finished payload (the error
    // details live on the error event, not the done event's optional
    // `finished` field).
    const errorIdx = events.findIndex((e) => e.type === 'error');
    const doneIdx = events.findIndex((e) => e.type === 'done');

    // doneEvent is guaranteed to be the 'done' variant by the assertion above.
    const doneTyped = doneEvent as Extract<
      (typeof events)[number],
      { type: 'done' }
    >;

    const streamYieldsErrorDoneWithActionableSetupMessageObservation1 =
      errorEvent?.type === 'error' && errorEvent.error.message;
    const streamYieldsErrorDoneWithActionableSetupMessageObservation2 =
      doneEvent?.type === 'done' && doneEvent.reason;
    return {
      errorEvent,
      doneEvent,
      errorIdx,
      doneIdx,
      doneTyped,
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
      streamYieldsErrorDoneWithActionableSetupMessageObservation2,
    };
  };

  it('stream makes ZERO generation calls to the client', async () => {
    for await (const _event of agent.stream('hello')) {
      // drain
    }
    expect(client.__spies.generateDirectMessage).not.toHaveBeenCalled();
    expect(client.__spies.generateJson).not.toHaveBeenCalled();
    expect(client.__spies.generateEmbedding).not.toHaveBeenCalled();
    expect(client.__spies.startChat).not.toHaveBeenCalled();
    expect(client.__spies.getChat).not.toHaveBeenCalled();
  });

  it('chat returns AgentResult with error and done reason error', async () => {
    const result = await agent.chat('hello');
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('/setup');
    expect(result.finishReason).toBe('error');
  });

  it('chat makes ZERO generation calls to the client', async () => {
    await agent.chat('hello');
    expect(client.__spies.generateDirectMessage).not.toHaveBeenCalled();
    expect(client.__spies.startChat).not.toHaveBeenCalled();
  });

  it('generate rejects with actionable /setup error', async () => {
    await expect(agent.generate('hello')).rejects.toThrow('/setup');
    expect(client.__spies.generateDirectMessage).not.toHaveBeenCalled();
  });

  it('generateJson rejects with actionable /setup error', async () => {
    await expect(agent.generateJson([], { type: 'object' })).rejects.toThrow(
      '/setup',
    );
    expect(client.__spies.generateJson).not.toHaveBeenCalled();
  });

  it('generateEmbedding rejects with actionable /setup error', async () => {
    await expect(agent.generateEmbedding(['hello'])).rejects.toThrow('/setup');
    expect(client.__spies.generateEmbedding).not.toHaveBeenCalled();
  });

  it('setModel rejects with actionable /setup error', async () => {
    await expect(agent.setModel('gpt-4')).rejects.toThrow('/setup');
  });

  it('compress rejects with actionable /setup error', async () => {
    await expect(agent.compress()).rejects.toThrow('/setup');
  });

  it('getProvider returns sentinel UNCONFIGURED_PROVIDER when unconfigured', () => {
    expect(agent.getProvider()).toBe(UNCONFIGURED_PROVIDER);
  });

  it('getProviderStatus does not expose the UNCONFIGURED_PROVIDER sentinel', () => {
    const status = agent.getProviderStatus();
    // The sentinel must not be exposed as a real provider name in public status.
    expect(status.provider).not.toBe(UNCONFIGURED_PROVIDER);
    // A neutral empty string is the safe representation.
    expect(status.provider).toBe('');
    expect(status.provider).not.toBe('gemini');
    expect(status.provider).not.toBe('openai');
    expect(status.provider).not.toBe('anthropic');
  });

  it('setProvider from unconfigured returns previousProvider null, not sentinel (#2481)', async () => {
    const { result } =
      await observeSetProviderFromUnconfiguredReturnsPreviousProviderNullNotSentinel2481();
    expect(result.previousProvider).toBeNull();
  });

  const observeSetProviderFromUnconfiguredReturnsPreviousProviderNullNotSentinel2481 =
    async () => {
      // Under the fake seam, switchActiveProvider throws (no registered runtime)
      // but the error is swallowed — the sentinel must NOT leak as previousProvider.
      const prevFake = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = '/tmp/fake-unconfigured-test.jsonl';
      try {
        const result = await agent.setProvider('openai');

        return { result };
      } finally {
        if (prevFake === undefined) {
          delete process.env.LLXPRT_FAKE_RESPONSES;
        } else {
          process.env.LLXPRT_FAKE_RESPONSES = prevFake;
        }
      }
    };
});

describe('fromConfig real orchestration: configured vs unconfigured (#2481)', () => {
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
  let builtCallerConfig: Config;
  let builtCallerSettings: SettingsService;
  let builtCallerSettingsOwner: SessionSettingsOwner;
  let builtCallerPolicy: RuntimePolicyOwner;
  let builtCallerMcp: McpRuntimeOwner;
  let builtCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let builtCallerOwner: SessionClientOwner;
  let builtCallerClose: () => Promise<void>;
  let builtCallerFactories: AgentRuntimeFactoryBindings;
  let builtCallerRelease: AcquisitionRelease;
  let builtCallerFiles: ProviderFileLifecycle;
  let builtCallerRuntimeId: string;
  let builtCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let builtCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let builtCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function openbuiltCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'builtCaller-adoption-')),
    );
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...overrides,
      workingDir:
        overrides.workingDir === undefined
          ? directory
          : await realpath(overrides.workingDir),
    };
    const parameters = { ...toConfigParameters(selection), ...skillSettings };
    parameters.interactive = true;
    if (overrides.hooks !== undefined) parameters.enableHooks = true;
    if (
      overrides.filesystemOwner === undefined &&
      (overrides.harness?.includeProcessCwd ?? true)
    )
      parameters.includeDirectories = [
        ...(parameters.includeDirectories ?? []),
        process.cwd(),
      ];
    builtCallerConfig = new Config(parameters);
    builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    builtCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtCallerConfig.getInitialSettings(),
    ))
      builtCallerSettings.set(key, value);
    builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
    injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
    builtCallerMcp = await buildTestMcpRuntime(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      builtCallerPolicy,
      skillOperations,
    );
    acquirebuiltCallerProviders();
    const media = new SessionMediaOwner(
      builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    builtCallerOwner = await SessionClientOwner.create(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      builtCallerFactories.agentClientFactory,
      media.store,
      builtCallerMcp.readInstructions,
      builtCallerMcp.workspacePaths,
      builtCallerSettingsOwner,
      builtCallerContent,
      builtCallerTokenizer,
    );
    builtCallerOwner.bindMcpRuntime(builtCallerMcp);
    builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
      builtCallerOAuth.composeRetryOperations(provider),
    );
    builtCallerOwner.bindHooks();
    builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtCallerOwner.dispose(),
        () => builtCallerRelease.close(),
        () => media.dispose(),
        () => builtCallerMcp.dispose(),
        () => builtCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerSettingsOwner,
        builtCallerManager,
        builtCallerOAuth,
        builtCallerRuntimeId,
        builtCallerTokenizer,
        undefined,
      );
      await builtCallerMcp.initialize();
      await activatebuiltCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }
  }
  function acquirebuiltCallerProviders(): void {
    builtCallerRuntimeId = 'builtCaller-' + randomUUID();
    builtCallerRelease = new AcquisitionRelease();
    builtCallerSettingsOwner = new SessionSettingsOwner(builtCallerSettings);
    builtCallerRelease.acquire('settings', () =>
      builtCallerSettingsOwner.dispose(),
    );
    builtCallerSettingsOwner.initializeProviderSelection(
      builtCallerConfig.getProvider(),
      builtCallerConfig.getModel(),
    );
    builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
    builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      builtCallerRuntimeId,
      builtCallerConfig.getSessionId(),
    ])
      builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtCallerFiles, scope),
      );
    builtCallerManager = acquirePreferredProviderManager(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerSettingsOwner,
      builtCallerFiles,
      builtCallerRuntimeId,
      builtCredentials().authority,
      builtCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(builtCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    builtCallerTokenizer = factoriesTokenizer;
    builtCallerContent = factoriesContent;
    builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerConfig,
      builtCallerSettings,
      builtCallerManager,
      builtCallerRuntimeId,
      builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      builtCallerRelease,
      undefined,
    );
  }
  async function activatebuiltCallerClient(
    intent: ProviderActivationIntent = {
      provider: builtCallerConfig.getProvider(),
      model: builtCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      builtCallerConfig,
      intent,
      assembleProviderSwitch(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerManager,
        builtCallerOAuth,
        () => 'agent',
        () => builtCallerOwner.refreshAuth(),
        builtCallerSettingsOwner,
      ),
      builtCallerSettings,
      builtCallerManager,
      (method) => builtCallerOwner.refreshAuth(method),
      assembleModelSelection(builtCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await builtCallerOwner.initializeTools();
    await builtCallerOwner.getAgentClient().startChat();
  }

  disposeOwnedPolicies(async () => {
    await Promise.all(ownedPolicies.splice(0).map((owner) => owner.dispose()));
  });

  it('fromConfig over a real Config (buildCliStyleConfig) drives a real turn when configured', async () => {
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');

    await openbuiltCaller('plain-text.jsonl');
    try {
      // The real Config has FakeProvider active (configured state).
      expect(builtCallerManager.hasActiveProvider()).toBe(true);

      const agent = await fromConfig({
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        config: builtCallerConfig,
        messageBus: builtCallerPolicy.session.messageBus,
        mcpRuntime: builtCallerMcp,
      });
      try {
        // A real stream turn must resolve with exactly one done event.
        const events: Array<{ type: string; reason?: string }> = [];
        for await (const event of agent.stream('hello')) {
          events.push(event as { type: string; reason?: string });
        }
        const doneEvents = events.filter((e) => e.type === 'done');
        expect(doneEvents).toHaveLength(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await builtCallerClose();
    }
  });

  it('first Agent selection: fromConfig picks up the configured active provider', async () => {
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');

    await openbuiltCaller('plain-text.jsonl');
    try {
      const agent = await fromConfig({
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        config: builtCallerConfig,
        messageBus: builtCallerPolicy.session.messageBus,
        mcpRuntime: builtCallerMcp,
      });
      try {
        // The agent should reflect the active FakeProvider, not a sentinel.
        const provider = agent.getProvider();
        expect(provider).toBeDefined();
        expect(provider).not.toBe('unconfigured');
      } finally {
        await agent.dispose();
      }
    } finally {
      await builtCallerClose();
    }
  });
});

const ownedPolicies: RuntimePolicyOwner[] = [];
function ownPolicy(): RuntimePolicyOwner {
  const owner = new RuntimePolicyOwner({
    getPolicyEngineConfig: () => ({}),
    getMcpServers: () => ({}),
    getApprovalMode: () => ApprovalMode.DEFAULT,
    getDebugMode: () => false,
    initialWorkspaceTrust: true,
  });
  ownedPolicies.push(owner);
  return owner;
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
