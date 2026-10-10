import {
  fixtureMcpRevision,
  fixtureMcpHostSettings,
  connectFixtureManager,
} from './fixture-mcp-revision.js';
const TEST_SKILL_OPERATIONS: WorkspaceSkillAssemblyOperations = {
  reloadPolicy: async () => ({}),
  registerTools: () => {},
};
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/modelEnvelope.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type {
  WorkspaceTrustControlPort,
  WorkspaceTrustReadPort,
} from '@vybestack/llxprt-code-core';

import { fixtureMcpHost } from './fixture-mcp-host.js';
import { assembleFixtureWorkspace } from './fixture-workspace-assembly.js';

import { closeFixtureWorkspace } from './fixture-workspace-cleanup.js';
import {
  assembleWorkspaceMemory,
  type WorkspaceMemoryOwner,
} from '@vybestack/llxprt-code-core';

import { afterEach } from 'bun:test';
import type {
  ToolSelection,
  McpToolPublication,
  RegistryPolicy,
} from '@vybestack/llxprt-code-tools';
export {
  installTestWorkspaceFilesystem,
  installTestWorkspacePaths,
} from './workspace-filesystem.js';
import {
  WorkspaceToolCatalogOwner,
  WorkspaceMcpCatalogOwner,
} from '@vybestack/llxprt-code-core';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SimpleExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  WorkspaceExtensionOwner,
  WorkspaceExtensionOperations,
} from '@vybestack/llxprt-code-core/utils/workspace-extension-owner.js';
import type {
  ExtensionLoader,
  ExtensionRuntimeConfiguration,
} from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { WorkspaceSkillConfiguration } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { WorkspaceSkillOwner } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';

import type { McpHostConfig } from '@vybestack/llxprt-code-mcp/host/hostInterfaces.js';
import {
  fixtureApprovalPolicy,
  buildFixtureCatalogOwner,
} from './fixture-policy.js';

import { McpClientManager } from '@vybestack/llxprt-code-mcp';

import {
  type SessionMcpSettingsReads,
  type WorkspaceMcpSettings,
} from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigInitializationDependencies } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';

import { type ServerAgentStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
import type { MessageBus as MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { createTestAgentChat } from './fixture-agent-chat.js';

type TestMcpConfig = ExtensionRuntimeConfiguration &
  WorkspaceSkillConfiguration &
  Omit<
    McpHostConfig,
    | 'getWorkspaceDirectories'
    | 'onWorkspaceDirectoriesChanged'
    | 'isTrustedFolder'
  > &
  Pick<
    Config,
    | 'setExtensions'
    | 'getEnableExtensionReloading'
    | 'getPolicyEngineConfig'
    | 'initialWorkspaceTrust'
    | 'getApprovalMode'
    | 'getDebugMode'
    | 'ensureInitialized'
    | 'getLspConfig'
    | 'getTargetDir'
    | 'getConfiguredIncludeDirectories'
    | 'globalConfigRoot'
    | 'getMemorySettings'
    | 'getWorkingDir'
    | 'isJitContextEnabled'
    | 'shouldLoadMemoryFromIncludeDirectories'
    | 'getInitialSettings'
  >;

async function* fromAsyncArray<T>(items: T[]): AsyncGenerator<T, void> {
  for (const item of items) {
    yield item;
  }
}

function emptyServerAgentStream(): AsyncGenerator<
  ServerAgentStreamEvent,
  unknown
> {
  return fromAsyncArray<ServerAgentStreamEvent>([]);
}

export function createTestAgentClient(
  overrides?: Partial<AgentClientContract>,
  identity?: {
    readonly config: Config;
    readonly manager: RuntimeProviderManager;
  },
): AgentClientContract {
  const chat = createTestAgentChat();
  let selection: ToolSelection = {
    getTool: () => undefined,
    getAllToolNames: () => [],
    getAllTools: () => [],
    getEnabledTools: () => [],
    getFunctionDeclarations: () => [],
    getFunctionDeclarationsFiltered: () => [],
  };
  return {
    get tools() {
      return selection;
    },
    bindProviderInvocation: () => {},
    bindRuntimeSettings: () => {},
    bindTelemetry: () => {},
    bindToolSelection: (tools) => {
      selection = tools;
    },
    assertConfig: (config) => {
      if (identity?.config !== config)
        throw new Error('Test client Config identity mismatch');
    },
    assertProviderManager: (manager) => {
      if (identity?.manager !== manager)
        throw new Error('Test client manager identity mismatch');
    },
    initialize: async () => {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    getChat: () => chat,
    getHistory: async () => [],
    getHistoryService: () => null,
    storeHistoryServiceForReuse: () => {},
    prepareHistoryRebind: () => () => {},
    storeHistoryForLaterUse: async () => {},
    dispose: async () => {},
    setTools: async () => {},
    clearTools: () => {},
    updateSystemInstruction: async () => {},
    addHistory: async () => {},
    resetChat: async () => {},
    resumeChat: async () => {},
    setHistory: async () => {},
    restoreHistory: async () => {},
    addDirectoryContext: async () => {},
    getContentGenerator: () => undefined as never,
    getContentGeneratorConfig: () => undefined,
    startChat: async () => chat,
    generateDirectMessage: async () => emptyModelOutput(),
    generateJson: async () => ({}),
    generateContent: async () => emptyModelOutput(),
    generateEmbedding: async (texts: string[]) => texts.map(() => []),
    sendMessageStream: () => emptyServerAgentStream(),
    getCurrentSequenceModel: () => null,
    ...overrides,
  };
}

/**
 * Test-only helper that initializes Config with an explicit session MessageBus,
 * mirroring the production composition-root DI path.
 */
export interface TestSessionClient {
  getAgentClient(): AgentClientContract;
  publishTools(): Promise<void>;
}

export interface TestMcpRuntime {
  readonly trust: WorkspaceTrustControlPort;
  readonly toolSelection: ToolSelection;
  readonly toolPublication: WorkspaceToolCatalogOwner['publication'];
  readonly catalogOwner: WorkspaceMcpCatalogOwner;
  readonly workspaceLsp: WorkspaceLspOwner;
  readonly workspaceFilesystem: WorkspaceFilesystemOwner;
  readonly workspaceMemory: WorkspaceMemoryOwner;
  readonly policyOwner: TestPolicyOwner;
  readonly messageBus: MessageBusType;
  readonly workspaceSkills: WorkspaceSkillOwner;
  readonly extensionOperations: WorkspaceExtensionOperations;
  readonly sessionClient: TestSessionClient | undefined;
  readonly agentClient: AgentClientContract | undefined;
  dispose(): Promise<void>;
  refreshContext(): Promise<void>;
  reload(): Promise<void>;
  readServerSettings(): WorkspaceMcpSettings;
}

type ReadFixtureMcpPolicy = () => Pick<
  RegistryPolicy,
  'lazyMcp' | 'eagerServers'
>;

export async function initializeTestConfig(
  config: TestMcpConfig,
  managerFactory?: typeof McpClientManager,
  lspOwner?: WorkspaceLspOwner,
  readMcpPolicy?: ReadFixtureMcpPolicy,
): Promise<TestMcpRuntime> {
  return initializeTestMcpRuntime(
    config,
    managerFactory,
    undefined,
    undefined,
    undefined,
    lspOwner,
    readMcpPolicy,
  );
}

function subscribeToTestMcpTrust(
  trust: WorkspaceTrustControlPort,
  manager: McpClientManager,
  pending: Set<Promise<void>>,
): Array<() => void> {
  return [
    trust.subscribeTrustChange((transition) => {
      if (!transition.trusted) manager.quarantineForTrustRevocation();
    }),
    trust.subscribeTrustTransition((transition) => {
      const operation = transition.trusted
        ? manager.onFolderTrustGained()
        : manager.onFolderTrustRevoked();
      pending.add(operation);
      void operation
        .finally(() => pending.delete(operation))
        .catch(() => undefined);
      return operation;
    }),
  ];
}

function createFixtureContextRefresh(
  memory: WorkspaceMemoryOwner,
  sessionClient: TestSessionClient | undefined,
  tools: WorkspaceToolCatalogOwner,
): () => Promise<void> {
  const refreshContext = async (): Promise<void> => {
    await memory.operations.refresh();
    await tools.refreshActivation(refreshContext);
    if (sessionClient) {
      await sessionClient.publishTools();
      const client = sessionClient.getAgentClient();
      if (client.isInitialized()) await client.updateSystemInstruction();
    }
  };
  return refreshContext;
}

function initializeFixtureExtensions(
  extensions: WorkspaceExtensionOwner,
  manager: McpClientManager | undefined,
  skills: WorkspaceSkillOwner,
  client?: TestSessionClient,
): Promise<void> {
  return extensions.initialize(
    (extension) => requireFixtureManager(manager).startExtension(extension),
    (extension) => requireFixtureManager(manager).stopExtension(extension),
    async () => client?.publishTools(),
    () => skills.refresh(),
  );
}

export function createTestExtensionLoader(
  extensions: LlxprtExtension[],
): SimpleExtensionLoader {
  return new SimpleExtensionLoader(extensions);
}

function createFixtureLsp(
  config: TestMcpConfig,
  trust: WorkspaceTrustReadPort,
): WorkspaceLspOwner {
  return new WorkspaceLspOwner(
    config.getLspConfig(),
    config.getTargetDir(),
    () => trust.isTrustedFolder(),
  );
}

function fixtureMcpAccess(
  manager: () => McpClientManager,
): Pick<
  ConfigInitializationDependencies,
  | 'startMcpDiscovery'
  | 'startMcpExtension'
  | 'stopMcpExtension'
  | 'readMcpInstructions'
> {
  return {
    startMcpDiscovery: () => {
      void manager().startConfiguredMcpServers();
    },
    startMcpExtension: (extension) => manager().startExtension(extension),
    stopMcpExtension: (extension) => manager().stopExtension(extension),
    readMcpInstructions: () => manager().readInstructions(),
  };
}

function retainFixtureMemory(
  config: TestMcpConfig,
  filesystem: WorkspaceFilesystemOwner,
  trust: WorkspaceTrustReadPort,
): WorkspaceMemoryOwner {
  const memory = assembleWorkspaceMemory(config, filesystem, trust);
  fixtureResources = [...fixtureResources, memory];
  return memory;
}

function subscribeFixtureFilesystemTrust(
  trust: WorkspaceTrustControlPort,
  filesystem: WorkspaceFilesystemOwner,
): Array<() => void> {
  return [trust.subscribeTrustChange(() => filesystem.notifyTrustChanged())];
}

function fixtureInitializationResources(
  config: TestMcpConfig,
  messageBus: MessageBusType,
  policy: TestPolicyOwner,
  factory: typeof McpClientManager | undefined,
  readMcpPolicy?: ReadFixtureMcpPolicy,
  settings?: SessionMcpSettingsReads,
): {
  filesystem: WorkspaceFilesystemOwner;
  unsubscribe: Array<() => void>;
  dependencies: ReturnType<typeof testConfigInitialization>;
} {
  const filesystem = createTestFilesystem(config, policy.trust);
  return {
    filesystem,
    unsubscribe: subscribeFixtureFilesystemTrust(policy.trust, filesystem),
    dependencies: testConfigInitialization(
      config,
      messageBus,
      policy,
      filesystem,
      factory,
      readMcpPolicy,
      settings,
    ),
  };
}

function createFixtureInstructionWorkspace(
  config: TestMcpConfig,
  filesystem: WorkspaceFilesystemOwner,
  sessionClient: TestSessionClient | undefined,
  extensionLoader: ExtensionLoader | undefined,
  toolCatalog: WorkspaceToolCatalogOwner,
  trust: WorkspaceTrustReadPort,
  messageBus: MessageBusType,
  skillOperations: WorkspaceSkillAssemblyOperations,
): {
  memory: WorkspaceMemoryOwner;
  workspaceSkills: WorkspaceSkillOwner;
  extensions: WorkspaceExtensionOwner;
} {
  const memory = retainFixtureMemory(config, filesystem, trust);
  return {
    memory,
    ...assembleFixtureWorkspace(
      config,
      filesystem,
      sessionClient,
      extensionLoader,
      toolCatalog,
      memory,
      trust,
      () => messageBus,
      skillOperations,
    ),
  };
}

async function initializeFixtureInstructions({
  memory,
  workspaceSkills,
}: Pick<
  ReturnType<typeof createFixtureInstructionWorkspace>,
  'memory' | 'workspaceSkills'
>): Promise<void> {
  await memory.operations.refresh();
  await workspaceSkills.initialize();
}

export async function initializeTestMcpRuntime(
  config: TestMcpConfig,
  managerFactory?: typeof McpClientManager,
  sessionClient?: TestSessionClient,
  extensionLoader?: ExtensionLoader,
  policyOwner: TestPolicyOwner = new RuntimePolicyOwner(config),
  lspOwner?: WorkspaceLspOwner,
  readMcpPolicy?: ReadFixtureMcpPolicy,
  skillOperations: WorkspaceSkillAssemblyOperations = TEST_SKILL_OPERATIONS,
  settings?: SessionMcpSettingsReads,
): Promise<TestMcpRuntime> {
  let manager: McpClientManager | undefined;
  const trustOperations = new Set<Promise<void>>();
  const { filesystem, unsubscribe, dependencies } =
    fixtureInitializationResources(
      config,
      policyOwner.session.messageBus,
      policyOwner,
      managerFactory,
      readMcpPolicy,
      settings,
    );
  const { memory, workspaceSkills, extensions } =
    createFixtureInstructionWorkspace(
      config,
      filesystem,
      sessionClient,
      extensionLoader,
      dependencies.toolCatalog,
      policyOwner.trust,
      policyOwner.session.messageBus,
      skillOperations,
    );
  const workspaceLsp = lspOwner ?? createFixtureLsp(config, policyOwner.trust);
  try {
    await initializeFixtureConfig(
      config,
      dependencies,
      workspaceLsp,
      extensions,
      () => manager,
      workspaceSkills,
      sessionClient,
      beginFixtureMcp(dependencies, trustOperations, unsubscribe, (started) => {
        manager = started;
      }),
    );
    await initializeFixtureInstructions({ memory, workspaceSkills });
  } catch (error) {
    return releaseFailedFixture(error, policyOwner, unsubscribe, () =>
      closeFixtureWorkspace(
        extensions,
        manager,
        workspaceSkills,
        trustOperations,
        workspaceLsp,
        filesystem,
        dependencies.catalogOwner,
        memory,
      ),
    );
  }
  return assembledFixture(
    config,
    policyOwner,
    workspaceSkills,
    extensions,
    manager,
    trustOperations,
    unsubscribe,
    sessionClient,
    workspaceLsp,
    filesystem,
    dependencies.catalogOwner,
    dependencies.toolCatalog,
    memory,
    dependencies.reload,
    dependencies.readServerSettings,
  );
}

function beginFixtureMcp(
  dependencies: ReturnType<typeof testConfigInitialization>,
  trustOperations: Set<Promise<void>>,
  unsubscribe: Array<() => void>,
  publish: (manager: McpClientManager | undefined) => void,
): NonNullable<ConfigInitializationDependencies['startMcp']> {
  return async () => {
    publish(await startFixtureMcp(dependencies, trustOperations, unsubscribe));
  };
}

async function startFixtureMcp(
  dependencies: ReturnType<typeof testConfigInitialization>,
  trustOperations: Set<Promise<void>>,
  unsubscribe: Array<() => void>,
): Promise<McpClientManager | undefined> {
  await dependencies.startMcp?.();
  const manager = dependencies.readManager();
  unsubscribe.push(
    ...subscribeToTestMcpTrust(dependencies.trust, manager, trustOperations),
  );
  return manager;
}

async function releaseFailedFixture(
  error: unknown,
  policy: TestPolicyOwner,
  unsubscribe: ReadonlyArray<() => void>,
  cleanup: () => Promise<void>,
): Promise<never> {
  await policy.dispose();
  for (const stop of unsubscribe) stop();
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'Fixture initialization cleanup failed',
    );
  }
  throw error;
}

function assembledFixture(
  config: TestMcpConfig,
  policyOwner: TestPolicyOwner,
  workspaceSkills: WorkspaceSkillOwner,
  extensions: WorkspaceExtensionOwner,
  manager: McpClientManager | undefined,
  trustOperations: ReadonlySet<Promise<void>>,
  unsubscribe: ReadonlyArray<() => void>,
  sessionClient: TestSessionClient | undefined,
  workspaceLsp: WorkspaceLspOwner,
  workspaceFilesystem: WorkspaceFilesystemOwner,
  catalogOwner: WorkspaceMcpCatalogOwner,
  toolCatalog: WorkspaceToolCatalogOwner,
  workspaceMemory: WorkspaceMemoryOwner,
  reload: () => Promise<void>,
  readServerSettings: () => WorkspaceMcpSettings,
): TestMcpRuntime {
  const sessionMessageBus = policyOwner.session.messageBus;
  const refreshContext = createFixtureContextRefresh(
    workspaceMemory,
    sessionClient,
    toolCatalog,
  );
  let disposal: Promise<void> | undefined;
  return retainFixtureRuntime({
    catalogOwner,
    trust: policyOwner.trust,
    toolSelection: toolCatalog.selection,
    toolPublication: toolCatalog.publication,
    workspaceLsp,
    workspaceFilesystem,
    workspaceMemory,
    policyOwner,
    messageBus: sessionMessageBus,
    workspaceSkills,
    extensionOperations: extensions.operations,
    sessionClient,
    get agentClient() {
      return sessionClient?.getAgentClient();
    },
    dispose: () => {
      if (disposal) return disposal;
      catalogOwner.closeAdmission();
      const policyClosing = Promise.resolve().then(() => policyOwner.dispose());
      for (const stopListening of unsubscribe) stopListening();
      workspaceMemory.closeAdmission();
      const workspaceClosing = closeFixtureWorkspace(
        extensions,
        manager,
        workspaceSkills,
        trustOperations,
        workspaceLsp,
        workspaceFilesystem,
        catalogOwner,
        workspaceMemory,
      );
      disposal = Promise.allSettled([policyClosing, workspaceClosing]).then(
        (results) => {
          const failures = results.flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : [],
          );
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1)
            throw new AggregateError(
              failures,
              'Fixture workspace cleanup failed',
            );
        },
      );
      return disposal;
    },
    refreshContext,
    reload,
    readServerSettings,
  });
}

type TestConfigInitializationInput = Pick<
  Config,
  | 'getPolicyEngineConfig'
  | 'initialWorkspaceTrust'
  | 'getApprovalMode'
  | 'getDebugMode'
  | 'getMcpServers'
  | 'getTargetDir'
  | 'getConfiguredIncludeDirectories'
  | 'getInitialSettings'
> &
  Omit<
    McpHostConfig,
    | 'getWorkspaceDirectories'
    | 'onWorkspaceDirectoriesChanged'
    | 'isTrustedFolder'
  >;

export function testConfigInitialization(
  config: TestConfigInitializationInput,
  messageBus: MessageBusType | undefined,
  policyOwner: Pick<TestPolicyOwner, 'session' | 'trust'>,
  filesystem: Pick<
    WorkspaceFilesystemOwner,
    'paths' | 'files' | 'ignore' | 'scans' | 'subscribeDirectories'
  >,
  managerFactory: typeof McpClientManager = McpClientManager,
  readMcpPolicy?: ReadFixtureMcpPolicy,
  settings?: SessionMcpSettingsReads,
): ConfigInitializationDependencies & {
  readonly trust: WorkspaceTrustControlPort;
  readManager(): McpClientManager;
  reload(): Promise<void>;
  readServerSettings(): WorkspaceMcpSettings;
  catalogOwner: WorkspaceMcpCatalogOwner;
  toolCatalog: WorkspaceToolCatalogOwner;
  mcpApprovalPolicy: NonNullable<
    ConfigInitializationDependencies['mcpApprovalPolicy']
  >;
} {
  if (messageBus !== undefined && messageBus !== policyOwner.session.messageBus)
    throw new Error('Fixture policy owner MessageBus identity mismatch');
  let manager: McpClientManager;
  const readManager = () => requireFixtureManager(manager);
  const revision = fixtureMcpRevision(config, settings, readManager);
  const toolCatalog = new WorkspaceToolCatalogOwner(
    config,
    policyOwner.session.messageBus,
    policyOwner.trust,
    readMcpPolicy,
  );
  fixtureResources = [...fixtureResources, toolCatalog];
  const catalogOwner = createFixtureCatalogOwner(policyOwner.trust, () =>
    requireFixtureManager(manager),
  );
  const mcpApprovalPolicy = fixtureApprovalPolicy(policyOwner);
  return {
    trust: policyOwner.trust,
    readManager,
    readServerSettings: revision.readServerSettings,
    reload: revision.reload,
    catalogOwner,
    toolCatalog,
    initializeTools: () => toolCatalog.initialize(),
    workspacePaths: filesystem.paths,
    workspaceFiles: filesystem.files,
    workspaceIgnore: filesystem.ignore,
    workspaceScans: filesystem.scans,
    mcpApprovalPolicy,
    startMcpDiscovery: () => {
      void readManager().startConfiguredMcpServers();
    },
    startMcpExtension: (extension) => readManager().startExtension(extension),
    stopMcpExtension: (extension) => readManager().stopExtension(extension),
    readMcpInstructions: () => readManager().readInstructions(),
    messageBus,
    startMcp: async () => {
      manager = connectFixtureManager(
        managerFactory,
        mcpApprovalPolicy,
        toolCatalog,
        catalogOwner,
        fixtureMcpHost(
          fixtureMcpHostSettings(config, revision.readServerSettings),
          filesystem,
          policyOwner.trust,
        ),
      );
    },
  };
}

export { makeFakeConfig } from './fixture-fake-config.js';

function requireFixtureManager(
  manager: McpClientManager | undefined,
): McpClientManager {
  if (!manager) throw new Error('Fixture MCP manager is not initialized');
  return manager;
}

export interface TestPolicyOwner {
  readonly trust: WorkspaceTrustControlPort;
  readonly session: Pick<
    RuntimePolicyOwner['session'],
    'decisions' | 'confirmation' | 'inspection' | 'messageBus'
  >;
  dispose(): void | Promise<void>;
}

let fixtureResources: ReadonlyArray<{ dispose(): Promise<void> }> = [];
afterEach(async () => {
  const closing = fixtureResources;
  fixtureResources = [];
  const failures: unknown[] = [];
  for (const resource of [...closing].reverse()) {
    try {
      await resource.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Fixture resource disposal failed');
});

export function createTestFilesystem(
  config: Pick<
    Config,
    'getTargetDir' | 'getConfiguredIncludeDirectories' | 'initialWorkspaceTrust'
  >,
  trust: WorkspaceTrustReadPort = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  }),
): WorkspaceFilesystemOwner {
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: config.getTargetDir(),
    includeDirectories: config.getConfiguredIncludeDirectories(),
    isTrusted: () => trust.isTrustedFolder(),
  });
  fixtureResources = [...fixtureResources, filesystem];
  return filesystem;
}

function retainFixtureRuntime(runtime: TestMcpRuntime): TestMcpRuntime {
  const retained: TestMcpRuntime = {
    ...runtime,
    dispose: () => {
      fixtureResources = fixtureResources.filter(
        (resource) => resource !== retained,
      );
      return runtime.dispose();
    },
  };
  fixtureResources = [...fixtureResources, retained];
  return retained;
}

function fixturePublicationDependencies(
  lsp: WorkspaceLspOwner,
  approval: ConfigInitializationDependencies['mcpApprovalPolicy'],
  extensions: WorkspaceExtensionOwner,
  manager: () => McpClientManager | undefined,
  skills: WorkspaceSkillOwner,
  client: TestSessionClient | undefined,
  tools: McpToolPublication,
): Pick<
  ConfigInitializationDependencies,
  'startLsp' | 'startExtensions' | 'publishTools'
> {
  return {
    startLsp: () => lsp.initialize(tools, approval),
    startExtensions: () =>
      initializeFixtureExtensions(extensions, manager(), skills, client),
    publishTools: client ? () => client.publishTools() : undefined,
  };
}

function initializeFixtureConfig(
  config: TestMcpConfig,
  dependencies: ConfigInitializationDependencies & {
    toolCatalog: WorkspaceToolCatalogOwner;
  },
  lsp: WorkspaceLspOwner,
  extensions: WorkspaceExtensionOwner,
  manager: () => McpClientManager | undefined,
  skills: WorkspaceSkillOwner,
  client: TestSessionClient | undefined,
  startMcp: ConfigInitializationDependencies['startMcp'],
): Promise<void> {
  return config.ensureInitialized({
    ...dependencies,
    lspDiagnostics: lsp.diagnostics,
    ...fixturePublicationDependencies(
      lsp,
      dependencies.mcpApprovalPolicy,
      extensions,
      manager,
      skills,
      client,
      dependencies.toolCatalog.publication,
    ),
    startMcp,
    ...fixtureMcpAccess(() => requireFixtureManager(manager())),
  });
}

export function installTestCatalogOwners(): () => WorkspaceMcpCatalogOwner {
  let roots: readonly WorkspaceMcpCatalogOwner[] = [];
  afterEach(async () => {
    const retained = roots;
    roots = [];
    for (const root of retained) await root.dispose();
  });
  return (): WorkspaceMcpCatalogOwner => {
    const root = new WorkspaceMcpCatalogOwner(
      () => true,
      async () => {
        throw new Error('Manager fixture has no resource transport');
      },
    );
    roots = [...roots, root];
    return root;
  };
}

function createFixtureCatalogOwner(
  config: WorkspaceTrustReadPort,
  manager: () => McpClientManager,
): WorkspaceMcpCatalogOwner {
  const catalogOwner = buildFixtureCatalogOwner(config, manager);
  fixtureResources = [...fixtureResources, catalogOwner];
  return catalogOwner;
}
