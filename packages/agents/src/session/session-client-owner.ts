import { ProviderLifetimeOwnership } from './provider-lifetime-ownership.js';
import { ModelRegistry } from '@vybestack/llxprt-code-core/models/registry.js';
import type { InteractiveAuthPromptOperation } from '@vybestack/llxprt-code-core/runtime/contracts/InteractiveAuthPrompt.js';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import {
  OwnedClientLedger,
  SessionClientWorkQueue,
  cleanupProviderScope,
  finishCleanup,
  rethrowAfterClientCleanup,
} from './session-client-cleanup.js';
import {
  prepareNewSessionClient,
  prepareDetachedSessionClient,
  type PreparedSessionClient,
} from './session-new-client.js';
import { SessionImageAdmission } from './session-image-admission.js';
import {
  bindClientTokenization,
  requireSessionPolicy,
  bindFactoryClient,
  captureSessionRuntimeState,
  type SessionClientFactory,
} from './session-client-binding.js';
import {
  acceptSkillPublication,
  publishWorkspaceInstructions,
} from './session-skill-publication.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { AgenticLoop } from '../core/agenticLoop/AgenticLoop.js';
import type { AgenticLoopOptions } from '../core/agenticLoop/types.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import {
  bindSchedulerOwner,
  type SchedulerConstruction,
} from './assembleSchedulerOwner.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';

import type { ImageOperationRunner } from '@vybestack/llxprt-code-core/services/image/imageCapability.js';
import type { HostGitHubBrokerOwner } from '../api/host-github-broker-owner.js';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import type {
  RuntimeContentGeneratorFactory,
  ContentGenerator,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

import type { RegistryPolicy } from '@vybestack/llxprt-code-tools';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import { SessionInstructionOwner } from './session-instruction-owner.js';
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
} from '@vybestack/llxprt-code-core';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { SessionToolCatalogOwner } from './session-tool-catalog-owner.js';
import { buildToolDeclarationsFromView } from '../core/clientToolGovernance.js';
import { createTaskRegistration } from '../api/runtimeFactories.js';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { bindToolOutputSummary } from './session-tool-catalog-owner.js';
import { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { persistPolicyToToml } from '@vybestack/llxprt-code-core/policy/config.js';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { randomUUID } from 'node:crypto';
import type { Agent } from '../api/agent.js';
import type { McpRuntimeOwner } from '../api/mcpRuntimeAssembly.js';
import { AgentBootstrapError } from '../api/agentBootstrap.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  buildNewContentGeneratorConfig,
  extractExistingState,
  prepareAgentClientReplacement,
  prepareProfileClient,
} from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';

import { SessionHookComposition } from './session-hook-composition.js';

export class SessionClientOwner {
  static readonly cleanupProviderScope = cleanupProviderScope;
  private providerFileLifecycle: object | undefined;
  private cleanupProviderFiles?: (scopeId: string) => Promise<void>;
  get providerFiles(): object | undefined {
    return this.providerFileLifecycle;
  }
  private composeRetryOperations?: (
    provider: string,
  ) => ProviderRetryOperations;
  bindProviderFiles(
    lifecycle: object,
    composeRetryOperations: (provider: string) => ProviderRetryOperations,
    cleanupProviderFiles?: (scopeId: string) => Promise<void>,
  ): void {
    if (
      this.providerFileLifecycle !== undefined &&
      this.providerFileLifecycle !== lifecycle
    )
      throw new Error('Session provider files cannot change owner');
    this.providerFileLifecycle = lifecycle;
    this.composeRetryOperations = composeRetryOperations;
    this.cleanupProviderFiles =
      cleanupProviderFiles ?? this.cleanupProviderFiles;
    this.client.bindProviderFiles?.(lifecycle, composeRetryOperations);
  }

  private readonly hookComposition: SessionHookComposition;
  readonly hasHookComposition = () => this.hookComposition.isComposed();
  get hookOperations() {
    return this.hookComposition.operations;
  }
  readonly bindHooks = (...args: Parameters<SessionHookComposition['bind']>) =>
    this.hookComposition.bind(...args);
  readonly closeHookAdmission = () => this.hookComposition.closeAdmission();
  readonly disposeHooks = () => this.hookComposition.dispose();

  private instructionOwner: SessionInstructionOwner | undefined;
  private inheritedInstructions: InstructionReadOperations | undefined;
  readonly instructionReads: InstructionReadOperations = {
    snapshot: () => this.readInstructions().snapshot(),
    jit: (targetPath) => this.readInstructions().jit(targetPath),
  };
  private readInstructions(): InstructionReadOperations {
    const reads = this.instructionOwner?.reads ?? this.inheritedInstructions;
    if (reads === undefined)
      throw new Error(
        'Session instructions require explicit workspace composition',
      );
    return reads;
  }
  get memoryOperations(): Agent['memory'] {
    if (this.instructionOwner === undefined)
      throw new Error('Session memory requires workspace composition');
    return this.instructionOwner.memory;
  }
  bindInheritedInstructions(reads: InstructionReadOperations): void {
    if (
      this.instructionOwner !== undefined ||
      this.inheritedInstructions !== undefined
    )
      throw new Error('Session instructions are already composed');
    this.inheritedInstructions = reads;
  }
  private githubOwner: HostGitHubBrokerOwner | undefined;
  bindHostGitHub(owner: HostGitHubBrokerOwner | undefined): void {
    if (owner === undefined) return;
    if (this.githubOwner !== undefined)
      throw new Error('Host GitHub ownership is already composed');
    this.toolCatalog.bindGitHubReports(owner.operations);
    owner.transferToSession();
    this.githubOwner = owner;
  }

  readonly toolCatalog: SessionToolCatalogOwner;
  private prepareTools: (() => Promise<void>) | undefined;
  private boundWorkspace: McpRuntimeOwner | undefined;
  private sessionPolicy: SessionPolicyOwner | undefined;
  private ownsSessionPolicy = false;
  private readonly policyWrites = new Set<Promise<void>>();
  get messageBus() {
    return requireSessionPolicy(this.sessionPolicy).messageBus;
  }
  createLoop(
    client: AgentClientContract,
    scheduler: SchedulerConstruction | undefined,
    approvalHandler: AgenticLoopOptions['approvalHandler'],
    displayCallbacks: AgenticLoopOptions['displayCallbacks'],
  ): AgenticLoop {
    this.getAgentClient();
    const workspace = this.boundWorkspace;
    if (workspace === undefined)
      throw new AgentBootstrapError(
        'Loop construction requires workspace policy composition',
      );
    const interactiveMode = this.config.isInteractive();
    const messageBus = this.messageBus;
    return new AgenticLoop({
      agentClient: client,
      config: this.config,
      messageBus,
      createSchedulerOwner: bindSchedulerOwner(
        this.config,
        messageBus,
        interactiveMode,
        this.toolCatalog.selection,
        scheduler ?? ((options) => new CoreToolScheduler(options)),
        () => this.settingsOwner.readToolExecutionPolicy(),
        () => this.toolCatalog.readGovernance(),
        () =>
          workspace.trust.isTrustedFolder()
            ? this.config.getApprovalMode()
            : ApprovalMode.DEFAULT,
        this.settingsOwner.telemetry,
      ),
      approvalHandler,
      displayCallbacks,
      interactiveMode,
    });
  }
  addSessionPolicyRule(
    rule: Parameters<SessionPolicyOwner['confirmation']['addRule']>[0],
  ): void {
    this.getAgentClient();
    requireSessionPolicy(this.sessionPolicy).confirmation.addRule(rule);
  }
  get policyInspection() {
    return requireSessionPolicy(this.sessionPolicy).inspection;
  }
  private readonly mcpBindingToken = Symbol('MCP session client');
  private readonly images = new SessionImageAdmission();

  hasImageComposition(): boolean {
    return this.images.isComposed();
  }

  bindImageOperation(
    runner: ImageOperationRunner,
    cleanup?: () => Promise<void>,
  ): void {
    this.images.compose(runner, cleanup);
    this.toolCatalog.bindImageOperation((input) => this.images.run(input));
  }

  readonly runImageOperation: ImageOperationRunner = async (input) => {
    this.getAgentClient();
    return this.images.run(input);
  };

  closeImageAdmission(): Promise<void> {
    return this.images.close();
  }

  readonly operations: Agent['sessionClient'] = {
    fetch: (input, init) => this.network.fetch(input, init),
    refreshAuth: (method) => this.refreshAuth(method),
    publishTools: () => this.publishTools(),
    createDetachedAgentClient: (id) => this.createDetachedAgentClient(id),
    runImageOperation: (input) => this.runImageOperation(input),
  };
  private client: AgentClientContract;
  private runtimeState: AgentRuntimeState;
  private closing: Promise<void> | undefined;
  private readonly providerLife = new ProviderLifetimeOwnership();
  readonly adoptProviderLifetime = this.providerLife.adopt.bind(
    this.providerLife,
  );
  private admissionClosed = false;
  private releaseMcpBinding: (() => void) | undefined;
  private readonly work = new SessionClientWorkQueue(() =>
    this.getAgentClient(),
  );
  private readonly ownedClients = new OwnedClientLedger(async (scope) => {
    await this.cleanupProviderFiles?.(scope);
  });

  workspaceDirectories(): readonly string[] {
    return this.workspacePaths.directories();
  }

  private readonly network: OwnedFetch;
  readonly modelRegistry: ModelRegistry;

  constructor(
    private readonly config: Config,
    private readonly readTaskSchemaPolicy: () => RegistryPolicy,
    private readonly manager: RuntimeProviderManager,
    private readonly factory: SessionClientFactory,
    private readonly mediaStore: LocalMediaStore,
    private readMcpInstructions: () => string | undefined,
    private readonly workspacePaths: WorkspacePathOperations,
    private readonly settingsOwner: SessionSettingsOwner,
    readonly contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
    readonly tokenizerFactory: RuntimeTokenizerFactory,
    private readonly borrowedClient?: AgentClientContract,
    private readonly borrowedBus?: MessageBus,
  ) {
    this.hookComposition = new SessionHookComposition(
      config,
      () => settingsOwner.telemetry,
      () => this.messageBus,
      () => this.boundWorkspace?.trust,
      (reload) =>
        this.boundWorkspace?.bindSessionHookReload(
          this.mcpBindingToken,
          reload,
        ),
    );
    if (borrowedClient !== undefined) {
      borrowedClient.assertConfig(config);
      borrowedClient.assertProviderManager(manager);
      if (!borrowedClient.isInitialized())
        throw new Error('Borrowed session client must be initialized');
      if (borrowedClient.mediaStore !== mediaStore)
        throw new Error(
          'Borrowed session client must retain its explicit media store',
        );
    }
    this.network = new OwnedFetch(config.getProxy());
    this.modelRegistry = new ModelRegistry(this.network.fetch);
    manager.bindModelRegistry?.(this.modelRegistry);
    manager.bindNetworkFetch?.(this.network.fetch);
    this.toolCatalog = new SessionToolCatalogOwner(
      config,
      this.readTaskSchemaPolicy,
      () => this.settingsOwner.readToolExecutionPolicy(),
      this.network.fetch,
    );
    this.runtimeState = this.captureRuntimeState(
      config.getSessionId() || `runtime-${randomUUID()}`,
      config.getSessionId(),
    );
    this.client = borrowedClient ?? this.acquireClient(this.runtimeState);
    if (borrowedClient !== undefined) {
      bindClientTokenization(borrowedClient, this.tokenizerFactory);
      this.initialBindingComplete = true;
    }
  }

  /**
   * Acquires and binds the initial client. Binding is fallible and a failed
   * binding must dispose the acquired client before construction rejects, so
   * construction is awaitable rather than done in the synchronous constructor.
   * A disposal failure is joined to the binding error, never substituted.
   */
  static async create(
    ...args: ConstructorParameters<typeof SessionClientOwner>
  ): Promise<SessionClientOwner> {
    const owner = new SessionClientOwner(...args);
    if (!owner.initialBindingComplete) {
      try {
        owner.bindCreatedClient(owner.client, owner.runtimeState);
      } catch (error) {
        await rethrowAfterClientCleanup(
          error,
          () => owner.ownedClients.dispose(owner.client),
          () => {
            owner.modelRegistry.dispose();
            return owner.network.dispose();
          },
        );
      }
      owner.initialBindingComplete = true;
    }
    return owner;
  }

  private initialBindingComplete = false;
  private requestInteractiveAuth: InteractiveAuthPromptOperation | undefined;
  bindInteractiveAuthRequests(operation: InteractiveAuthPromptOperation): void {
    this.requestInteractiveAuth = operation;
  }

  bindWorkspaceInstructions(
    workspace: McpRuntimeOwner['workspaceMemory'],
  ): void {
    if (this.inheritedInstructions !== undefined)
      throw new Error('Inherited session instructions cannot be rebound');
    if (this.instructionOwner !== undefined) {
      if (this.instructionWorkspace !== workspace)
        throw new Error('Session instruction workspace must retain its owner');
      return;
    }
    this.instructionWorkspace = workspace;
    this.instructionOwner = new SessionInstructionOwner(
      workspace.operations,
      this.config.getProvidedInstructions(),
      this.config.isJitContextEnabled(),
      (instructions) => this.publishInstructions(instructions),
    );
  }
  private instructionWorkspace: McpRuntimeOwner['workspaceMemory'] | undefined;

  bindMcpRuntime(
    workspace: McpRuntimeOwner,
    registration: TaskToolRegistration = createTaskRegistration(),
    profiles: ProfileDefinitionReads = workspace.profileDefinitions,
    subagents: SubagentDefinitionReads = workspace.subagentDefinitions,
  ): void {
    if (this.boundWorkspace === workspace) return;
    if (this.boundWorkspace !== undefined)
      throw new Error('Session already has workspace policy composition');
    this.boundWorkspace = workspace;
    this.client.bindIdeContext?.(
      () => workspace.ide.getClient()?.getIdeContext(),
      () => workspace.ide.isEnabled(),
    );
    this.bindDefinitionReads(profiles, subagents);
    this.bindWorkspaceInstructions(workspace.workspaceMemory);
    const { policy, sessionApproval } = this.bindSessionApproval(workspace);
    this.prepareTools = () =>
      this.toolCatalog.initialize(
        () => workspace.isStopped(),
        workspace.workspacePaths,
        workspace.workspaceFiles,
        workspace.workspaceIgnore,
        workspace.workspaceScans,
        workspace.workspaceLsp.diagnostics,
        workspace.ide,
        workspace.trust,
        workspace.toolSelection,
        workspace.readInstructions,
        policy.messageBus,
        registration,
        bindToolOutputSummary(
          () => this.getAgentClient(),
          () => this.config.getUtilityModel(),
        ),
        sessionApproval,
        this.instructionReads,
        () => this.settingsOwner.createChildStore(),
        () => this.settingsOwner.readTaskPolicy(),
        () => this.settingsOwner.readSubagentRunPolicy(),
        profiles,
        subagents,
        this.hookOperations,
        this.settingsOwner.telemetry,
        this.requestInteractiveAuth,
      );
    workspace.bindSessionClient(
      this.config,
      this.mcpBindingToken,
      () => this.client,
      () => this.publishTools(),
      () => this.publishInstructions(this.instructionReads),
      (read, release) => this.bindMcpInstructions(read, release),
      () =>
        acceptSkillPublication(this.client, this.toolCatalog, (operation) =>
          this.work.enqueueAccepted(operation),
        ),
    );
  }

  private bindSessionApproval(workspace: McpRuntimeOwner) {
    const policy =
      this.borrowedClient === undefined && this.borrowedBus === undefined
        ? new SessionPolicyOwner(workspace.policyOwner.workspace, this.config)
        : workspace.policyOwner.session;
    this.ownsSessionPolicy =
      this.borrowedClient === undefined && this.borrowedBus === undefined;
    this.sessionPolicy = policy;
    const approval = createMcpApprovalPolicy(
      { ...policy.decisions, ...policy.confirmation },
      (message) => {
        const write = persistPolicyToToml(message);
        this.policyWrites.add(write);
        void write.then(
          () => this.policyWrites.delete(write),
          () => this.policyWrites.delete(write),
        );
        return write;
      },
      () => this.getAgentClient(),
    );
    const sessionApproval = {
      ...approval,
      evaluate: (...args: Parameters<typeof approval.evaluate>) => {
        const upstream = workspace.policyOwner.session.decisions.evaluate(
          args[0].serverName + '__' + args[0].toolName,
          args[1],
          args[0].serverName,
        );
        return upstream === PolicyDecision.DENY
          ? upstream
          : approval.evaluate(...args);
      },
    };
    return { policy, sessionApproval };
  }

  bindInheritedTools(
    selection: AgentClientContract['tools'],
    bus: MessageBus,
    trust?: WorkspaceTrustControlPort,
  ): void {
    if (this.prepareTools !== undefined)
      throw new Error('Child already has tool composition');
    this.prepareTools = () =>
      this.toolCatalog.initializeInherited(selection, bus, trust);
  }

  bindMcpInstructions(
    read: () => string | undefined,
    release: () => void,
  ): void {
    this.getAgentClient();
    if (this.releaseMcpBinding !== undefined)
      throw new Error('Session client already has an MCP binding');
    this.readMcpInstructions = read;
    this.releaseMcpBinding = release;
  }

  getAgentClient(): AgentClientContract {
    if (!this.initialBindingComplete)
      throw new Error('Session client owner is not initialized');
    if (this.admissionClosed)
      throw new Error('Session client owner is disposed');
    return this.client;
  }

  private readonly captureRuntimeState = (
    runtimeId: string,
    sessionId: string,
  ) =>
    captureSessionRuntimeState(this.settingsOwner, {
      runtimeId,
      sessionId,
      proxyUrl: this.config.getProxy(),
    });

  private profileDefinitions:
    | Pick<ProfileDefinitionReads, 'loadProfile'>
    | undefined;
  private subagentDefinitions:
    | Pick<SubagentDefinitionReads, 'listSubagents'>
    | undefined;

  bindDefinitionReads(
    profiles: Pick<ProfileDefinitionReads, 'loadProfile'>,
    subagents: Pick<SubagentDefinitionReads, 'listSubagents'>,
  ): void {
    this.profileDefinitions = profiles;
    this.subagentDefinitions = subagents;
    this.client.bindWorkspaceDefinitions?.(profiles, subagents);
  }

  /**
   * The factory hands over a live client (it holds listeners), so the cleanup
   * obligation exists from this point, before any fallible validation or binding.
   */
  private acquireClient(state: typeof this.runtimeState): AgentClientContract {
    const client = this.factory(
      this.config,
      state,
      () => this.readMcpInstructions(),
      this.mediaStore,
      this.workspacePaths,
      this.instructionReads,
    );
    if (client === undefined)
      throw new AgentBootstrapError('no post-auth agent client');
    this.ownedClients.register(client, state.runtimeId);
    return client;
  }

  private async createClient(
    state: typeof this.runtimeState,
  ): Promise<AgentClientContract> {
    const client = this.acquireClient(state);
    try {
      this.bindCreatedClient(client, state);
    } catch (error) {
      await this.ownedClients.disposeAfterFailure(client, error);
    }
    return client;
  }

  private bindCreatedClient(
    client: AgentClientContract,
    state: typeof this.runtimeState,
  ): void {
    bindFactoryClient(client, {
      config: this.config,
      mediaStore: this.mediaStore,
      settingsOwner: this.settingsOwner,
      fetch: this.network.fetch,
      manager: this.manager,
      tokenizerFactory: this.tokenizerFactory,
      runtimeId: state.runtimeId,
      sessionId: state.sessionId,
      toolSelection: this.toolCatalog.selection,
      definitions:
        this.profileDefinitions !== undefined &&
        this.subagentDefinitions !== undefined
          ? {
              profiles: this.profileDefinitions,
              subagents: this.subagentDefinitions,
            }
          : undefined,
      readIdeContext: () =>
        this.boundWorkspace?.ide.getClient()?.getIdeContext(),
      isIdeEnabled: () => this.boundWorkspace?.ide.isEnabled() ?? false,
      providerFiles:
        this.providerFileLifecycle !== undefined &&
        this.composeRetryOperations !== undefined
          ? {
              lifecycle: this.providerFileLifecycle,
              composeRetryOperations: this.composeRetryOperations,
            }
          : undefined,
    });
  }

  refreshAuth(_authMethod?: string): Promise<void> {
    return this.work.enqueue(() => this.replaceClient());
  }

  prepareNewSession(
    sessionId: string,
    onPublish: () => void,
  ): Promise<PreparedSessionClient> {
    return this.work.enqueue(() =>
      prepareNewSessionClient(
        this.captureRuntimeState(`${sessionId}#client`, sessionId),
        this.tokenizerFactory,
        this.contentGeneratorFactory,
        this.settingsOwner,
        this.client,
        this.borrowedClient,
        this.ownedClients,
        (state) => this.acquireClient(state),
        (client, state) => this.bindCreatedClient(client, state),
        (client, state) => {
          this.runtimeState = state;
          this.client = client;
          this.config.setFallbackMode(false);
          onPublish();
        },
      ),
    );
  }

  private async replaceClient(): Promise<void> {
    const sessionId = this.runtimeState.sessionId;
    const previous = this.client;
    const canReuseBorrowed = previous === this.borrowedClient;
    if (
      canReuseBorrowed &&
      this.runtimeState.sessionId === sessionId &&
      this.runtimeState.model === this.settingsOwner.readSelectedModel() &&
      this.runtimeState.provider === this.settingsOwner.readSelectedProvider()
    ) {
      await previous.setTools();
      return;
    }
    const logger = new DebugLogger('llxprt:session:refreshAuth');
    const { history, historyService } = await extractExistingState(
      logger,
      previous,
    );
    const prepared = buildNewContentGeneratorConfig(
      this.contentGeneratorFactory,
      this.captureRuntimeState(this.runtimeState.runtimeId, sessionId),
    );
    await this.tokenizerFactory.prepareTokenizer?.(
      prepared.runtimeState.provider,
      prepared.runtimeState.model,
    );
    const next = this.acquireClient(prepared.runtimeState);
    try {
      this.bindCreatedClient(next, prepared.runtimeState);
    } catch (error) {
      await this.ownedClients.disposeAfterFailure(next, error);
    }
    try {
      await prepareAgentClientReplacement(
        logger,
        next,
        previous === this.borrowedClient ? undefined : previous,
        history,
        historyService,
        prepared.contentGeneratorConfig,
        previous.getContentGeneratorConfig()?.vertexai,
      );
    } catch (error) {
      await this.ownedClients.releaseFailedReplacement(next, error);
    }
    this.ownedClients.forget(previous);
    this.runtimeState = prepared.runtimeState;
    this.client = next;
    const tokenizer = this.tokenizerFactory;
    next.getHistoryService()?.setTokenizerFactory({
      getTokenizer: (provider, model) =>
        tokenizer.getTokenizer(provider, model),
    });
    this.config.setFallbackMode(false);
  }

  prepareProfileClientReplacement(): Promise<{
    client: AgentClientContract;
    prepareHistoryCommit: () => Promise<() => void>;
    publish: () => void;
    retire: () => Promise<void>;
    discard: () => Promise<void>;
  }> {
    return this.work.enqueue(() => this.prepareProfileClient());
  }

  private async prepareProfileClient(): ReturnType<
    SessionClientOwner['prepareProfileClientReplacement']
  > {
    const previous = this.client;
    const selectedState = this.captureRuntimeState(
      this.runtimeState.runtimeId,
      this.runtimeState.sessionId,
    );
    await this.tokenizerFactory.prepareTokenizer?.(
      selectedState.provider,
      selectedState.model,
    );
    let candidate: AgentClientContract | undefined;
    let candidateBound = false;
    const prepared = await prepareProfileClient(
      this.config,
      previous,
      (_config, state) => {
        candidate = this.acquireClient(state);
        this.bindCreatedClient(candidate, state);
        candidateBound = true;
        return candidate;
      },
      selectedState,
      this.contentGeneratorFactory,
    ).catch(async (error: unknown) => {
      if (candidate !== undefined) {
        if (!candidateBound)
          await this.ownedClients.disposeAfterFailure(candidate, error);
        await this.ownedClients.releaseFailedReplacement(candidate, error);
      }
      throw error;
    });
    const ledger = this.ownedClients;
    return {
      client: prepared.client,
      prepareHistoryCommit:
        previous === this.borrowedClient
          ? async () => () => {}
          : prepared.prepareHistoryCommit,
      publish: () => {
        if (this.client !== previous)
          throw new Error(
            'Profile candidate no longer belongs to the current session client',
          );
        this.client = prepared.client;
        this.runtimeState = prepared.runtimeState;
        this.config.setFallbackMode(false);
      },
      retire: () => this.work.enqueueAccepted(() => ledger.dispose(previous)),
      discard: () =>
        this.work.enqueueAccepted(() => ledger.dispose(prepared.client)),
    };
  }

  createDetachedAgentClient(
    id = `${this.runtimeState.sessionId}#detached#${randomUUID()}`,
  ): Promise<AgentClientContract> {
    return this.work.enqueue(() =>
      prepareDetachedSessionClient({
        state: this.captureRuntimeState(id, this.runtimeState.sessionId),
        tokenizer: this.tokenizerFactory,
        factory: this.contentGeneratorFactory,
        create: (state) => this.createClient(state),
        ledger: this.ownedClients,
      }),
    );
  }

  async initializeTools(): Promise<void> {
    if (this.prepareTools === undefined)
      throw new Error('Session tools require their workspace composition');
    await this.prepareTools();
  }

  private publishInstructions(
    instructions: InstructionReadOperations,
  ): Promise<void> {
    return publishWorkspaceInstructions(
      this.client,
      instructions,
      () => this.boundWorkspace?.isStopped() === true,
      (operation) => this.work.enqueueAccepted(operation),
    );
  }

  publishTools(): Promise<void> {
    const selection = this.getAgentClient().tools;
    const declarations = this.client.isInitialized()
      ? buildToolDeclarationsFromView(selection, {
          listToolNames: () => selection.getAllToolNames(),
        })
      : undefined;
    return this.work.enqueue(async () => {
      const client = this.client;
      if (client.isInitialized()) await client.setTools(declarations);
    });
  }

  closeAdmission(): void {
    this.admissionClosed = true;
    this.providerLife.closeAdmission();
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    this.closeHookAdmission();
    this.githubOwner?.closeAdmission();
    const imagesClosing = this.closeImageAdmission();
    void imagesClosing.catch(() => undefined);
    const toolsClosing = this.toolCatalog.closeAdmission();
    void toolsClosing.catch(() => undefined);
    if (this.closing !== undefined) return this.closing;
    const bindingClosing = Promise.resolve().then(() =>
      this.releaseMcpBinding?.(),
    );
    this.closing = Promise.allSettled([bindingClosing]).then(
      async (binding) => {
        const hooks = await Promise.allSettled([this.disposeHooks()]);
        await this.work.join();
        const instructions = await Promise.allSettled([
          this.instructionOwner?.dispose(),
        ]);
        const services = await Promise.allSettled([
          this.toolCatalog.dispose(),
          this.githubOwner?.dispose(),
          imagesClosing,
        ]);
        const clients = await Promise.allSettled(
          this.ownedClients
            .clients()
            .map((client) => this.ownedClients.dispose(client)),
        );
        this.modelRegistry.dispose();
        const network = await Promise.allSettled([this.network.dispose()]);
        const writes = await Promise.allSettled([...this.policyWrites]);
        const policy = await Promise.allSettled([
          this.ownsSessionPolicy ? this.sessionPolicy?.dispose() : undefined,
        ]);
        finishCleanup(
          await Promise.allSettled([this.providerLife.close()]),
          hooks,
          instructions,
          services,
          binding,
          clients,
          network,
          writes,
          policy,
        );
      },
    );
    return this.closing;
  }
}
