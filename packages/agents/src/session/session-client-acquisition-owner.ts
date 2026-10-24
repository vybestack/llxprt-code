/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
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
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { randomUUID } from 'node:crypto';
import type {
  Agent,
  AgentInput,
  AgentMessage,
  GenerateOptions,
} from '../api/agent.js';
import { AgentBootstrapError, bindTelemetry } from '../api/agentBootstrap.js';
import type { McpRuntimeOwner } from '../api/mcpRuntimeAssembly.js';
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
  bindClientTokenization,
  captureGenerationState,
  captureSessionRuntimeState,
  requireSessionPolicy,
  type SessionClientFactory,
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

export abstract class SessionClientAcquisitionOwner extends SessionConversationBinding {
  protected abstract readonly config: Config;
  protected abstract readonly manager: RuntimeProviderManager;
  protected abstract readonly factory: SessionClientFactory;
  protected abstract readonly mediaStore: LocalMediaStore;
  protected abstract readMcpInstructions: () => string | undefined;
  protected abstract readonly workspacePaths: WorkspacePathOperations;
  protected abstract readonly settingsOwner: SessionSettingsOwner;
  abstract readonly contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>;
  abstract readonly tokenizerFactory: RuntimeTokenizerFactory;
  protected abstract readonly borrowedClient?: AgentClientContract;
  abstract readonly toolCatalog: SessionToolCatalogOwner;
  abstract readonly modelRegistry: ModelRegistry;
  protected get fetch(): OwnedFetch['fetch'] {
    return this.network.fetch;
  }
  protected initializeClientNetwork(): void {
    this.network = new OwnedFetch(this.config.getProxy());
    this.textGeneration = new SessionTextGeneration(
      this.settingsOwner,
      () => this.manager.getActiveProvider(),
      () => captureGenerationState(this.settingsOwner, this.runtimeState),
      this.tokenizerFactory,
      this.contentGeneratorFactory,
      (state) => this.createClient(state),
      this.ownedClients,
      this.network.fetch,
      this.auxiliary,
    );
  }
  protected initializeClientRuntime(): void {
    this.runtimeState = this.captureRuntimeState(
      this.config.getSessionId() || `runtime-${randomUUID()}`,
      this.config.getSessionId(),
    );
    this.client = this.borrowedClient ?? this.acquireClient(this.runtimeState);
    if (this.borrowedClient !== undefined) {
      bindClientTokenization(this.borrowedClient, this.tokenizerFactory);
      this.initialBindingComplete = true;
    }
  }
  protected async initializeInitialClientBinding(): Promise<void> {
    if (!this.initialBindingComplete) {
      await initializeClientBinding(
        () => this.bindCreatedClient(this.client, this.runtimeState),
        () => this.ownedClients.dispose(this.client),
        () => {
          this.modelRegistry.dispose();
          return this.network.dispose();
        },
      );
      this.initialBindingComplete = true;
    }
  }
  protected settleClientReleases(): ReturnType<
    OwnedClientLedger['settleOwnedClients']
  > {
    return this.ownedClients.settleOwnedClients();
  }
  protected disposeClientNetwork(): ReturnType<OwnedFetch['dispose']> {
    return this.network.dispose();
  }
  protected disposeSessionExecution(): Promise<void> | undefined {
    return this.execution?.dispose();
  }
  protected closeProviderLifetime(): Promise<void> {
    return this.providerLife.close();
  }

  private readonly fileBinding = new SessionProviderFileBinding();

  createProviderFileOperations(
    assertAdmission: () => void,
  ): AgentProviderFileOperations {
    return this.fileBinding.operations(
      this.config.getSessionId(),
      assertAdmission,
    );
  }

  bindProviderFiles(
    lifecycle: object,
    retry: (provider: string) => ProviderRetryOperations,
    cleanup?: (scopeId: string) => Promise<void>,
  ): void {
    this.fileBinding.bind(this.client, lifecycle, retry, cleanup);
  }

  protected readonly instructions = new SessionInstructionBinding();

  readonly instructionReads = this.instructions.reads;

  get memoryOperations(): Agent['memory'] {
    return this.instructions.memory;
  }

  readonly bindInheritedInstructions = this.instructions.bindInherited.bind(
    this.instructions,
  );

  protected boundWorkspace: McpRuntimeOwner | undefined;

  protected sessionPolicy: SessionPolicyOwner | undefined;

  private execution: SessionExecutionOwner | undefined;

  initializeExecution(
    scheduler: SchedulerConstruction | undefined,
    approval: LoopTypes.ApprovalHandler | undefined,
    display: LoopTypes.DisplayCallbacks | undefined,
  ): SessionExecution {
    this.getAgentClient();
    const workspace = this.boundWorkspace;
    if (workspace === undefined)
      throw new AgentBootstrapError(
        'Loop construction requires workspace policy composition',
      );
    if (this.execution !== undefined)
      throw new Error('Session execution is already initialized');
    const execution = new SessionExecutionOwner(
      this.config,
      this.settingsOwner,
      requireSessionPolicy(this.sessionPolicy).messageBus,
      this.toolCatalog.selection,
      () => this.toolCatalog.readGovernance(),
      workspace.trust,
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

  private readonly auxiliary = new AuxiliaryWork();

  private textGeneration!: SessionTextGeneration;

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
    const client = this.getAgentClient();
    const input = [...contents];
    return this.auxiliary.run(
      (acceptedSignal) =>
        client.generateJson(input, { ...schema }, acceptedSignal, model),
      signal,
    );
  }

  generateEmbedding(texts: readonly string[]): Promise<number[][]> {
    const client = this.getAgentClient();
    return this.auxiliary.run((signal) =>
      client.generateEmbedding([...texts], signal),
    );
  }

  readonly closeAuxiliaryAdmission = this.auxiliary.close.bind(this.auxiliary);

  async joinAuxiliaryShutdown(): Promise<void> {
    // The facade joins before flushing; this owner reports the result in dispose.
    await Promise.allSettled([this.closeAuxiliaryAdmission()]);
  }

  private runtimeState!: AgentRuntimeState;

  protected readonly providerLife = new ProviderLifetimeOwnership();

  adoptProviderLifetime(close: 'borrowed' | (() => Promise<void>)): void {
    if (close !== 'borrowed') this.providerLife.adopt(close);
  }

  protected admissionClosed = false;

  protected readonly work = new SessionClientWorkQueue(() =>
    this.getAgentClient(),
  );

  private readonly ownedClients = new OwnedClientLedger(async (scope) => {
    await this.fileBinding.cleanupScope(scope);
  });

  readonly workspaceDirectories = (): readonly string[] =>
    this.workspacePaths.directories();

  readonly readHistory = (): Promise<readonly AgentMessage[]> =>
    this.work.enqueue(() => this.client.getHistory());

  private network!: OwnedFetch;

  private initialBindingComplete = false;

  protected assertConversationOpen(): void {
    this.getAgentClient();
  }

  private getAgentClient(): AgentClientContract {
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
    assertClientOwnership(client, this.config, this.mediaStore);
    bindClientDefinitions(
      client,
      this.profileDefinitions,
      this.subagentDefinitions,
    );
    client.bindIdeContext?.(
      () => this.boundWorkspace?.ide.readContext(),
      () => this.boundWorkspace?.ide.isEnabled() ?? false,
    );
    client.bindToolSelection(this.toolCatalog.selection);
    bindTelemetry(client, this.config, this.settingsOwner, this.manager);
    bindClientSettings(
      client,
      this.config,
      this.settingsOwner,
      state.runtimeId,
      state.sessionId,
      this.network.fetch,
    );
    this.fileBinding.bindClient(client);
    bindClientModels(client, this.manager, this.tokenizerFactory);
  }

  refreshAuth(_authMethod?: string): Promise<void> {
    return this.work.enqueue(() => this.replaceClient());
  }

  async prepareNewSession(
    sessionId: string,
    onPublish: () => void,
  ): Promise<PreparedRecordingSession> {
    const prepared = await this.work.enqueue(() =>
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
    return {
      publish: prepared.publish,
      retire: prepared.retire,
      discard: prepared.discard,
      attachRecording: (integration, origin) => {
        const history = prepared.client.getHistoryService();
        if (history === null)
          throw new Error('New session client has no history service');
        integration.subscribeToHistory(history, origin);
      },
    };
  }

  private async replaceClient(): Promise<void> {
    const sessionId = this.runtimeState.sessionId;
    const previous = this.client;
    const canReuseBorrowed = previous === this.borrowedClient;
    if (
      canReuseBorrowed &&
      this.runtimeState.model === this.settingsOwner.readSelectedModel() &&
      this.runtimeState.provider === this.settingsOwner.readSelectedProvider()
    ) {
      await previous.setTools();
      return;
    }
    await replaceSessionClient(
      previous,
      this.captureRuntimeState(this.runtimeState.runtimeId, sessionId),
      this.contentGeneratorFactory,
      this.tokenizerFactory,
      this.ownedClients,
      (state) => this.acquireClient(state),
      (client, state) => this.bindCreatedClient(client, state),
      (client, state) => {
        this.client = client;
        this.runtimeState = state;
        this.config.setFallbackMode(false);
      },
      this.borrowedClient,
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
      this.config,
      previous,
      selectedState,
      this.tokenizerFactory,
      this.contentGeneratorFactory,
      (state) => this.acquireClient(state),
      (client, state) => this.bindCreatedClient(client, state),
      this.ownedClients,
    );
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

  protected publishInstructions(
    instructions: InstructionReadOperations,
  ): Promise<void> {
    return publishWorkspaceInstructions(
      this.client,
      instructions,
      () => this.boundWorkspace?.isStopped() === true,
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
