import { buildOwnedMcpControl } from '../control/mcpControlWiring.js';
import { createAgentAuthState } from '../control/authState.js';
import { WorkspaceControl } from '../control/workspaceControl.js';
import { assembleIdeControl } from '../control/ideControl.js';
import { LspControl } from '../control/lspControl.js';
import { assembleSessionAuthentication } from '../control/session-authentication.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import {
  OwnershipRecord,
  StableDisplayCallbacksHolder,
} from '../agentBootstrap.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import {
  describe,
  expect,
  it,
  afterEach as disposeOwnedPolicies,
  vi,
  beforeEach,
  afterEach,
} from 'bun:test';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { EditorCallbacks } from '../config-types.js';
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
import { AgentImpl } from '../agentImpl.js';
import { AgentEvent } from '../event-types.js';

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

function makeOwnership(): OwnershipRecord {
  return {
    config: {
      dispose: async () => {},
    } as unknown as Config,
    messageBus: {} as MessageBus,
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

  async function makeAgent(
    manager: RuntimeProviderManager,
    client: AgentClientContract,
  ): Promise<AgentImpl> {
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
    sessionClient.initializeExecution(undefined, undefined, undefined);
    disposeOwnedPolicies(() => sessionClient.dispose());
    const facadeMcp: import('../mcpRuntimeAssembly.js').AgentMcpOperations = {
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
      addWorkspaceDirectory: (directory) => filesystem.addDirectory(directory),
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
    };
    const mcpAuth = createAgentAuthState();
    return new AgentImpl(
      settingsOwner,
      sessionClient,
      {
        list: () => [],
        find: () => undefined,
        activate: async () => {
          throw new Error('No skills configured');
        },
        reload: async () => {},
        isAdminEnabled: () => true,
      },
      mediaStore,
      undefined,
      new TaskLaunchOwner(new AsyncTaskManager()),
      new ShellJobOwner(() => resolveShellJobSettings(settingsService)),
      new WorkspaceControl(
        facadeMcp.profileDefinitions,
        facadeMcp.profileWrites,
        facadeMcp.subagentDefinitions,
        facadeMcp.subagentWrites,
        facadeMcp.checkpointOperations,
        facadeMcp.workspaceIgnore,
        facadeMcp.workspaceSearch,
        facadeMcp.workspaceFiles,
        facadeMcp.workspacePaths.contains,
        facadeMcp.workspacePaths.directories,
        facadeMcp.addWorkspaceDirectory,
        config.getTargetDir(),
        config.getProjectRoot(),
      ),
      assembleIdeControl(facadeMcp.trust, facadeMcp.ide, () => ({})),
      new LspControl(facadeMcp.lspInspection),
      (...args) => facadeMcp.awaitDiscovery(...args),
      (...args) => facadeMcp.closeAdmission(...args),
      buildOwnedMcpControl(
        (...args) => facadeMcp.readServerSettings(...args),
        sessionClient.toolCatalog.selection,
        (...args) => facadeMcp.listPrompts(...args),
        (...args) => facadeMcp.listResources(...args),
        (...args) => facadeMcp.readOAuthCredentials(...args),
        (...args) => facadeMcp.performOAuth(...args),
        (...args) => facadeMcp.status(...args),
        (...args) => facadeMcp.refresh(...args),
        (...args) => facadeMcp.reload(...args),
        (server) => mcpAuth.mcpAuth.has(server),
        (server) => mcpAuth.mcpAuth.add(server),
        () => sessionClient.getAgentClient().setTools(),
        (...args) => facadeMcp.subscribeStatus(...args),
        (...args) => facadeMcp.findResource(...args),
        (...args) => facadeMcp.readResource(...args),
      ),
      mcpAuth,
      config,
      manager,
      {
        dispose: async () => {},
        attachAddItemToProviders: () => {},
      } as unknown as OAuthManager,
      () => 'agent',
      settingsService,
      'test-unconfigured-runtime',
      () => {},
      messageBus,
      makeUnconfiguredRuntimeState(),
      makeOwnership(),
      'config',
      () => client,
      undefined,
      { editorCallbacks: {} as EditorCallbacks },
      {} as unknown as StableDisplayCallbacksHolder,
      undefined,
      undefined,
      undefined,
      async () => {
        throw new Error('Unexpected model selection');
      },
      assembleSessionAuthentication(undefined, () => {}),
    );
  }

  let manager: RuntimeProviderManager;
  let client: ReturnType<typeof makeRecordingClient>;
  let agent: AgentImpl;

  beforeEach(async () => {
    manager = makeUnconfiguredProviderManager();
    client = makeRecordingClient();
    agent = await makeAgent(manager, client);
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
