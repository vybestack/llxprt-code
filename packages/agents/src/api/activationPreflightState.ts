/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Config,
  openBrowserSecurely,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';

import { type RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
  McpClientManager,
} from '@vybestack/llxprt-code-mcp';
import { defaultFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';

import { type CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { type SettingsService } from '@vybestack/llxprt-code-settings';

import { runCleanupSteps } from '../core/subagent-cleanup.js';
import { type SessionClientOwner } from '../session/session-client-owner.js';
import {
  type ActivationPreflight,
  type ActivationPreflightToken,
  type AgentActivationOperation,
  type AgentActivationPreflightResult,
} from './activation-types.js';
import { AdoptedAgentAssembly } from './adopted-agent-assembly.js';
import { type Agent } from './agent.js';
import { AgentBootstrapError } from './agentBootstrap.js';
import {
  type AgentAdoptionIntent,
  type AgentForegroundHost,
  type ProviderActivationIntent,
} from './config-types.js';
import { retireActivationOwners } from './activationOwnerRetirement.js';
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';

import { assembleHostGitHubBroker } from './host-github-broker-owner.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { type PreparedProfileFacade } from './profileApplicationAssembly.js';
import { canonicalProviderActivationIntent } from './provider-activation-intent.js';
import { type ProviderActivationResult } from './providerActivationExecutor.js';

import { DEFAULT_SKILL_OPERATIONS } from './workspace-skill-assembly.js';
export type {
  ActivationPreflight,
  ActivationPreflightToken,
  AgentActivationOperation,
  AgentActivationPreflightResult,
} from './activation-types.js';
export { canonicalProviderActivationIntent } from './provider-activation-intent.js';

export class AgentActivationBootstrap
  extends AdoptedAgentAssembly
  implements AgentActivationOperation
{
  #manager: RuntimeProviderManager | undefined;
  #execute!: (
    intent: ProviderActivationIntent,
  ) => Promise<ProviderActivationResult>;
  #attempt = 0;
  #disposed = false;
  #closing: Promise<void> | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #publicClosed = false;
  readonly #publicWork = new Set<Promise<unknown>>();
  #receipt:
    | {
        token: ActivationPreflightToken;
        fingerprint: string;
        result: ProviderActivationResult;
      }
    | undefined;

  sessionClient!: AgentActivationOperation['sessionClient'];
  protected constructor(config?: Config) {
    super(config);
  }
  protected initializePreparedActivation(): void {
    this.ownsMemory = this.workspaceMemoryOwnership === 'transferred';
    this.sessionClient = {
      workspaceDirectories: () => this.workspaceFilesystem.paths.directories(),
      refreshAuth: (method) =>
        this.#admitPublic(() => this.ownedSessionClient.refreshAuth(method)),
      runImageOperation: (input) =>
        this.#admitPublic(() =>
          this.ownedSessionClient.runImageOperation(input),
        ),
    };
    this.#manager = this.activationManager;
    this.#execute = (intent) => this.executeActivation(intent);
  }

  listProfiles() {
    return this.workspaceDefinitions.profileReads.listProfiles();
  }
  loadProfile(name: string) {
    return this.workspaceDefinitions.profileReads.loadProfile(name);
  }
  readHistory(): ReturnType<SessionClientOwner['readHistory']> {
    return this.#admitPublic(() => this.ownedSessionClient.readHistory());
  }
  #foregroundAgent: Agent | undefined;
  #foregroundPending: Promise<Agent> | undefined;
  #publicClosing: Promise<void> | undefined;
  #foregroundHost!: AgentForegroundHost;
  protected foregroundPolicy: RuntimePolicyOwner | undefined;

  protected foregroundRuntimeContext!: Parameters<
    RuntimeProviderManager['setRuntimeContext']
  >[0];

  closeForegroundAdmission(): void {
    this.closeConstructionAdmission();
  }

  async disposeForeground(): Promise<void> {
    await this.#foregroundAgent?.dispose();
  }

  createForeground(
    token: ActivationPreflightToken,
    intent: ProviderActivationIntent,
    host: AgentForegroundHost,
  ): Promise<Agent> {
    this.#assertPublicOpen();
    this.assertConstructionOpen();
    AgentActivationBootstrap.#validate(
      { operation: this, token },
      this.config,
      intent,
      this.foregroundManager,
      this.foregroundSettings,
    );
    if (this.oauthManager !== this.foregroundOAuth)
      throw new AgentBootstrapError(
        'Foreground OAuth differs from the acquired owner',
      );
    this.foregroundManager.setRuntimeContext(
      this.foregroundRuntimeContext,
      this.settingsOwner,
      this.foregroundSettings,
      this.config,
    );
    this.#foregroundHost = host;
    this.#publicClosed = true;
    this.#foregroundPending = this.#completeForeground(token, intent);
    return this.#foregroundPending;
  }

  async #joinPublicWork(): Promise<void> {
    await Promise.allSettled([this.#tail, ...this.#publicWork]);
  }

  async #completeForeground(
    token: ActivationPreflightToken,
    intent: ProviderActivationIntent,
  ): Promise<Agent> {
    let broker: ReturnType<typeof assembleHostGitHubBroker>;
    try {
      await this.#joinPublicWork();
      this.assertConstructionOpen();
      AgentActivationBootstrap.#consume(
        { operation: this, token },
        this.config,
        intent,
        this.foregroundManager,
        this.foregroundSettings,
      );
      broker = assembleHostGitHubBroker(this.#foregroundHost);
      await this.#constructForegroundMcp();
      if (this.foregroundMcp === undefined)
        throw new Error('Foreground MCP is not acquired');
      this.ownsFilesystem = false;
      this.ownsDefinitions = false;
      this.ownsMemory = false;
      this.assertConstructionOpen();
      const client = this.ownedSessionClient;
      client.bindHostGitHub(broker);
      client.bindMcpRuntime(
        this.foregroundMcp,
        undefined,
        this.foregroundMcp.profileDefinitions,
        this.foregroundMcp.subagentDefinitions,
      );
      if (!client.hasHookComposition()) client.bindHooks();
      await this.foregroundMcp.initialize();
      await client.initializeTools();
      this.assertConstructionOpen();
      const agent = await this.finishForeground();
      this.#foregroundAgent = agent;
      this.ownsSessionClient = false;
      this.ownsSettings = false;
      this.mediaOwner = undefined;
      this.assertConstructionOpen();
      await this.#disposeAcquisition();
      this.#foregroundHost.onSkills?.(
        this.foregroundMcp.workspaceSkills.operations,
      );
      this.#foregroundHost.onExtensionRestart?.(
        this.foregroundMcp.extensionOperations.restart.bind(
          this.foregroundMcp.extensionOperations,
        ),
      );
      return agent;
    } catch (primary) {
      const agent = this.#foregroundAgent;
      if (agent !== undefined) {
        try {
          await agent.dispose();
        } catch (cleanup) {
          throw new AggregateError(
            [primary, cleanup],
            'Foreground publication and cleanup failed',
          );
        }
        throw primary;
      }
      return cleanupFailedAdoption(
        primary,
        () =>
          runCleanupSteps([
            () => this.#disposeAcquisition(),
            () => this.releaseForegroundProviders(),
            () => broker?.cleanupFailedConstruction(),
            () => this.config.dispose(),
          ]),
        this.foregroundMcp?.dispose.bind(this.foregroundMcp),
        undefined,
        undefined,
      );
    }
  }

  async #constructForegroundMcp(): Promise<void> {
    const transport = this.#foregroundHost.mcpHost;
    const feedback = transport?.emitFeedback ?? defaultFeedbackSink;
    const policyOwner = this.foregroundPolicy;
    if (policyOwner === undefined)
      throw new Error(
        'Foreground MCP construction requires the preflight policy owner',
      );
    const mcp = await McpRuntimeOwner.create(
      {
        oauth: {
          getAuthProviderFactory: transport?.getAuthProviderFactory,
          tokenStorage: new MCPOAuthTokenStorage(
            new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
          ),
          openBrowser: transport?.openBrowser ?? openBrowserSecurely,
        },
        config: this.config,
        managerFactory: McpClientManager,
        extensionLoader: undefined,
        policy: { owner: policyOwner, ownership: 'caller' },
        lspOwner: undefined,
        lspOwnership: 'runtime',
        filesystemOwner: this.workspaceFilesystem,
        filesystemOwnership: 'runtime',
        filesystemService: undefined,
        memoryOwner: {
          owner: this.workspaceMemory,
          ownership:
            this.workspaceMemoryOwnership === 'transferred'
              ? 'runtime'
              : 'caller',
        },
        definitionOwner: this.workspaceDefinitions,
        definitionOwnership: 'runtime',
        trustPort: this.workspaceTrust,
        trustCleanup: this.trustCleanup,
        idePort: undefined,
      },
      {
        emitFeedback: feedback,
        skillOperations: {
          reloadPolicy:
            this.#foregroundHost.skillPolicy ??
            DEFAULT_SKILL_OPERATIONS.reloadPolicy,
          registerTools:
            this.#foregroundHost.registerSkillTools ??
            DEFAULT_SKILL_OPERATIONS.registerTools,
        },
        mcpSettings: this.settingsOwner.readMcpSettingsBinding(),
      },
    );
    this.foregroundMcp = mcp;
  }

  prepareProfileActivation(
    signal: AbortSignal,
  ): Promise<PreparedProfileFacade> {
    return this.#admitPublic(async () => {
      signal.throwIfAborted();
      const replacement =
        await this.ownedSessionClient.prepareProfileActivation(signal);
      try {
        signal.throwIfAborted();
        const commitHistory = await replacement.prepareHistoryCommit();
        signal.throwIfAborted();
        return {
          publish: () => {
            commitHistory();
            replacement.publish();
          },
          retire: replacement.retire,
          discard: replacement.discard,
        };
      } catch (error) {
        try {
          await replacement.discard();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Profile preparation failed and candidate cleanup was incomplete',
          );
        }
        throw error;
      }
    });
  }

  preflight(
    intent: ProviderActivationIntent,
  ): Promise<AgentActivationPreflightResult> {
    if (this.#publicClosed)
      return Promise.resolve({
        authFailed: true,
        infoMessages: [],
        authError: new AgentBootstrapError('Activation bootstrap is disposed'),
      });
    const attempt = ++this.#attempt;
    this.#receipt = undefined;
    const captured = structuredClone(intent);
    const fingerprint = canonicalProviderActivationIntent(captured);
    const pending = this.#tail.then(
      async (): Promise<AgentActivationPreflightResult> => {
        if (this.#disposed)
          return {
            authFailed: true,
            infoMessages: [],
            authError: new AgentBootstrapError(
              'Activation bootstrap is disposed',
            ),
          };
        let result: ProviderActivationResult;
        try {
          result = await this.#execute(captured);
        } catch (authError) {
          result = { authFailed: true, infoMessages: [], authError };
        }
        if (result.authFailed || !this.#isCurrent(attempt)) return result;
        const token = Object.freeze({});
        this.#receipt = { token, fingerprint, result };
        return { ...result, token };
      },
    );
    this.#tail = pending;
    return pending;
  }

  #isCurrent(attempt: number): boolean {
    return !this.#disposed && attempt === this.#attempt;
  }

  #assertPublicOpen(): void {
    if (this.#publicClosed)
      throw new AgentBootstrapError('Activation bootstrap is disposed');
  }

  async #admitPublic<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertPublicOpen();
    const accepted = operation();
    this.#publicWork.add(accepted);
    try {
      return await accepted;
    } finally {
      this.#publicWork.delete(accepted);
    }
  }

  dispose(): Promise<void> {
    const publication = this.#foregroundPending;
    if (publication === undefined) return this.#disposeAcquisition();
    this.closeForegroundAdmission();
    this.#publicClosing ??= publication.then(
      () => this.#disposeAcquisition(),
      () => this.#disposeAcquisition(),
    );
    return this.#publicClosing;
  }

  #disposeAcquisition(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#publicClosed = true;
    this.#disposed = true;
    ++this.#attempt;
    this.#receipt = undefined;
    if (this.ownsDefinitions) this.workspaceDefinitions.closeAdmission();
    const memoryClosing = this.ownsMemory
      ? this.workspaceMemory.dispose()
      : undefined;
    void memoryClosing?.catch(() => undefined);
    this.#closing = retireActivationOwners({
      publicWork: Promise.allSettled([this.#tail, ...this.#publicWork]),
      memory: memoryClosing,
      sessionClient: () =>
        this.ownsSessionClient ? this.ownedSessionClient.dispose() : undefined,
      afterClient: [
        () =>
          this.ownsDefinitions
            ? this.workspaceDefinitions.dispose()
            : undefined,
        () => this.mediaOwner?.dispose(),
        () => (this.ownsFilesystem ? this.trustCleanup?.() : undefined),
        () =>
          this.ownsFilesystem ? this.workspaceFilesystem.dispose() : undefined,
      ],
      settings: () =>
        this.ownsSettings && this.settingsOwnerOwnership === 'transferred'
          ? this.settingsOwner.dispose()
          : undefined,
    });
    return this.#closing;
  }

  static #validate(
    preflight: ActivationPreflight,
    config: Config,
    intent: ProviderActivationIntent | undefined,
    manager: RuntimeProviderManager | undefined,
    settings: SettingsService,
  ): void {
    const operation = preflight.operation;
    if (
      !(operation instanceof AgentActivationBootstrap) ||
      !(#attempt in operation)
    )
      throw new AgentBootstrapError('Invalid activation bootstrap operation');
    if (
      operation.#disposed ||
      operation.#receipt === undefined ||
      operation.#receipt.token !== preflight.token
    )
      throw new AgentBootstrapError(
        'Activation preflight token is invalid or already consumed',
      );
    if (operation.config !== config)
      throw new AgentBootstrapError(
        'Activation preflight belongs to a different Config',
      );
    if (operation.#manager !== manager)
      throw new AgentBootstrapError(
        'Activation preflight belongs to a different ProviderManager',
      );
    operation.settingsOwner.assertSettingsIdentity(settings);
    if (
      intent === undefined ||
      operation.#receipt.fingerprint !==
        canonicalProviderActivationIntent(intent)
    )
      throw new AgentBootstrapError(
        'Activation preflight intent mismatch or missing activation intent',
      );
  }

  static #consume(
    preflight: ActivationPreflight,
    config: Config,
    intent: ProviderActivationIntent,
    manager: RuntimeProviderManager | undefined,
    settings: SettingsService,
  ): ProviderActivationResult {
    AgentActivationBootstrap.#validate(
      preflight,
      config,
      intent,
      manager,
      settings,
    );
    const operation = preflight.operation;
    if (
      !(operation instanceof AgentActivationBootstrap) ||
      operation.#receipt === undefined
    )
      throw new AgentBootstrapError('Invalid activation bootstrap operation');
    const result = operation.#receipt.result;
    operation.#disposed = true;
    ++operation.#attempt;
    operation.#receipt = undefined;
    return result;
  }

  static async close(operation: AgentActivationOperation): Promise<void> {
    if (
      operation instanceof AgentActivationBootstrap &&
      #attempt in operation
    ) {
      await operation.dispose();
    }
  }
  static async adopt(
    config: Config,
    settingsService: SettingsService,
    intent: AgentAdoptionIntent,
    credentialAuthority: CredentialAuthority,
  ): Promise<Agent> {
    const operation = new AgentActivationBootstrap(config);
    operation.adoptionConfig = config;
    operation.adoptSettingsService = settingsService;
    operation.adoptIntent = intent;
    operation.adoptCredentialAuthority = credentialAuthority;
    return operation.beginAdoption();
  }

  protected beginAdoption(): Promise<Agent> {
    this.#foregroundPending = this.assembleAdoption();
    return this.#foregroundPending;
  }

  protected adoptionConfig: Config | undefined;
  protected validateAdoptionIdentity(): void {
    if (!(this.adoptionConfig instanceof Config))
      throw new AgentBootstrapError('fromConfig requires an existing Config');
  }
  protected async publishAdoptedAgent(agent: Agent): Promise<Agent> {
    this.#foregroundAgent = agent;
    try {
      this.assertConstructionOpen();
    } catch (primary) {
      try {
        await agent.dispose();
      } catch (cleanup) {
        throw new AggregateError(
          [primary, cleanup],
          'Adoption publication and cleanup failed',
        );
      }
      throw primary;
    }
    return agent;
  }
}
