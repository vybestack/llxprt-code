import {
  MessageBusType,
  type BucketAuthConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ModelRegistry } from '@vybestack/llxprt-code-core/models/registry.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { InteractiveAuthPromptOperation } from '@vybestack/llxprt-code-core/runtime/contracts/InteractiveAuthPrompt.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type {
  AgentToolKeyControl,
  BucketAuthConsentRequest,
  Unsubscribe,
} from '../api/agent.js';
import {
  buildAgentClientFactory,
  type StableDisplayCallbacksHolder,
} from '../api/agentBootstrap.js';
import { ChildAgentAssembly } from '../api/child-agent-assembly.js';
import type { EditorCallbacks } from '../api/config-types.js';
import { createAgentHookControl } from '../api/control/hooks.js';
import { SessionControl } from '../api/control/sessionControl.js';
import { ToolControl } from '../api/control/toolControl.js';
import { SubAgentScope } from '../core/subagent.js';
import { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import type { ChildToolDisplay } from './childToolDisplay.js';
import { recordToolCompletions } from './record-tool-completions.js';
import { SessionClientAcquisitionOwner } from './session-client-acquisition-owner.js';

import {
  requireSessionPolicy,
  type SessionClientFactory,
} from './session-client-binding.js';
import { finishCleanup } from './session-client-cleanup.js';
import { SessionImageAdmission } from './session-image-admission.js';

import { acceptSkillPublication } from './session-skill-publication.js';
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
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { ImageOperationRunner } from '@vybestack/llxprt-code-core/services/image/imageCapability.js';
import type { HostGitHubBrokerOwner } from '../api/host-github-broker-owner.js';

import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { RegistryPolicy } from '@vybestack/llxprt-code-tools';

import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { createTaskRegistration } from '../api/runtimeFactories.js';
import { SessionToolCatalogOwner } from './session-tool-catalog-owner.js';

import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

import { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { Agent } from '../api/agent.js';
import type {
  ChildTaskInheritancePort,
  SessionMcpBindingPort,
  SessionPolicyCompositionPort,
} from '../api/mcpRuntimePorts.js';
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import { SessionMcpApproval } from './session-mcp-approval.js';
import { bindToolOutputSummary } from './session-tool-catalog-owner.js';

import { SessionHookComposition } from './session-hook-composition.js';

/**
 * Everything a child task launch reads: the workspace bound to this session,
 * the policy owner that supplies its bus, and the definition readers the child
 * inherits.
 */
interface ChildTaskComposition {
  readonly workspace: ChildTaskInheritancePort & SessionPolicyCompositionPort;
  readonly policy: SessionPolicyOwner;
  readonly profiles: ProfileDefinitionReads;
  readonly subagents: SubagentDefinitionReads;
}

export class SessionClientOwner extends SessionClientAcquisitionOwner {
  readonly subscribeBucketConsent = (
    listener: (request: BucketAuthConsentRequest) => void,
  ): Unsubscribe =>
    this.messageBus.subscribe<BucketAuthConfirmationRequest>(
      MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
      (request) =>
        listener(
          Object.freeze({
            correlationId: request.correlationId,
            provider: request.provider,
            bucket: request.bucket,
            bucketIndex: request.bucketIndex,
            totalBuckets: request.totalBuckets,
          }),
        ),
    );
  readonly respondToBucketConsent = (
    correlationId: string,
    confirmed: boolean,
  ): void => {
    this.messageBus.respondToBucketAuthConfirmation(correlationId, confirmed);
  };

  createToolControl(
    assertSessionAdmission: (() => void) | undefined,
    childDisplay: ChildToolDisplay | undefined,
    editorCallbacksHolder: {
      editorCallbacks: EditorCallbacks;
    },
    displayCallbacksHolder: StableDisplayCallbacksHolder,
    keys: AgentToolKeyControl,
  ): ToolControl {
    return new ToolControl(
      (...args) => this.openClientToolChannel(...args),
      assertSessionAdmission,
      childDisplay,
      (...args) => this.messageBus.respondToConfirmation(...args),
      () => this.toolCatalog.listToolInfos(),
      (name) => this.toolCatalog.getToolHandle(name),
      (names) => this.settingsOwner.setAllowedTools(names),
      () => this.toolCatalog.describeConfiguration(),
      editorCallbacksHolder,
      displayCallbacksHolder,
      (calls) => this.recordCompletedToolCalls(calls),
      keys,
    );
  }

  createSessionControl(
    identityOwnership: 'config' | 'facade',
    sessionId: () => string,
    transition: ConstructorParameters<typeof SessionControl>[7],
    closeAdmission: () => void,
    rebuild: () => void,
    readProvider: () => string,
    readModel: () => string,
  ): SessionControl {
    return new SessionControl(
      {
        storageRoot: this.config.storageRoot,
        projectTempDir: this.config.projectTempDir,
        projectChatsDir: this.config.projectChatsDir,
        projectRoot: this.config.getProjectRoot(),
        persistenceQueueBytes:
          this.config.getSessionPersistenceQueueByteLimit(),
      },
      this.mediaStore,
      () =>
        this.settingsOwner.readRecordingQueueLimit(
          this.config.getSessionRecordingQueueByteLimit(),
        ),
      this.workspaceDirectories,
      identityOwnership,
      sessionId,
      this.nativeHistory,
      transition,
      closeAdmission,
      (id) => this.prepareNewSession(id, rebuild),
      readProvider,
      readModel,
      () => this.config.getSessionId(),
      (id) => this.config.adoptSessionId(id),
    );
  }
  createHookControl(session: SessionControl) {
    return createAgentHookControl(
      this.hookOperations,
      (listener) =>
        this.messageBus.subscribe(
          MessageBusType.HOOK_EXECUTION_REQUEST,
          listener,
        ),
      (listener) =>
        this.messageBus.subscribe(
          MessageBusType.HOOK_EXECUTION_RESPONSE,
          listener,
        ),
      () => session.getSessionId(),
      () => this.config.getTargetDir(),
      () => session.getRecording().path ?? undefined,
    );
  }

  private readonly hookComposition: SessionHookComposition;
  readonly hasHookComposition = () => this.hookComposition.isComposed();
  get hookOperations() {
    return this.hookComposition.operations;
  }
  readonly bindHooks = (...args: Parameters<SessionHookComposition['bind']>) =>
    this.hookComposition.bind(...args);
  readonly closeHookAdmission = () => this.hookComposition.closeAdmission();
  readonly disposeHooks = () => this.hookComposition.disposeClientOwned();
  readonly transferHookRelease = () => this.hookComposition.transferRelease();
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
  private ownsSessionPolicy = false;
  private readonly policyWrites = new SessionMcpApproval();
  private get messageBus() {
    return requireSessionPolicy(this.sessionPolicy).messageBus;
  }
  addSessionPolicyRule(
    rule: Parameters<SessionPolicyOwner['confirmation']['addRule']>[0],
  ): void {
    this.assertConversationOpen();
    requireSessionPolicy(this.sessionPolicy).confirmation.addRule(rule);
  }
  get policyInspection() {
    return requireSessionPolicy(this.sessionPolicy).inspection;
  }
  private readonly mcpBindingToken = Symbol('MCP session client');
  private readonly images = new SessionImageAdmission();

  readonly hasImageComposition = this.images.isComposed.bind(this.images);

  bindImageOperation(
    runner: ImageOperationRunner,
    cleanup?: () => Promise<void>,
  ): void {
    this.images.compose(runner, cleanup);
    this.toolCatalog.bindImageOperation((input) => this.images.run(input));
  }

  readonly runImageOperation: ImageOperationRunner = async (input) => {
    this.assertConversationOpen();
    return this.images.run(input);
  };

  readonly closeImageAdmission = this.images.close.bind(this.images);

  readonly operations: Agent['sessionClient'] = {
    fetch: (input, init) => this.fetch(input, init),
    refreshAuth: (method) => this.refreshAuth(method),
    publishTools: () => this.publishTools(),
    runImageOperation: (input) => this.runImageOperation(input),
  };
  private closing: Promise<void> | undefined;
  private releaseMcpBinding: (() => void) | undefined;
  readonly modelRegistry: ModelRegistry;

  private constructor(
    protected readonly config: Config,
    protected readonly readTaskSchemaPolicy: () => RegistryPolicy,
    protected readonly manager: RuntimeProviderManager,
    protected readonly factory: SessionClientFactory,
    protected readonly mediaStore: LocalMediaStore,
    protected readMcpInstructions: () => string | undefined,
    protected readonly workspacePaths: WorkspacePathOperations,
    protected readonly settingsOwner: SessionSettingsOwner,
    readonly contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
    readonly tokenizerFactory: RuntimeTokenizerFactory,
    private readonly authority: CredentialAuthority,
    protected readonly borrowedBus?: MessageBus,
  ) {
    super();
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
    this.initializeTextGeneration();
    this.modelRegistry = new ModelRegistry(this.fetch);
    manager.bindModelRegistry?.(this.modelRegistry);
    this.toolCatalog = new SessionToolCatalogOwner(
      config,
      this.readTaskSchemaPolicy,
      () => this.settingsOwner.readToolExecutionPolicy(),
      this.fetch,
    );
    this.initializeClientRuntime();
  }

  /**
   * Acquires and binds the initial client. Binding is fallible and a failed
   * binding must dispose the acquired client before construction rejects, so
   * construction is awaitable rather than done in the synchronous constructor.
   * A disposal failure is joined to the binding error, never substituted.
   */
  static async create(
    config: Config,
    readTaskSchemaPolicy: () => RegistryPolicy,
    manager: RuntimeProviderManager,
    factory: SessionClientFactory,
    mediaStore: LocalMediaStore,
    readMcpInstructions: () => string | undefined,
    workspacePaths: WorkspacePathOperations,
    settingsOwner: SessionSettingsOwner,
    contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
    tokenizerFactory: RuntimeTokenizerFactory,
    authority: CredentialAuthority,
    borrowedBus?: MessageBus,
  ): Promise<SessionClientOwner> {
    const owner = new SessionClientOwner(
      config,
      readTaskSchemaPolicy,
      manager,
      factory,
      mediaStore,
      readMcpInstructions,
      workspacePaths,
      settingsOwner,
      contentGeneratorFactory,
      tokenizerFactory,
      authority,
      borrowedBus,
    );
    await owner.initializeInitialClientBinding();
    return owner;
  }
  private requestInteractiveAuth: InteractiveAuthPromptOperation | undefined;
  bindInteractiveAuthRequests(operation: InteractiveAuthPromptOperation): void {
    this.requestInteractiveAuth = operation;
  }

  bindWorkspaceInstructions(workspace: WorkspaceMemoryOwner): void {
    this.instructions.bindWorkspace(workspace, this.config, (instructions) =>
      this.publishInstructions(instructions),
    );
  }

  bindMcpRuntime(
    workspace: SessionMcpBindingPort,
    profiles: ProfileDefinitionReads = workspace.profileDefinitions,
    subagents: SubagentDefinitionReads = workspace.subagentDefinitions,
  ): void {
    if (this.boundWorkspace === workspace) return;
    if (this.boundWorkspace !== undefined)
      throw new Error('Session already has workspace policy composition');
    this.boundWorkspace = workspace;
    this.client.bindIdeContext?.(
      () => workspace.ide.readContext(),
      () => workspace.ide.isEnabled(),
    );
    this.bindDefinitionReads(profiles, subagents);
    this.bindWorkspaceInstructions(workspace.workspaceMemory);
    const sessionApproval = this.bindSessionApproval(workspace);
    const policy = requireSessionPolicy(this.sessionPolicy);
    this.prepareTools = () =>
      this.toolCatalog.initialize(
        {
          isWorkspaceStopped: () => workspace.isStopped(),
          paths: workspace.workspacePaths,
          files: workspace.workspaceFiles,
          ignore: workspace.workspaceIgnore,
          scans: workspace.workspaceScans,
          diagnostics: workspace.workspaceLsp.diagnostics,
          ide: workspace.ide,
          trust: workspace.trust,
          workspaceSelection: workspace.toolSelection,
          profiles,
          subagents,
        },
        {
          bus: policy.messageBus,
          registration: this.bindTaskRegistration({
            workspace,
            policy,
            profiles,
            subagents,
          }),
          summarize: bindToolOutputSummary(
            () => {
              this.assertConversationOpen();
              return this.client;
            },
            () => this.config.getUtilityModel(),
          ),
          approval: sessionApproval,
          telemetry: this.settingsOwner.telemetry,
        },
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

  private bindTaskRegistration(
    composition: ChildTaskComposition,
  ): TaskToolRegistration {
    const { workspace, policy, profiles, subagents } = composition;
    const bus = policy.messageBus;
    const orchestrator = new SubagentOrchestrator({
      readSessionId: () => this.config.getSessionId(),
      profileManager: profiles,
      subagentManager: subagents,
      readRunPolicy: () => this.settingsOwner.readSubagentRunPolicy(),
      assembleChild: (data) => {
        if (this.admissionClosed)
          throw new Error('Session client admission is closed');
        return new ChildAgentAssembly(
          data,
          {
            authority: this.authority,
            createChildSettings: () => this.settingsOwner.createChildStore(),
            foregroundConfig: this.config,
          },
          {
            runtimeLoader: loadAgentRuntime,
            scopeFactory: SubAgentScope.create.bind(SubAgentScope),
          },
          buildAgentClientFactory(),
          {
            messageBus: bus,
            requestInteractiveAuth: this.requestInteractiveAuth,
            profileReads: profiles,
            subagentReads: subagents,
            telemetry: this.settingsOwner.telemetry,
            instructions: this.instructionReads,
            workspacePaths: workspace.workspacePaths,
            readMcpInstructions: workspace.readInstructions,
            trust: workspace.trust,
            tools: this.toolCatalog.acquireChildTools(),
            hooks: this.hookOperations,
          },
        ).assemble();
      },
    });
    return createTaskRegistration(this.config, {
      launchChild: orchestrator.launch.bind(orchestrator),
      messageBus: bus,
      readTaskPolicy: () => this.settingsOwner.readTaskPolicy(),
      readGovernance: () => this.toolCatalog.readGovernance(),
      toolRegistry: this.toolCatalog.selection,
    });
  }

  private bindSessionApproval(workspace: SessionPolicyCompositionPort) {
    const policy =
      this.borrowedBus === undefined
        ? new SessionPolicyOwner(workspace.policyOwner.workspace, this.config)
        : workspace.policyOwner.session;
    this.ownsSessionPolicy = this.borrowedBus === undefined;
    this.sessionPolicy = policy;
    return this.policyWrites.bind(
      policy,
      (...args) => workspace.policyOwner.session.decisions.evaluate(...args),
      () => {
        this.assertConversationOpen();
      },
    );
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
    this.assertConversationOpen();
    if (this.releaseMcpBinding !== undefined)
      throw new Error('Session client already has an MCP binding');
    this.readMcpInstructions = read;
    this.releaseMcpBinding = release;
  }

  recordCompletedToolCalls(completed: readonly CompletedToolCall[]): void {
    this.assertConversationOpen();
    recordToolCompletions(this.client, () => this.config.getModel(), completed);
  }

  async initializeTools(): Promise<void> {
    if (this.prepareTools === undefined)
      throw new Error('Session tools require their workspace composition');
    await this.prepareTools();
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    const executionClosing = this.disposeSessionExecution();
    void executionClosing?.catch(() => undefined);
    this.closeHookAdmission();
    this.githubOwner?.closeAdmission();
    const imagesClosing = this.closeImageAdmission();
    void imagesClosing.catch(() => undefined);
    const toolsClosing = this.toolCatalog.closeAdmission();
    void toolsClosing.catch(() => undefined);
    const auxiliaryClosing = this.closeAuxiliaryAdmission();
    if (this.closing !== undefined) return this.closing;
    const bindingClosing = Promise.resolve().then(() =>
      this.releaseMcpBinding?.(),
    );
    this.closing = Promise.allSettled([
      bindingClosing,
      auxiliaryClosing,
      executionClosing,
    ]).then(async (binding) => {
      const hooks = await Promise.allSettled([this.disposeHooks()]);
      await this.work.join();
      const instructions = await Promise.allSettled([
        this.instructions.dispose(),
      ]);
      const services = await Promise.allSettled([
        this.toolCatalog.dispose(),
        this.githubOwner?.dispose(),
        imagesClosing,
      ]);
      const clients = await this.settleClientReleases();
      this.modelRegistry.dispose();
      const writes = await this.policyWrites.settleWrites();
      const policy = await Promise.allSettled([
        this.ownsSessionPolicy ? this.sessionPolicy?.dispose() : undefined,
      ]);
      finishCleanup(
        await Promise.allSettled([this.closeProviderLifetime()]),
        hooks,
        instructions,
        services,
        binding,
        clients,
        writes,
        policy,
      );
    });
    return this.closing;
  }
}
