/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createHookReloadBinding,
  retainSessionBinding,
  trackSessionPublication,
  publishSessionTools,
  clearSessionTools,
  reloadSessionHooks,
  type SessionClientHookBinding,
} from './session-hook-binding.js';
import type { WorkspaceAuthorityComposition } from './workspace-authority-composition.js';
import {
  type WorkspaceTrustControlPort,
  type WorkspaceIdePort,
} from '@vybestack/llxprt-code-core';
import { ownsMcpMemory, type MemoryHandoff } from './mcpOAuthAssembly.js';
import {
  retainWorkspaceTools,
  retainWorkspaceEnvironment,
  retainMcpCatalogs,
  composeWorkspaceExtensions,
  projectWorkspaceMcpSettings,
  readWorkspaceMcpStatus,
  captureWorkspaceServerDeclarations,
  reloadWorkspaceMcpServers,
} from './mcp-workspace-publications.js';
import { composeMcpLsp } from './mcp-runtime-lsp.js';
import {
  type WorkspaceCheckpointOwner,
  type WorkspaceToolCatalogOwner,
  type WorkspaceMcpCatalogOwner,
  DebugLogger,
  getErrorMessage,
  initializeParser,
  type WorkspaceCheckpointOperations,
  type WorkspaceDefinitionOwner,
  type ProfileDefinitionReads,
  type ProfileDefinitionWrites,
  type SubagentDefinitionReads,
  type SubagentDefinitionWrites,
  type DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';

import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import {
  composeDefinitionRoots,
  initializeWorkspaceDefinitions,
  assertDefinitionBootstrapConfig,
  projectTrustedSubagents,
  updateWorkspaceExtensionDefinitions,
  refreshWorkspaceDefinitionMemory,
} from './workspace-definition-assembly.js';

import type { ToolSelection } from '@vybestack/llxprt-code-tools';

import {
  McpClientManager,
  type DiscoveredMCPPrompt,
  type McpOAuthBinding,
  type TokenStorage,
  type McpClient,
  type McpApprovalPolicy,
} from '@vybestack/llxprt-code-mcp';
import {
  McpConstructionResources,
  settleMcpClosures,
  joinMcpRetirementOperations,
} from './mcp-construction-resources.js';
import {
  assembleRuntimeOAuth,
  assembleMcpOAuthOperation,
} from './mcp-runtime-oauth.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import {
  type WorkspaceLspOwner,
  type WorkspaceLspInspection,
} from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  type WorkspaceExtensionOwner,
  type WorkspaceExtensionOperations,
} from '@vybestack/llxprt-code-core/utils/workspace-extension-owner.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';

import {
  assembleWorkspaceSkillsAndExtensions,
  DEFAULT_SKILL_OPERATIONS,
} from './workspace-skill-assembly.js';
import type { WorkspaceSkillOwner } from '@vybestack/llxprt-code-core/skills/workspace-skill-owner.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  requireMcpResourceClient,
  type McpRuntimeStatusView,
} from './control/mcpControl.js';

import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { getCoreVersion } from '@vybestack/llxprt-code-core/utils/version.js';

import type { HostFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';

import { MCP_SESSION_APPROVAL_SOURCE } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';

import {
  assembleWorkspaceApproval,
  retainWorkspaceAuthority,
  selectMcpConstructionInputs,
  retainMcpPolicyProjection,
  retainWorkspaceCheckpoints,
  type AgentMcpOperations,
  type McpRuntimeConstructionInputs,
} from './mcp-runtime-construction.js';
export type {
  AgentMcpOperations,
  McpRuntimeConstructionInputs,
} from './mcp-runtime-construction.js';

import {
  type WorkspaceMcpSettings,
  type SessionMcpSettingsReads,
} from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';

export class McpRuntimeOwner implements AgentMcpOperations {
  readonly trust: WorkspaceTrustControlPort;
  readonly ide: WorkspaceIdePort;
  private readonly authority: WorkspaceAuthorityComposition;
  private ideClosing: Promise<void> | undefined;
  private discoveryClosing: Promise<void> | undefined;
  private managerClosing: Promise<void> | undefined;
  private releasePolicyProjection: (() => void) | undefined;
  private policyClosing: Promise<void> | undefined;
  readonly workspaceDefinitions: WorkspaceDefinitionOwner;
  private readonly definitionContributions: WorkspaceDefinitionOwner;
  private readonly ownsDefinitions: boolean;
  readonly workspaceCheckpoints: WorkspaceCheckpointOwner;
  get profileDefinitions(): ProfileDefinitionReads {
    return this.workspaceDefinitions.profileReads;
  }
  get profileWrites(): ProfileDefinitionWrites {
    return this.workspaceDefinitions.profileWrites;
  }
  get subagentDefinitions(): SubagentDefinitionReads {
    return projectTrustedSubagents(this.definitionContributions, () =>
      this.trust.isTrustedFolder(),
    );
  }
  get subagentWrites(): SubagentDefinitionWrites {
    return this.definitionContributions.subagentWrites;
  }
  get checkpointOperations(): WorkspaceCheckpointOperations {
    return this.workspaceCheckpoints.operations;
  }
  readonly workspaceMemory: WorkspaceMemoryOwner;
  private readonly ownsMemory = (): boolean => ownsMcpMemory(this.memoryOwner);
  readonly workspaceFilesystem: WorkspaceFilesystemOwner;
  private readonly ownsFilesystem: boolean;
  readonly workspaceLsp: WorkspaceLspOwner;
  get workspacePaths(): WorkspaceFilesystemOwner['paths'] {
    return this.workspaceFilesystem.paths;
  }
  get workspaceFiles(): WorkspaceFilesystemOwner['files'] {
    return this.workspaceFilesystem.files;
  }
  get workspaceIgnore(): WorkspaceFilesystemOwner['ignore'] {
    return this.workspaceFilesystem.ignore;
  }
  get workspaceScans(): WorkspaceFilesystemOwner['scans'] {
    return this.workspaceFilesystem.scans;
  }
  get workspaceSearch(): WorkspaceFilesystemOwner['search'] {
    return this.workspaceFilesystem.search;
  }
  readonly addWorkspaceDirectory = (directory: string): void =>
    this.workspaceFilesystem.addDirectory(directory);
  get lspInspection(): WorkspaceLspInspection {
    return this.workspaceLsp.inspection;
  }
  private readonly ownsLsp: boolean;
  readonly policyOwner: RuntimePolicyOwner;
  private readonly ownsPolicy: boolean;
  get policyInspection(): RuntimePolicyOwner['session']['inspection'] {
    return this.policyOwner.session.inspection;
  }
  readonly workspaceSkills: WorkspaceSkillOwner;
  private readonly workspaceExtensions: WorkspaceExtensionOwner;
  get extensionOperations(): WorkspaceExtensionOperations {
    return this.workspaceExtensions.operations;
  }
  private readonly catalogs: WorkspaceMcpCatalogOwner;
  private readonly tools: WorkspaceToolCatalogOwner;
  get toolSelection(): ToolSelection {
    return this.tools.selection;
  }
  private serverSettings: WorkspaceMcpSettings;
  private extensions: LlxprtExtension[];
  private allowedServers: string[] | undefined;
  private readonly serverCommand: ReturnType<Config['getMcpServerCommand']>;
  private readonly debugMode: boolean;
  private readonly reloadOperations = new Set<Promise<void>>();
  readonly readServerSettings = (): WorkspaceMcpSettings => {
    if (this.stopped) throw new Error('MCP runtime is stopped');
    return projectWorkspaceMcpSettings(this.serverSettings, this.extensions);
  };
  private manager: McpClientManager | undefined;
  private releaseMcpPublication: (() => void) | undefined;
  private initialization: Promise<void> | undefined;
  private discovery: Promise<void> | undefined;
  private skillsClosing: Promise<void> | undefined;
  private lspClosing: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;
  private closingOperations:
    | Promise<Array<PromiseSettledResult<void>>>
    | undefined;
  private stopped = false;
  private toolsAdmissionClosing:
    | Promise<Array<PromiseSettledResult<void>>>
    | undefined;
  private subscriptions: Array<() => void> = [];
  private readonly trustOperations = new Set<Promise<void>>();

  private readonly approvalWrites = new Set<Promise<void>>();
  private readonly approvalPolicy: McpApprovalPolicy;
  readonly messageBus: MessageBus;
  private readonly feedback?: HostFeedbackSink;
  private readonly oauth: McpOAuthBinding;
  readonly performOAuth = assembleMcpOAuthOperation(
    () => this.oauth,
    () => {
      if (this.stopped) throw new Error('MCP runtime is stopped');
    },
  );
  readonly readOAuthCredentials: TokenStorage['getCredentials'];

  static async create(
    ...inputs: McpRuntimeConstructionInputs
  ): Promise<McpRuntimeOwner> {
    const resources = new McpConstructionResources();
    try {
      return new McpRuntimeOwner(
        resources,
        selectMcpConstructionInputs(inputs),
      );
    } catch (error) {
      return resources.reject(error);
    }
  }

  private readonly config: Config;
  private readonly managerFactory: typeof McpClientManager;
  private readonly memoryOwner: MemoryHandoff | undefined;
  private readonly mcpSettings: SessionMcpSettingsReads | undefined;

  private constructor(
    resources: McpConstructionResources,
    inputs: ReturnType<typeof selectMcpConstructionInputs>,
  ) {
    this.config = inputs.config;
    this.managerFactory = inputs.managerFactory ?? McpClientManager;
    this.memoryOwner = inputs.memoryOwner;
    this.mcpSettings = inputs.mcpSettings;
    this.serverCommand = inputs.config.getMcpServerCommand();
    this.debugMode = inputs.config.getDebugMode();
    [this.serverSettings, this.extensions, this.allowedServers] =
      captureWorkspaceServerDeclarations(
        inputs.config,
        inputs.extensionLoader,
        inputs.mcpSettings,
      );
    this.authority = retainWorkspaceAuthority(
      resources,
      inputs.config,
      inputs.trustPort ?? inputs.policyOwner?.trust,
      inputs.idePort,
      inputs.trustCleanup,
    );
    this.trust = this.authority.trust;
    this.ide = this.authority.ide;
    this.workspaceCheckpoints = retainWorkspaceCheckpoints(
      resources,
      inputs.config,
    );
    [
      this.workspaceFilesystem,
      this.workspaceMemory,
      this.policyOwner,
      this.ownsPolicy,
    ] = this.composeEnvironment(resources, inputs);
    this.ownsFilesystem = inputs.filesystemOwnership === 'runtime';
    this.releasePolicyProjection = retainMcpPolicyProjection(
      resources,
      this.policyOwner,
      () => this.serverSettings.settingsMcpServers,
    );
    this.ownsDefinitions = inputs.definitionOwnership === 'runtime';
    [this.workspaceDefinitions, this.definitionContributions] =
      composeDefinitionRoots(
        resources,
        inputs.config,
        inputs.definitionOwner,
        inputs.definitionOwnership,
      );
    this.workspaceLsp = this.composeLsp(
      resources,
      inputs.lspOwner,
      inputs.lspOwnership,
    );
    this.ownsLsp = inputs.lspOwnership === 'runtime';
    this.tools = this.composeTools(resources);
    [this.workspaceSkills, this.workspaceExtensions] =
      this.composeSkillsAndExtensions(
        resources,
        inputs.skillOperations ?? DEFAULT_SKILL_OPERATIONS,
        inputs.extensionLoader,
      );
    ({ binding: this.oauth, readCredentials: this.readOAuthCredentials } =
      assembleRuntimeOAuth(inputs.oauth));
    this.approvalPolicy = assembleWorkspaceApproval(
      this.policyOwner,
      this.approvalWrites,
      () => {
        if (this.stopped) throw new Error('MCP runtime is stopped');
      },
    );
    this.catalogs = this.composeCatalogs(resources);
    this.feedback = inputs.host?.emitFeedback;
    this.messageBus = this.policyOwner.session.messageBus;
    assertDefinitionBootstrapConfig(inputs.config.hasInitializationStarted());
  }

  private composeEnvironment(
    resources: McpConstructionResources,
    inputs: ReturnType<typeof selectMcpConstructionInputs>,
  ): ReturnType<typeof retainWorkspaceEnvironment> {
    const environment = retainWorkspaceEnvironment(
      resources,
      inputs.config,
      this.trust,
      inputs.filesystemOwner,
      inputs.filesystemOwnership,
      inputs.memoryOwner,
      () => this.extensions.slice(),
      inputs.messageBus,
      inputs.policyOwner,
      inputs.policyOwnership,
    );
    this.subscriptions.push(environment[4]);
    return environment;
  }

  private composeSkillsAndExtensions(
    resources: McpConstructionResources,
    operations: typeof DEFAULT_SKILL_OPERATIONS,
    loader: ExtensionLoader | undefined,
  ): [WorkspaceSkillOwner, WorkspaceExtensionOwner] {
    return assembleWorkspaceSkillsAndExtensions(
      resources,
      this.config,
      this.workspaceFilesystem,
      this.tools,
      this.trust,
      () => this.policyOwner.session.messageBus,
      () => this.sessionBindings,
      operations,
      () =>
        composeWorkspaceExtensions(
          {
            getExtensions: () => this.extensions.slice(),
            setExtensions: (extensions) => {
              this.extensions = extensions.slice();
            },
            getEnableExtensionReloading: () =>
              this.config.getEnableExtensionReloading(),
          },
          loader,
          () => this.refreshWorkspaceMemory(),
          this.definitionContributions,
          this.workspaceMemory,
          () => reloadSessionHooks(this.sessionBindings),
        ),
      () => this.extensions,
    );
  }

  private composeLsp(
    resources: McpConstructionResources,
    owner: WorkspaceLspOwner | undefined,
    ownership: 'runtime' | 'caller',
  ): WorkspaceLspOwner {
    return composeMcpLsp(resources, this.config, owner, ownership, this.trust);
  }
  private composeTools(
    resources: McpConstructionResources,
  ): WorkspaceToolCatalogOwner {
    return retainWorkspaceTools(
      resources,
      this.config,
      this.policyOwner.session.messageBus,
      this.trust,
    );
  }
  private composeCatalogs(
    resources: McpConstructionResources,
  ): WorkspaceMcpCatalogOwner {
    return retainMcpCatalogs(resources, this.trust, (server, uri, signal) =>
      this.requireResourceClient(server).readResource(uri, signal),
    );
  }
  private requireResourceClient(server: string): McpClient {
    return requireMcpResourceClient(this.requireManager(), server);
  }

  private refreshWorkspaceMemory(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return refreshWorkspaceDefinitionMemory(
      this.definitionContributions,
      this.extensions.slice(),
      () => this.workspaceMemory.operations.refresh(),
    );
  }

  private sessionBindings: readonly SessionClientHookBinding[] = [];

  readonly bindSessionClient = (
    config: Config,
    token: symbol,
    readClient: () => AgentClientContract,
    publishTools: () => Promise<void>,
    publishInstructions: () => Promise<void>,
    bindInstructions: (
      read: () => string | undefined,
      release: () => void,
    ) => void,
    acceptSkillPublication?: SessionClientHookBinding['acceptSkillPublication'],
  ): void => {
    if (config !== this.config)
      throw new Error('MCP session client belongs to a different Config');
    readClient().assertConfig(config);
    this.sessionBindings = retainSessionBinding(
      this.sessionBindings,
      token,
      readClient,
      publishTools,
      publishInstructions,
      bindInstructions,
      () => this.readEnvironmentInstructions(),
      () => {
        this.sessionBindings = this.sessionBindings.filter(
          (binding) => binding.token !== token,
        );
      },
      acceptSkillPublication,
    );
  };

  readonly bindSessionHookReload = createHookReloadBinding(
    () => this.sessionBindings,
    (bindings) => {
      this.sessionBindings = bindings;
    },
  );

  assertConfig(config: Config, messageBus: MessageBus): void {
    if (config !== this.config || messageBus !== this.messageBus) {
      throw new Error(
        'MCP runtime handoff must retain its Config and MessageBus',
      );
    }
  }

  initialize(): Promise<void> {
    if (this.stopped)
      throw new Error('Cannot initialize a stopped MCP runtime');
    if (this.initialization !== undefined) return this.initialization;
    this.initialization = this.initializeWorkspace();
    return this.initialization;
  }

  private async initializeWorkspace(): Promise<void> {
    await this.authority.initialize();
    await initializeParser();
    await this.workspaceCheckpoints.initialize();
    await this.tools.initialize();
    if (this.isStopped())
      throw new Error('Workspace initialization closed before MCP acquisition');
    await this.startManager();
    this.discovery = this.requireManager()
      .startConfiguredMcpServers()
      .catch((error: unknown) => {
        new DebugLogger('llxprt:mcp:runtime').warn(
          `MCP discovery rejected: ${getErrorMessage(error)}`,
        );
      });
    await this.initializeExtensions();
    await this.workspaceLsp.initialize(
      this.tools.publication,
      this.approvalPolicy,
    );
    await initializeWorkspaceDefinitions(
      this.definitionContributions,
      this.config.getInitialSettings(),
      () => this.refreshWorkspaceMemory(),
    );
    if (this.isStopped())
      throw new Error(
        'Workspace initialization closed before skills publication',
      );
    await this.workspaceSkills.initialize();
  }

  private async startManager(): Promise<void> {
    const version = await getCoreVersion();
    if (this.isStopped())
      throw new Error('Cannot connect a stopped MCP runtime');
    const publication = this.tools.acceptMcpPublication();
    this.releaseMcpPublication = publication.release;
    this.manager = new this.managerFactory(
      this.oauth,
      this.approvalPolicy,
      version,
      publication.publication,
      this.catalogs.promptPublication,
      this.catalogs.resourcePublication,
      {
        getAllowedMcpServers: () => this.allowedServers,
        getBlockedMcpServers: () => this.serverSettings.blockedMcpServers,
        getMcpServers: () => this.serverSettings.mcpServers,
        getMcpServerCommand: () => this.serverCommand,
        getDebugMode: () => this.debugMode,
        getExtensions: () => this.extensions.slice(),
        isTrustedFolder: () => this.trust.isTrustedFolder(),
        getWorkspaceDirectories: () => this.workspacePaths.directories(),
        onWorkspaceDirectoriesChanged: (listener) =>
          this.workspaceFilesystem.subscribeDirectories(listener),
      },
      () => this.refreshContext(),
      undefined,
      undefined,
      this.feedback,
    );
    this.subscribeToTrust(this.manager);
  }

  private subscribeToTrust(manager: McpClientManager): void {
    this.subscriptions = [
      ...this.subscriptions,
      this.trust.subscribeTrustChange((transition) => {
        if (!transition.trusted) manager.quarantineForTrustRevocation();
      }),
      this.trust.subscribeTrustTransition((transition) => {
        const operation = transition.trusted
          ? manager.onFolderTrustGained()
          : manager.onFolderTrustRevoked();
        this.trustOperations.add(operation);
        void operation
          .finally(() => this.trustOperations.delete(operation))
          .catch(() => undefined);
        return operation;
      }),
    ];
  }

  private readEnvironmentInstructions(): string {
    if (!this.manager) throw new Error('MCP runtime is not initialized');
    return this.manager.readInstructions();
  }

  readonly readInstructions = (): string =>
    this.requireManager().readInstructions();

  listPrompts(server: string): DiscoveredMCPPrompt[] {
    this.requireManager();
    return this.catalogs.promptSelection.listPrompts(server);
  }

  listResources(): DiscoveredMCPResource[] {
    this.requireManager();
    return this.catalogs.resourceSelection.listResources();
  }

  findResource(identifier: string): DiscoveredMCPResource | undefined {
    this.requireManager();
    if (!this.trust.isTrustedFolder()) return undefined;
    return this.catalogs.resourceSelection.findResource(identifier);
  }

  async readResource(server: string, uri: string): Promise<unknown> {
    this.requireResourceClient(server);
    return this.catalogs.resourceSelection.readResource(server, uri);
  }

  subscribeStatus(listener: () => void): () => void {
    return this.requireManager().subscribeStatus(listener);
  }

  readonly status = (): McpRuntimeStatusView | undefined =>
    readWorkspaceMcpStatus(this.manager, this.serverSettings, this.extensions);

  async refresh(server?: string): Promise<void> {
    const manager = this.requireManager();
    if (server === undefined) await manager.restart();
    else await manager.restartServer(server);
  }

  async awaitDiscovery(): Promise<ReadonlyMap<string, string>> {
    const manager = this.requireManager();
    await manager.whenDiscoverySettled();
    return manager.getDiscoveryFailures();
  }

  private readonly contextOperations = new Set<Promise<void>>();

  refreshContext(): Promise<void> {
    if (this.isStopped()) return Promise.resolve();
    return this.trackPublication(this.refreshAcceptedContext());
  }

  private trackPublication(publishing: Promise<void>): Promise<void> {
    return trackSessionPublication(this.contextOperations, publishing);
  }

  private async refreshAcceptedContext(): Promise<void> {
    if (this.isStopped()) return;
    await this.workspaceMemory.operations.refresh();
    if (this.isStopped()) return;
    await this.tools.refreshActivation(() => this.refreshContext());
    for (const binding of this.sessionBindings) {
      if (this.isStopped()) return;
      if (!this.sessionBindings.includes(binding)) continue;
      const client = binding.readClient();
      if (client.isInitialized()) {
        await binding.publishTools();
        if (!this.isStopped() && this.sessionBindings.includes(binding))
          await binding.publishInstructions();
      }
    }
  }

  async reload(): Promise<void> {
    const manager = this.requireManager();
    if (this.mcpSettings === undefined)
      return Promise.reject(
        new Error('MCP server reload is not available in this composition.'),
      );
    const binding = this.mcpSettings;
    const operation = updateWorkspaceExtensionDefinitions(
      this.definitionContributions,
      () => this.reloadAcceptedServers(manager, binding),
      () => this.extensions.slice(),
      this.workspaceMemory,
    );
    this.reloadOperations.add(operation);
    void operation
      .finally(() => this.reloadOperations.delete(operation))
      .catch(() => undefined);
    return operation;
  }

  private reloadAcceptedServers(
    manager: McpClientManager,
    binding: SessionMcpSettingsReads,
  ): Promise<void> {
    return reloadWorkspaceMcpServers(
      binding,
      this.serverSettings,
      (settings) => {
        this.serverSettings = settings;
        this.policyOwner.workspace.refreshTrust();
      },
      () => manager.reconcileConfiguredMcpServers(),
      () => {
        this.requireManager();
      },
    );
  }

  private publishSessionTools(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.trackPublication(this.publishAcceptedSessionTools());
  }

  private publishAcceptedSessionTools(): Promise<void> {
    return publishSessionTools(
      () => this.sessionBindings,
      () => this.isStopped(),
    );
  }

  private initializeExtensions(): Promise<void> {
    return this.workspaceExtensions.initialize(
      (extension) => this.extensionManager().startExtension(extension),
      (extension) => this.extensionManager().stopExtension(extension),
      async () => this.publishSessionTools(),
      () => (this.stopped ? Promise.resolve() : this.workspaceSkills.refresh()),
    );
  }

  private extensionManager(): McpClientManager {
    if (!this.manager) throw new Error('MCP runtime is not initialized');
    return this.manager;
  }

  private requireManager(): McpClientManager {
    if (this.stopped) throw new Error('MCP runtime is stopped');
    if (!this.manager) throw new Error('MCP runtime is not initialized');
    return this.manager;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  closeAdmission(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.discoveryClosing = this.manager?.cancelDiscovery();
    this.workspaceSkills.closeAdmission();
    this.authority.closeAdmission();
    this.workspaceExtensions.closeAdmission();
    if (this.ownsPolicy) this.policyOwner.closeAdmission();
    if (this.ownsFilesystem) this.workspaceFilesystem.closeFileAdmission();
    if (this.ownsMemory()) this.workspaceMemory.closeAdmission();
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.disposal = Promise.resolve().then(() => this.disposeResources());
    this.closingOperations = settleMcpClosures([
      () => this.closeAdmission(),
      () => this.discoveryClosing,
      () => {
        this.ideClosing = this.authority.closeIde();
        return this.ideClosing;
      },
      () => {
        this.lspClosing = this.ownsLsp
          ? this.workspaceLsp.dispose()
          : this.workspaceLsp.releaseToolRegistration();
        return this.lspClosing;
      },
      ...this.subscriptions,
    ]);
    this.subscriptions = [];
    return this.disposal;
  }

  private async closePublicationResources(): Promise<
    Array<PromiseSettledResult<void>>
  > {
    await Promise.allSettled([...this.reloadOperations]);
    await this.workspaceExtensions.joinAccepted();
    await Promise.allSettled([
      this.initialization,
      this.discovery,
      ...this.trustOperations,
      ...this.contextOperations,
    ]);
    this.managerClosing = this.manager?.stop();
    this.workspaceCheckpoints.closeAdmission();
    if (this.ownsDefinitions) this.workspaceDefinitions.closeAdmission();
    this.definitionContributions.closeAdmission();
    this.catalogs.closeAdmission();
    this.toolsAdmissionClosing = Promise.allSettled([
      this.tools.closeAdmission(),
    ]);
    return settleMcpClosures([
      () => this.releasePolicyProjection?.(),
      () => {
        if (this.ownsPolicy)
          this.policyOwner.session.confirmation.removeRulesBySource(
            MCP_SESSION_APPROVAL_SOURCE,
          );
      },
      () => {
        this.policyClosing = this.ownsPolicy
          ? this.policyOwner.dispose()
          : undefined;
        return this.policyClosing;
      },
      () => {
        this.skillsClosing = this.workspaceSkills.dispose();
        return this.skillsClosing;
      },
    ]);
  }

  private async disposeResources(): Promise<void> {
    const failures: unknown[] = [];
    const publicationClosures = await this.closePublicationResources();
    failures.push(
      ...(await joinMcpRetirementOperations([
        this.initialization,
        this.discovery,
        ...this.trustOperations,
        ...this.approvalWrites,
      ])),
    );
    for (const result of [
      ...publicationClosures,
      ...((await this.closingOperations) ?? []),
      ...((await this.toolsAdmissionClosing) ?? []),
    ])
      if (result.status === 'rejected') failures.push(result.reason);
    failures.push(
      ...(await joinMcpRetirementOperations([...this.contextOperations])),
    );
    failures.push(...(await clearSessionTools(this.sessionBindings)));
    for (const close of [
      () => this.workspaceCheckpoints.dispose(),
      () =>
        this.ownsDefinitions ? this.workspaceDefinitions.dispose() : undefined,
      () => this.workspaceExtensions.dispose(),
      () =>
        !this.ownsDefinitions
          ? this.definitionContributions.dispose()
          : undefined,
      () => this.lspClosing,
      () => this.catalogs.dispose(),
      () => this.managerClosing,
      () => this.releaseMcpPublication?.(),
      () => this.tools.dispose(),
      () => this.skillsClosing,
      () => (this.ownsMemory() ? this.workspaceMemory.dispose() : undefined),
      () =>
        this.ownsFilesystem ? this.workspaceFilesystem.dispose() : undefined,
    ]) {
      try {
        await Promise.resolve(close());
      } catch (error) {
        failures.push(error);
      }
    }
    const joins = await Promise.allSettled([
      this.authority.dispose(),
      this.policyClosing,
      ...this.trustOperations,
      ...this.approvalWrites,
      this.discovery,
      this.initialization,
    ]);
    for (const result of joins)
      if (result.status === 'rejected') failures.push(result.reason);
    if (failures.length > 0)
      throw new AggregateError(
        [...new Set(failures)],
        'Workspace runtime cleanup failed',
      );
  }
}
