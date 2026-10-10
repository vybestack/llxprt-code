import { OwnedClientLedger } from './session-client-cleanup.js';
import { SessionImageAdmission } from './session-image-admission.js';
import {
  bindClientTokenization,
  bindFactoryClient,
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

import type {
  ImageOperationRunner,
  ImageOperationRunnerInput,
  ImageOperationRunnerResult,
} from '@vybestack/llxprt-code-core/services/image/imageCapability.js';
import type { HostGitHubBrokerOwner } from '../api/host-github-broker-owner.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
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
import { summarizeToolOutput } from '@vybestack/llxprt-code-core/utils/summarizer.js';
import { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { createMcpApprovalPolicy } from '@vybestack/llxprt-code-core/policy/mcp-approval.js';
import { persistPolicyToToml } from '@vybestack/llxprt-code-core/policy/config.js';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { randomUUID } from 'node:crypto';
import type { Agent } from '../api/agent.js';
import type { McpRuntimeOwner } from '../api/mcpRuntimeAssembly.js';
import { AgentBootstrapError } from '../api/agentBootstrap.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import {
  PLACEHOLDER_MODEL,
  UNCONFIGURED_PROVIDER,
} from '@vybestack/llxprt-code-core/config/models.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  buildNewContentGeneratorConfig,
  extractExistingState,
  prepareAgentClientReplacement,
  prepareProfileClient,
} from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';

import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  readHookDefinitions,
  hookSessionRuntime,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';

export class SessionClientOwner {
  static async cleanupProviderScope(
    files: ProviderFileLifecycle,
    scope: string,
  ): Promise<void> {
    const result = await files.cleanupScope('session', scope);
    if (result.failed > 0)
      throw new Error(
        `Provider file cleanup incomplete for scope ${scope}: ${JSON.stringify(files.snapshot().deletionFailures)}`,
      );
    if (result.deferred > 0) await files.waitForScopeCleanup('session', scope);
  }
  private providerFileLifecycle: object | undefined;
  private cleanupProviderFiles:
    | ((scopeId: string) => Promise<void>)
    | undefined;
  get providerFiles(): object | undefined {
    return this.providerFileLifecycle;
  }
  private composeRetryOperations:
    | ((provider: string) => ProviderRetryOperations)
    | undefined;
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

  private hookRoot: SessionHookOwner | undefined;
  private releaseHookReload: (() => void) | undefined;
  private ownsHookRoot = false;
  hasHookComposition(): boolean {
    return this.hookRoot !== undefined;
  }
  get hookOperations(): SessionHookOwner {
    if (this.hookRoot === undefined)
      throw new Error('Missing session hook composition');
    return this.hookRoot;
  }
  bindHooks(
    root?: SessionHookOwner,
    bus: MessageBus = this.messageBus,
    trust: WorkspaceTrustControlPort | undefined = this.boundWorkspace?.trust,
  ): void {
    if (this.hookRoot !== undefined)
      throw new Error('Session hooks are already composed');
    if (root !== undefined) {
      root.assertMessageBus(bus);
      this.hookRoot = root.fork();
    } else {
      if (trust === undefined)
        throw new Error('Hooks require explicit workspace trust composition');
      this.hookRoot = new SessionHookOwner(
        readHookDefinitions(this.config),
        hookSessionRuntime(this.config, trust, this.settingsOwner.telemetry),
        this.config.getEnableHooks(),
        bus,
      );
    }
    this.ownsHookRoot = true;
    this.releaseHookReload = this.boundWorkspace?.bindSessionHookReload(
      this.mcpBindingToken,
      () => this.hookOperations.reloadDefinitions(),
    );
  }
  closeHookAdmission(): void {
    this.releaseHookReload?.();
    this.releaseHookReload = undefined;
    this.hookRoot?.closeAdmission();
  }

  disposeHooks(): Promise<void> {
    this.closeHookAdmission();
    return this.ownsHookRoot
      ? (this.hookRoot?.dispose() ?? Promise.resolve())
      : Promise.resolve();
  }

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
    if (this.sessionPolicy === undefined)
      throw new Error('Missing session policy composition');
    return this.sessionPolicy.messageBus;
  }
  addSessionPolicyRule(
    rule: Parameters<SessionPolicyOwner['confirmation']['addRule']>[0],
  ): void {
    this.getAgentClient();
    if (this.sessionPolicy === undefined)
      throw new Error('Missing session policy composition');
    this.sessionPolicy.confirmation.addRule(rule);
  }
  get policyInspection() {
    if (this.sessionPolicy === undefined)
      throw new Error('Missing session policy composition');
    return this.sessionPolicy.inspection;
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
    this.toolCatalog.bindImageOperation((input) =>
      this.runImageOperation(input),
    );
  }

  runImageOperation(
    input: ImageOperationRunnerInput,
  ): Promise<ImageOperationRunnerResult> {
    return this.images.run(input);
  }

  closeImageAdmission(): Promise<void> {
    return this.images.close();
  }

  readonly operations: Agent['sessionClient'] = {
    refreshAuth: (method) => this.refreshAuth(method),
    publishTools: () => this.publishTools(),
    createDetachedAgentClient: (id) => this.createDetachedAgentClient(id),
    runImageOperation: (input) => this.runImageOperation(input),
  };
  private client: AgentClientContract;
  private runtimeState: AgentRuntimeState;
  private closing: Promise<void> | undefined;
  private releaseMcpBinding: (() => void) | undefined;
  private tail: Promise<void> = Promise.resolve();
  private readonly ownedClients = new OwnedClientLedger(async (scope) => {
    await this.cleanupProviderFiles?.(scope);
  });

  workspaceDirectories(): readonly string[] {
    return this.workspacePaths.directories();
  }

  constructor(
    private readonly config: Config,
    private readonly readTaskSchemaPolicy: () => RegistryPolicy,
    private readonly manager: RuntimeProviderManager,
    private readonly factory: (
      ...args: Parameters<AgentClientFactory>
    ) => AgentClientContract | undefined,
    private readonly mediaStore: LocalMediaStore,
    private readMcpInstructions: () => string | undefined,
    private readonly workspacePaths: WorkspacePathOperations,
    private readonly settingsOwner: SessionSettingsOwner,
    readonly contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
    readonly tokenizerFactory: RuntimeTokenizerFactory,
    private readonly borrowedClient?: AgentClientContract,
    private readonly borrowedBus?: MessageBus,
  ) {
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
    this.toolCatalog = new SessionToolCatalogOwner(
      config,
      this.readTaskSchemaPolicy,
      () => this.settingsOwner.readToolExecutionPolicy(),
    );
    this.runtimeState = this.captureRuntimeState(
      config.getSessionId() || `runtime-${randomUUID()}`,
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
        await owner.ownedClients.disposeAfterFailure(owner.client, error);
      }
      owner.initialBindingComplete = true;
    }
    return owner;
  }

  /**
   * Synchronous construction for the public activation bootstrap, whose
   * signature is synchronous. A failed binding starts disposal of the acquired
   * client in the background, so rollback is not joined and a disposal failure
   * is only logged. Prefer {@link SessionClientOwner.create}.
   */
  static createWithBackgroundRollback(
    ...args: ConstructorParameters<typeof SessionClientOwner>
  ): SessionClientOwner {
    const owner = new SessionClientOwner(...args);
    if (!owner.initialBindingComplete) {
      try {
        owner.bindCreatedClient(owner.client, owner.runtimeState);
      } catch (error) {
        owner.releaseAbandonedClient(owner.client);
        throw error;
      }
      owner.initialBindingComplete = true;
    }
    return owner;
  }

  private initialBindingComplete = false;

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
    definitions: Pick<
      McpRuntimeOwner,
      'profileDefinitions' | 'subagentDefinitions'
    > = workspace,
  ): void {
    if (this.boundWorkspace === workspace) return;
    if (this.boundWorkspace !== undefined)
      throw new Error('Session already has workspace policy composition');
    this.boundWorkspace = workspace;
    this.client.bindIdeContext?.(
      () => workspace.ide.getClient()?.getIdeContext(),
      () => workspace.ide.isEnabled(),
    );
    this.bindDefinitionReads(
      definitions.profileDefinitions,
      definitions.subagentDefinitions,
    );
    this.bindWorkspaceInstructions(workspace.workspaceMemory);
    const { policy, sessionApproval } = this.bindSessionApproval(workspace);
    this.prepareTools = () =>
      this.toolCatalog.initialize(
        workspace,
        policy.messageBus,
        registration,
        (content, signal, budget) =>
          summarizeToolOutput(
            content,
            this.getAgentClient(),
            signal,
            budget,
            this.config.getUtilityModel(),
          ),
        sessionApproval,
        this.instructionReads,
        () => this.settingsOwner.createChildStore(),
        () => this.settingsOwner.readTaskPolicy(),
        () => this.settingsOwner.readSubagentRunPolicy(),
        definitions.profileDefinitions,
        definitions.subagentDefinitions,
        this.hookOperations,
        this.settingsOwner.telemetry,
      );
    workspace.bindSessionClient(
      this.config,
      this.mcpBindingToken,
      () => this.getAgentClient(),
      () => this.publishTools(),
      () => this.publishInstructions(this.instructionReads),
      (read, release) => this.bindMcpInstructions(read, release),
      () => this.acceptSkillPublication(),
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
    if (this.closing !== undefined)
      throw new Error('Session client owner is disposed');
    return this.client;
  }

  private captureRuntimeState(runtimeId: string): AgentRuntimeState {
    return createAgentRuntimeState({
      runtimeId,
      provider:
        this.settingsOwner.readSelectedProvider() ?? UNCONFIGURED_PROVIDER,
      model: this.settingsOwner.readSelectedModel() ?? PLACEHOLDER_MODEL,
      sessionId: this.config.getSessionId(),
      baseUrl: this.settingsOwner.readSelectedEndpoint(),
      proxyUrl: this.config.getProxy(),
    });
  }

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

  private createClient(state: typeof this.runtimeState): AgentClientContract {
    const client = this.acquireClient(state);
    try {
      this.bindCreatedClient(client, state);
    } catch (error) {
      this.releaseAbandonedClient(client);
      throw error;
    }
    return client;
  }

  /**
   * Replacement paths build their candidate inside synchronous factory
   * callbacks, so release of a client abandoned by a failed binding cannot be
   * awaited there; a cleanup failure is logged and never replaces the binding
   * error that is being propagated. Initial acquisition does not use this
   * path: see {@link SessionClientOwner.create}.
   */
  private releaseAbandonedClient(client: AgentClientContract): void {
    this.ownedClients.dispose(client).catch((cleanupError: unknown) => {
      new DebugLogger('llxprt:session:createClient').error(
        'Failed to dispose a session client abandoned by failed binding',
        cleanupError,
      );
    });
  }

  private bindCreatedClient(
    client: AgentClientContract,
    state: typeof this.runtimeState,
  ): void {
    bindFactoryClient(client, {
      config: this.config,
      mediaStore: this.mediaStore,
      settingsOwner: this.settingsOwner,
      manager: this.manager,
      tokenizerFactory: this.tokenizerFactory,
      runtimeId: state.runtimeId,
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

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.getAgentClient();
    return this.enqueueAccepted(operation);
  }

  private enqueueAccepted<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation);
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  refreshAuth(_authMethod?: string): Promise<void> {
    return this.enqueue(() => this.replaceClient());
  }

  private async replaceClient(): Promise<void> {
    const previous = this.client;
    if (
      previous === this.borrowedClient &&
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
      this.captureRuntimeState(this.runtimeState.runtimeId),
    );
    await this.tokenizerFactory.prepareTokenizer?.(
      prepared.runtimeState.provider,
      prepared.runtimeState.model,
    );
    const next = this.createClient(prepared.runtimeState);
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
    return this.enqueue(() => this.prepareProfileClient());
  }

  private async prepareProfileClient(): ReturnType<
    SessionClientOwner['prepareProfileClientReplacement']
  > {
    const previous = this.client;
    const selectedState = this.captureRuntimeState(this.runtimeState.runtimeId);
    await this.tokenizerFactory.prepareTokenizer?.(
      selectedState.provider,
      selectedState.model,
    );
    let candidate: AgentClientContract | undefined;
    const prepared = await prepareProfileClient(
      this.config,
      previous,
      (_config, state) => {
        candidate = this.createClient(state);
        return candidate;
      },
      selectedState,
      this.contentGeneratorFactory,
    ).catch(async (error: unknown) => {
      if (candidate !== undefined)
        await this.ownedClients.releaseFailedReplacement(candidate, error);
      throw error;
    });
    return {
      client: prepared.client,
      prepareHistoryCommit:
        previous === this.borrowedClient
          ? async () => () => {}
          : prepared.prepareHistoryCommit,
      publish: () => {
        if (this.getAgentClient() !== previous)
          throw new Error(
            'Profile candidate no longer belongs to the current session client',
          );
        this.client = prepared.client;
        this.runtimeState = prepared.runtimeState;
        this.config.setFallbackMode(false);
      },
      retire: () => this.enqueue(() => this.ownedClients.dispose(previous)),
      discard: () =>
        this.enqueue(() => this.ownedClients.dispose(prepared.client)),
    };
  }

  createDetachedAgentClient(
    id = `${this.config.getSessionId()}#detached#${randomUUID()}`,
  ): Promise<AgentClientContract> {
    return this.enqueue(async () => {
      const selectedState = this.captureRuntimeState(id);
      await this.tokenizerFactory.prepareTokenizer?.(
        selectedState.provider,
        selectedState.model,
      );
      const client = this.createClient(selectedState);
      try {
        await client.initialize(
          buildNewContentGeneratorConfig(
            this.contentGeneratorFactory,
            selectedState,
          ).contentGeneratorConfig,
        );
        client.clearTools();
        return client;
      } catch (error) {
        try {
          await this.ownedClients.dispose(client);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Detached client setup and cleanup failed',
          );
        }
        throw error;
      }
    });
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
      (operation) => this.enqueueAccepted(operation),
    );
  }

  private acceptSkillPublication() {
    return acceptSkillPublication(
      this.getAgentClient(),
      this.toolCatalog,
      (operation) => this.enqueueAccepted(operation),
    );
  }

  publishTools(): Promise<void> {
    const selection = this.getAgentClient().tools;
    const declarations = this.client.isInitialized()
      ? buildToolDeclarationsFromView(selection, {
          listToolNames: () => selection.getAllToolNames(),
        })
      : undefined;
    return this.enqueue(async () => {
      const client = this.client;
      if (client.isInitialized()) await client.setTools(declarations);
    });
  }

  dispose(): Promise<void> {
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
        await this.tail;
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
        const writes = await Promise.allSettled([...this.policyWrites]);
        const policy = await Promise.allSettled([
          this.ownsSessionPolicy ? this.sessionPolicy?.dispose() : undefined,
        ]);
        const failures = [
          ...hooks,
          ...instructions,
          ...services,
          ...binding,
          ...clients,
          ...writes,
          ...policy,
        ].flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length > 0)
          throw new AggregateError(failures, 'Session client cleanup failed');
      },
    );
    return this.closing;
  }
}
