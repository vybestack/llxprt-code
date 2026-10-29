/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type {
  ContentGenerator,
  ProfileDefinitionReads,
  RuntimeContentGeneratorFactory,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
  SubagentDefinitionReads,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  AgentChatRecordingExecution,
  AgentClientContract,
  DeferredHistorySourceOptions,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ModelRegistry } from '@vybestack/llxprt-code-core/models/registry.js';
import type { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { randomUUID } from 'node:crypto';
import type {
  Agent,
  AgentInput,
  AgentMessage,
  GenerateOptions,
} from '../api/agent.js';
import { AgentBootstrapError, bindTelemetry } from '../api/agentBootstrap.js';
import type { SessionWorkspaceAuthorityPort } from '../api/mcpRuntimePorts.js';
import type { PreparedProfileFacade } from '../api/profileApplicationAssembly.js';
import {
  SessionProviderFileBinding,
  type AgentProviderFileOperations,
} from '../api/provider-file-domain.js';
import type * as LoopTypes from '../core/agenticLoop/types.js';
import { AuxiliaryWork } from '../core/auxiliary-work.js';
import { prepareClientToolPublication } from '../core/clientToolGovernance.js';
import { type SchedulerConstruction } from './assembleSchedulerOwner.js';
import { ProviderLifetimeOwnership } from './provider-lifetime-ownership.js';
import {
  assertClientOwnership,
  bindClientDefinitions,
  bindClientModels,
  bindClientSettings,
  captureGenerationState,
  captureSessionRuntimeState,
  requireSessionPolicy,
  type SessionClientFactory,
  type ClientDefinitionBinding,
} from './session-client-binding.js';
import {
  OwnedClientLedger,
  SessionClientWorkQueue,
  initializeClientBinding,
} from './session-client-cleanup.js';
import { SessionConversationBinding } from './session-conversation-binding.js';
import {
  EXECUTION_NOT_INITIALIZED,
  SessionExecutionOwner,
  type SessionExecution,
  type SessionLoopResolution,
  toLoopResolution,
} from './session-execution-owner.js';
import { SessionInstructionBinding } from './session-instruction-binding.js';
import {
  prepareBoundProfileClient,
  prepareNewSessionClient,
  replaceSessionClient,
  type PreparedProfileClient,
  type PreparedRecordingSession,
} from './session-new-client.js';
import { publishWorkspaceInstructions } from './session-skill-publication.js';
import { SessionTextGeneration } from './session-text-generation.js';
import type { SessionToolCatalogOwner } from './session-tool-catalog-owner.js';

export interface SessionClientEnvironment {
  readonly config: Config;
  readonly mediaStore: LocalMediaStore;
  readonly readMcpInstructions: () => string | undefined;
  readonly workspacePaths: WorkspacePathOperations;
  readonly settingsOwner: SessionSettingsOwner;
}
export interface SessionClientFactories {
  readonly manager: RuntimeProviderManager;
  readonly factory: SessionClientFactory;
  readonly contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>;
  readonly tokenizerFactory: RuntimeTokenizerFactory;
}
export type SessionWorkspaceBinding =
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'bound';
      readonly workspace: SessionWorkspaceAuthorityPort;
    };

export interface SessionClientBindings {
  readonly toolCatalog: SessionToolCatalogOwner;
  readonly modelRegistry: ModelRegistry;
  readonly readWorkspace: () => SessionWorkspaceBinding;
  readonly readPolicy: () => SessionPolicyOwner | undefined;
}
export class SessionClientAcquisitionOwner {
  private client: AgentClientContract;
  readonly conversationBinding: SessionConversationBinding;
  constructor(
    private readonly environment: SessionClientEnvironment,
    private readonly factories: SessionClientFactories,
    private readonly bindings: SessionClientBindings,
  ) {
    this.runtimeState = this.captureRuntimeState(
      environment.config.getSessionId() || `runtime-${randomUUID()}`,
      environment.config.getSessionId(),
    );
    this.client = this.acquireClient(this.runtimeState);
    this.textGeneration = new SessionTextGeneration(
      environment.settingsOwner,
      () => factories.manager.getActiveProvider(),
      () =>
        captureGenerationState(environment.settingsOwner, this.runtimeState),
      factories.tokenizerFactory,
      factories.contentGeneratorFactory,
      (state) => this.createClient(state),
      this.ownedClients,
      this.fetch,
      this.auxiliary,
    );
    this.conversationBinding = new SessionConversationBinding({
      readClient: () => this.client,
      assertOpen: () => {
        this.getAgentClient();
      },
    });
  }
  get fetch(): NetworkFetch {
    return this.factories.manager.fetchNetwork;
  }
  async prepareTokenizer(provider: string, model: string): Promise<void> {
    await this.factories.tokenizerFactory.prepareTokenizer?.(provider, model);
  }
  async initializeInitialClientBinding(): Promise<void> {
    if (!this.initialBindingComplete) {
      await initializeClientBinding(
        () => this.bindCreatedClient(this.client, this.runtimeState),
        () => this.ownedClients.dispose(this.client),
        () => {
          this.bindings.modelRegistry.dispose();
          return Promise.resolve();
        },
      );
      this.initialBindingComplete = true;
    }
  }
  settleClientReleases(): ReturnType<OwnedClientLedger['settleOwnedClients']> {
    return this.ownedClients.settleOwnedClients();
  }
  disposeSessionExecution(): Promise<void> | undefined {
    return this.execution?.dispose();
  }
  closeProviderLifetime(): Promise<void> {
    return this.providerLife.close();
  }

  private readonly fileBinding = new SessionProviderFileBinding();

  createProviderFileOperations(
    assertAdmission: () => void,
  ): AgentProviderFileOperations {
    return this.fileBinding.operations(
      this.environment.config.getSessionId(),
      assertAdmission,
    );
  }

  bindProviderFiles(
    lifecycle: ProviderFileLifecycle,
    retry: (provider: string) => ProviderRetryOperations,
    cleanup?: (scopeId: string) => Promise<void>,
  ): void {
    this.fileBinding.bind(this.client, lifecycle, retry, cleanup);
  }

  readonly instructions = new SessionInstructionBinding();

  readonly instructionReads = this.instructions.reads;

  get memoryOperations(): Agent['memory'] {
    return this.instructions.memory;
  }

  readonly bindInheritedInstructions = this.instructions.bindInherited.bind(
    this.instructions,
  );

  private execution: SessionExecutionOwner | undefined;

  initializeExecution(
    scheduler: SchedulerConstruction | undefined,
    approval: LoopTypes.ApprovalHandler | undefined,
    display: LoopTypes.DisplayCallbacks | undefined,
  ): SessionExecution {
    this.getAgentClient();
    const binding = this.bindings.readWorkspace();
    if (binding.kind === 'pending')
      throw new AgentBootstrapError(
        'Loop construction requires workspace policy composition',
      );
    if (this.execution !== undefined)
      throw new Error('Session execution is already initialized');
    const execution = new SessionExecutionOwner(
      this.environment.config,
      this.environment.settingsOwner,
      requireSessionPolicy(this.bindings.readPolicy()).messageBus,
      this.bindings.toolCatalog.selection,
      () => this.bindings.toolCatalog.readGovernance(),
      binding.workspace.trust,
      scheduler,
      approval,
      display,
    );
    const captured = execution.initialize(this.client);
    this.execution = execution;
    return captured;
  }

  rebuildExecution(): void {
    this.requireExecution().rebuild(this.getAgentClient());
  }

  resolveExecution(): SessionLoopResolution {
    const execution = this.execution;
    if (execution === undefined) return { error: EXECUTION_NOT_INITIALIZED };
    return toLoopResolution(execution.resolve(this.getAgentClient()));
  }

  isCurrentExecution(execution: SessionExecution | undefined): boolean {
    return this.execution?.isCurrent(execution) ?? false;
  }

  abortExecution(): void {
    this.execution?.abort();
  }

  private requireExecution(): SessionExecutionOwner {
    if (this.execution === undefined)
      throw new Error('Agent loop is not initialized');
    return this.execution;
  }

  async prepareProfileExecution(
    changed: boolean,
    signal: AbortSignal,
    retirePrior: (release: () => Promise<void>) => Promise<void>,
  ): Promise<PreparedProfileFacade> {
    const replacement = changed
      ? await this.work.enqueue(() => this.prepareProfileClient())
      : undefined;
    return this.requireExecution().prepareProfile(
      replacement?.client ?? this.getAgentClient(),
      changed,
      signal,
      replacement?.prepareHistoryCommit,
      replacement?.publish,
      replacement?.retire,
      replacement?.discard,
      retirePrior,
    );
  }

  /**
   * Session-scoped leases for the standalone text generation this facade
   * admits. Text generation runs on clients this owner creates, so nothing
   * else aborts or joins it. The lease only joins; the caller receives each
   * outcome, and the join does not report it again.
   */
  private readonly auxiliary = new AuxiliaryWork();

  private readonly textGeneration: SessionTextGeneration;

  generateText(
    input: AgentInput,
    options: GenerateOptions | undefined,
    recording: AgentChatRecordingExecution,
    admitted?: AdmittedModelParameters,
  ): Promise<string> {
    return this.textGeneration.generate(
      this.getAgentClient(),
      input,
      options,
      recording,
      admitted,
    );
  }

  generateJson(
    contents: readonly AgentMessage[],
    schema: Readonly<Record<string, unknown>>,
    model: string,
    signal: AbortSignal | undefined,
  ): Promise<Record<string, unknown>> {
    // The client owns JSON and embedding work: its own auxiliary admission
    // aborts and joins both, so this facade passes the caller's signal through
    // instead of wrapping the call a second time.
    return this.getAgentClient().generateJson(
      [...contents],
      { ...schema },
      signal ?? new AbortController().signal,
      model,
    );
  }

  generateEmbedding(texts: readonly string[]): Promise<number[][]> {
    return this.getAgentClient().generateEmbedding([...texts]);
  }

  readonly closeAuxiliaryAdmission = this.auxiliary.close.bind(this.auxiliary);

  async joinAuxiliaryShutdown(): Promise<void> {
    // The facade joins before flushing; the lease join reports nothing.
    await Promise.allSettled([this.closeAuxiliaryAdmission()]);
  }

  private runtimeState: AgentRuntimeState;

  readonly providerLife = new ProviderLifetimeOwnership();

  adoptProviderLifetime(close: 'borrowed' | (() => Promise<void>)): void {
    if (close !== 'borrowed') this.providerLife.adopt(close);
  }

  admissionClosed = false;

  readonly work = new SessionClientWorkQueue(() => this.getAgentClient());

  private readonly ownedClients = new OwnedClientLedger(async (scope) => {
    await this.fileBinding.cleanupScope(scope);
  });

  readonly workspaceDirectories = (): readonly string[] =>
    this.environment.workspacePaths.directories();

  readonly streamHistory = (signal?: AbortSignal) => {
    this.getAgentClient();
    return this.client.streamHistory(signal);
  };

  private initialBindingComplete = false;

  get currentClient(): AgentClientContract {
    return this.client;
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
    captureSessionRuntimeState(this.environment.settingsOwner, {
      runtimeId,
      sessionId,
      proxyUrl: this.environment.config.getProxy(),
    });

  private definitions: ClientDefinitionBinding = { kind: 'pending' };

  bindDefinitionReads(
    profiles: Pick<ProfileDefinitionReads, 'loadProfile'>,
    subagents: Pick<SubagentDefinitionReads, 'listSubagents'>,
  ): void {
    this.definitions = { kind: 'bound', profiles, subagents };
    this.client.bindWorkspaceDefinitions(profiles, subagents);
  }

  /**
   * The factory hands over a live client (it holds listeners), so the cleanup
   * obligation exists from this point, before any fallible validation or binding.
   */
  private acquireClient(state: typeof this.runtimeState): AgentClientContract {
    const client = this.factories.factory(
      this.environment.config,
      state,
      () => this.environment.readMcpInstructions(),
      this.environment.mediaStore,
      this.environment.workspacePaths,
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
    assertClientOwnership(
      client,
      this.environment.config,
      this.environment.mediaStore,
    );
    bindClientDefinitions(client, this.definitions);
    client.bindIdeContext(
      () => {
        const binding = this.bindings.readWorkspace();
        return binding.kind === 'bound'
          ? binding.workspace.ide.readContext()
          : undefined;
      },
      () => {
        const binding = this.bindings.readWorkspace();
        return binding.kind === 'bound' && binding.workspace.ide.isEnabled();
      },
    );
    client.bindToolSelection(this.bindings.toolCatalog.selection);
    bindTelemetry(
      client,
      this.environment.config,
      this.environment.settingsOwner,
      this.factories.manager,
    );
    bindClientSettings(
      client,
      this.environment.config,
      this.environment.settingsOwner,
      state.runtimeId,
      state.sessionId,
      this.fetch,
    );
    this.fileBinding.bindClient(client);
    bindClientModels(
      client,
      this.factories.manager,
      this.factories.tokenizerFactory,
    );
  }

  refreshAuth(
    _authMethod?: string,
    options: DeferredHistorySourceOptions = {},
  ): Promise<void> {
    return this.work.enqueue(() => this.replaceClient(options));
  }

  async prepareNewSession(
    sessionId: string,
    onPublish: () => void,
  ): Promise<PreparedRecordingSession> {
    const prepared = await this.work.enqueue(() =>
      prepareNewSessionClient(
        this.captureRuntimeState(`${sessionId}#client`, sessionId),
        this.factories.tokenizerFactory,
        this.factories.contentGeneratorFactory,
        this.environment.settingsOwner,
        this.client,
        this.ownedClients,
        (state) => this.acquireClient(state),
        (client, state) => this.bindCreatedClient(client, state),
        (client, state) => {
          this.runtimeState = state;
          this.client = client;
          this.environment.config.setFallbackMode(false);
          onPublish();
        },
      ),
    );
    return {
      publish: prepared.publish,
      retire: prepared.retire,
      discard: prepared.discard,
      attachRecording: async (integration, origin) => {
        const history = prepared.client.getHistoryService();
        if (history === null)
          throw new Error('New session client has no history service');
        await integration.subscribeToJournal(history, origin);
      },
    };
  }

  private async replaceClient(
    options: DeferredHistorySourceOptions,
  ): Promise<void> {
    const sessionId = this.runtimeState.sessionId;
    const previous = this.client;
    await replaceSessionClient(
      previous,
      this.captureRuntimeState(this.runtimeState.runtimeId, sessionId),
      this.factories.contentGeneratorFactory,
      this.factories.tokenizerFactory,
      this.ownedClients,
      (state) => this.acquireClient(state),
      (client, state) => this.bindCreatedClient(client, state),
      (client, state) => {
        this.client = client;
        this.runtimeState = state;
        this.environment.config.setFallbackMode(false);
      },
      options,
    );
  }

  async prepareProfileActivation(signal: AbortSignal): Promise<{
    prepareHistoryCommit(): Promise<() => void>;
    publish(): void;
    retire(): Promise<void>;
    discard(): Promise<void>;
  }> {
    signal.throwIfAborted();
    const replacement = await this.work.enqueue(() =>
      this.prepareProfileClient(),
    );
    return {
      prepareHistoryCommit: replacement.prepareHistoryCommit,
      publish: replacement.publish,
      retire: replacement.retire,
      discard: replacement.discard,
    };
  }

  private async prepareProfileClient(): Promise<PreparedProfileClient> {
    const previous = this.client;
    const selectedState = this.captureRuntimeState(
      this.runtimeState.runtimeId,
      this.runtimeState.sessionId,
    );
    const prepared = await prepareBoundProfileClient(
      this.environment.config,
      previous,
      selectedState,
      this.factories.tokenizerFactory,
      this.factories.contentGeneratorFactory,
      (state) => this.acquireClient(state),
      (client, state) => this.bindCreatedClient(client, state),
      this.ownedClients,
    );
    const ledger = this.ownedClients;
    return {
      client: prepared.client,
      prepareHistoryCommit: prepared.prepareHistoryCommit,
      publish: () => {
        if (this.client !== previous)
          throw new Error(
            'Profile candidate no longer belongs to the current session client',
          );
        this.client = prepared.client;
        this.runtimeState = prepared.runtimeState;
        this.environment.config.setFallbackMode(false);
      },
      retire: () => this.work.enqueueAccepted(() => ledger.dispose(previous)),
      discard: () => this.work.enqueueAccepted(() => prepared.discard()),
    };
  }

  publishInstructions(instructions: InstructionReadOperations): Promise<void> {
    return publishWorkspaceInstructions(
      this.client,
      instructions,
      () => {
        const binding = this.bindings.readWorkspace();
        return binding.kind === 'bound' && binding.workspace.isStopped();
      },
      (operation) => this.work.enqueueAccepted(operation),
    );
  }

  readonly refreshToolDefinitions = (): Promise<void> =>
    this.work.enqueue(() => this.client.setTools());

  publishTools(): Promise<void> {
    const publish = prepareClientToolPublication(this.getAgentClient());
    return this.work.enqueue(() => publish(this.client));
  }

  closeAdmission(): void {
    this.admissionClosed = true;
    this.execution?.closeAdmission();
    this.providerLife.closeAdmission();
  }
  readonly openClientToolChannel = (
    ...args: Parameters<SessionExecutionOwner['openClientToolChannel']>
  ) => this.requireExecution().openClientToolChannel(...args);
}
