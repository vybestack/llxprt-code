/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Config,
  openBrowserSecurely,
  type MessageBus,
  type ProviderSwitcher,
  type RuntimeProviderManager,
  type SessionSettingsOwner,
  type WorkspaceFilesystemOwner,
  type WorkspaceMemoryOwner,
  type WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';

import { type RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  type ProviderRuntimeContext,
  type RuntimeKind,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
  McpClientManager,
} from '@vybestack/llxprt-code-mcp';
import { defaultFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';

import {
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import { type ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { type SettingsService } from '@vybestack/llxprt-code-settings';

import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../core/subagent-cleanup.js';
import { type SessionClientOwner } from '../session/session-client-owner.js';
import {
  type ActivationPreflight,
  type ActivationPreflightToken,
  type AgentActivationOperation,
  type AgentActivationPreflightResult,
} from './activation-types.js';
import {
  AdoptedAgentAssembly,
  type AdoptionLifecyclePort,
} from './adopted-agent-assembly.js';
import { type Agent } from './agent.js';
import { AgentBootstrapError } from './agentBootstrap.js';
import {
  type AgentAdoptionIntent,
  type AgentForegroundHost,
  type ProviderActivationIntent,
} from './config-types.js';
import { retireActivationOwners } from './activationOwnerRetirement.js';
import {
  acquireActivationSession,
  executeActivationSession,
  type ActivationSessionAuth,
  type ActivationSessionReceiver,
  type ActivationSessionResources,
} from './fromConfig-session.js';
import { cleanupFailedAdoption } from './fromConfig-cleanup.js';

import { assembleHostGitHubBroker } from './host-github-broker-owner.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type {
  McpCapability,
  McpRuntimeAcquisition,
  McpRuntimeOperations,
} from './mcp-runtime-construction.js';
import type { ForegroundMcpPort } from './mcpRuntimePorts.js';
import type { SessionMcpSettingsReads } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
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

export interface PreflightActivationInput {
  readKind(): RuntimeKind | undefined;
  providerLifetime(): Promise<void>;
  filesystem: WorkspaceFilesystemOwner;
  memory: WorkspaceMemoryOwner;
  trust: WorkspaceTrustControlPort;
  trustCleanup: (() => Promise<void>) | undefined;
  files: ProviderFileLifecycle;
  policy: RuntimePolicyOwner;
  authority: CredentialAuthority;
  runtimeContext: ProviderRuntimeContext;
  releaseForegroundProviders(): Promise<void>;
  bus: MessageBus | undefined;
}

export interface PreflightSettingsInput {
  settingsOwner: SessionSettingsOwner;
  settingsOwnership: 'borrowed' | 'transferred';
}

export interface PreflightProviderInput {
  settings: SettingsService;
  manager: RuntimeProviderManager;
}

export interface PreflightAuthInput {
  oauth: OAuthManager;
}

function assertAdoptionConfig(config: unknown): asserts config is Config {
  if (!(config instanceof Config))
    throw new AgentBootstrapError('fromConfig requires an existing Config');
}

export class AgentActivationBootstrap
  implements AgentActivationOperation, AdoptionLifecyclePort
{
  readonly #config: Config;
  #assembly: AdoptedAgentAssembly | undefined;
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
  #activation!: PreflightActivationInput;
  #settings!: PreflightSettingsInput;
  #providers!: PreflightProviderInput;
  #auth!: PreflightAuthInput;
  #switcher!: ProviderSwitcher;
  #sessionResources!: ActivationSessionResources;
  #sessionAuth!: ActivationSessionAuth;
  #mcp: ForegroundMcpPort | undefined;
  #mediaOwner: SessionMediaOwner | undefined;
  #releaseForegroundProviders!: () => Promise<void>;
  #ownsFilesystem = false;
  #ownsTrustCleanup = false;
  #ownsDefinitions = false;
  #ownsMemory = false;
  #ownsSessionClient = true;
  #ownsSettings = true;
  constructor(config: Config) {
    this.#config = config;
  }
  static forPreflight(
    config: Config,
    activation: PreflightActivationInput,
    settings: PreflightSettingsInput,
    providers: PreflightProviderInput,
    auth: PreflightAuthInput,
  ): AgentActivationBootstrap {
    const bootstrap = new AgentActivationBootstrap(config);
    bootstrap.#assembly = AdoptedAgentAssembly.forPreflight(config);
    bootstrap.#activation = activation;
    bootstrap.#settings = settings;
    bootstrap.#providers = providers;
    bootstrap.#auth = auth;
    bootstrap.#policy = activation.policy;
    bootstrap.#runtimeContext = activation.runtimeContext;
    bootstrap.#releaseForegroundProviders =
      activation.releaseForegroundProviders;
    return bootstrap;
  }

  async preparePreflight(): Promise<ProviderSwitcher> {
    const receiver: ActivationSessionReceiver = {
      resources: (acquired) => this.#acceptSessionResources(acquired),
      auth: (acquired) => {
        this.#sessionAuth = acquired;
      },
    };
    const switcher = await acquireActivationSession(
      this.#config,
      this.#activation,
      this.#settings,
      this.#providers,
      this.#auth,
      receiver,
    );
    try {
      this.#switcher = switcher;
      this.#initializePreparedActivation();
    } catch (error) {
      return cleanupAfterFailure(error, () => this.dispose());
    }
    return switcher;
  }

  #acceptSessionResources(acquired: ActivationSessionResources): void {
    this.#sessionResources = acquired;
    this.#mediaOwner = acquired.media;
    this.#ownsFilesystem = true;
    this.#ownsTrustCleanup = true;
    this.#ownsMemory = true;
    this.#ownsDefinitions = true;
  }

  #initializePreparedActivation(): void {
    const resources = this.#sessionResources;
    this.sessionClient = {
      workspaceDirectories: () =>
        resources.workspaceFilesystem.paths.directories(),
      refreshAuth: (method) =>
        this.#admitPublic(() =>
          resources.sessionClient.clients.refreshAuth(method),
        ),
      runImageOperation: (input) =>
        this.#admitPublic(() =>
          resources.sessionClient.runImageOperation(input),
        ),
    };
    this.#manager = this.#providers.manager;
    this.#execute = (intent) =>
      executeActivationSession(
        this.#config,
        intent,
        this.#switcher,
        this.#providers,
        resources,
      );
  }

  listProfiles() {
    return this.#sessionResources.workspaceDefinitions.profileReads.listProfiles();
  }
  loadProfile(name: string) {
    return this.#sessionResources.workspaceDefinitions.profileReads.loadProfile(
      name,
    );
  }
  readHistory(): ReturnType<SessionClientOwner['clients']['readHistory']> {
    return this.#admitPublic(() =>
      this.#sessionResources.sessionClient.clients.readHistory(),
    );
  }
  #foregroundAgent: Agent | undefined;
  #foregroundPending: Promise<Agent> | undefined;
  #publicClosing: Promise<void> | undefined;
  #foregroundHost!: AgentForegroundHost;
  #policy: RuntimePolicyOwner | undefined;
  #runtimeContext!: ProviderRuntimeContext;

  closeForegroundAdmission(): void {
    this.#assembly?.closeConstructionAdmission();
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
    const assembly = this.#requireAssembly();
    assembly.assertOpen();
    AgentActivationBootstrap.#validate(
      { operation: this, token },
      this.#config,
      intent,
      this.#providers.manager,
      this.#providers.settings,
    );
    if (this.#sessionAuth.oauth !== this.#auth.oauth)
      throw new AgentBootstrapError(
        'Foreground OAuth differs from the acquired owner',
      );
    this.#providers.manager.setRuntimeContext(
      this.#runtimeContext,
      this.#sessionResources.settingsOwner,
      this.#providers.settings,
      this.#config,
    );
    this.#foregroundHost = host;
    this.#publicClosed = true;
    this.#foregroundPending = this.#trackConstruction(
      this.#completeForeground(assembly, token, intent),
    );
    return this.#foregroundPending;
  }

  #trackConstruction(publication: Promise<Agent>): Promise<Agent> {
    return publication.finally(() => {
      this.#assembly = undefined;
    });
  }

  #requireAssembly(): AdoptedAgentAssembly {
    const assembly = this.#assembly;
    if (assembly === undefined)
      throw new AgentBootstrapError(
        'Activation bootstrap construction has already settled',
      );
    return assembly;
  }

  async #joinPublicWork(): Promise<void> {
    await Promise.allSettled([this.#tail, ...this.#publicWork]);
  }

  async #completeForeground(
    assembly: AdoptedAgentAssembly,
    token: ActivationPreflightToken,
    intent: ProviderActivationIntent,
  ): Promise<Agent> {
    let broker: ReturnType<typeof assembleHostGitHubBroker>;
    try {
      await this.#joinPublicWork();
      assembly.assertOpen();
      AgentActivationBootstrap.#consume(
        { operation: this, token },
        this.#config,
        intent,
        this.#providers.manager,
        this.#providers.settings,
      );
      broker = assembleHostGitHubBroker(this.#foregroundHost);
      await this.#constructForegroundMcp();
      const mcp = this.#mcp;
      if (mcp === undefined) throw new Error('Foreground MCP is not acquired');
      assembly.assertOpen();
      const client = await this.#bindForegroundClient(broker, mcp);
      assembly.assertOpen();
      assembly.acceptPreflightTransfer(
        {
          mcp,
          mediaOwner: this.#mediaOwner,
          sessionClient: client,
          release: this.#releaseForegroundProviders,
        },
        { settingsOwner: this.#sessionResources.settingsOwner },
        this.#providers,
        this.#auth,
      );
      const agent = await assembly.finishForeground();
      this.#foregroundAgent = agent;
      this.#ownsSessionClient = false;
      this.#ownsSettings = false;
      this.#mediaOwner = undefined;
      assembly.assertOpen();
      await this.#disposeAcquisition();
      this.#foregroundHost.onSkills?.(mcp.workspaceSkills.operations);
      this.#foregroundHost.onExtensionRestart?.(
        mcp.extensionOperations.restart.bind(mcp.extensionOperations),
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
      const mcp = this.#mcp;
      return cleanupFailedAdoption(
        primary,
        () =>
          runCleanupSteps([
            () => this.#disposeAcquisition(),
            () => this.#releaseForegroundProviders(),
            () => broker?.cleanupFailedConstruction(),
            () => this.#config.dispose(),
          ]),
        mcp?.dispose.bind(mcp),
        undefined,
        undefined,
      );
    }
  }

  async #bindForegroundClient(
    broker: ReturnType<typeof assembleHostGitHubBroker>,
    mcp: ForegroundMcpPort,
  ): Promise<SessionClientOwner> {
    const client = this.#sessionResources.sessionClient;
    client.bindHostGitHub(broker);
    client.bindMcpRuntime(mcp, mcp.profileDefinitions, mcp.subagentDefinitions);
    if (!client.hasHookComposition()) client.bindHooks();
    await mcp.initialize();
    await client.initializeTools();
    return client;
  }

  async #constructForegroundMcp(): Promise<void> {
    const transport = this.#foregroundHost.mcpHost;
    const feedback = transport?.emitFeedback ?? defaultFeedbackSink;
    const policyOwner = this.#policy;
    if (policyOwner === undefined)
      throw new Error(
        'Foreground MCP construction requires the preflight policy owner',
      );
    const acquisition: McpRuntimeAcquisition = {
      oauth: {
        getAuthProviderFactory: transport?.getAuthProviderFactory,
        tokenStorage: new MCPOAuthTokenStorage(
          new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
        ),
        openBrowser: transport?.openBrowser ?? openBrowserSecurely,
      },
      config: this.#config,
      managerFactory: McpClientManager,
      extensionLoader: { kind: 'none' },
      policy: { kind: 'supplied', owner: policyOwner, ownership: 'caller' },
      lsp: { kind: 'none' },
      filesystem: {
        kind: 'supplied',
        owner: this.#sessionResources.workspaceFilesystem,
        ownership: 'runtime',
      },
      filesystemService: { kind: 'none' },
      memory: {
        kind: 'supplied',
        owner: this.#sessionResources.workspaceMemory,
        ownership: 'runtime',
      },
      definitions: {
        kind: 'supplied',
        owner: this.#sessionResources.workspaceDefinitions,
        ownership: 'runtime',
      },
      trust: {
        kind: 'supplied',
        owner: this.#sessionResources.workspaceTrust,
        cleanup: async () => {
          this.#ownsTrustCleanup = false;
          await this.#sessionResources.trustCleanup?.();
        },
      },
      ide: { kind: 'none' },
    };
    const operations: McpRuntimeOperations = {
      emitFeedback: feedback,
      skillOperations: {
        kind: 'supplied',
        capability: {
          reloadPolicy:
            this.#foregroundHost.skillPolicy ??
            DEFAULT_SKILL_OPERATIONS.reloadPolicy,
          registerTools:
            this.#foregroundHost.registerSkillTools ??
            DEFAULT_SKILL_OPERATIONS.registerTools,
        },
      },
      mcpSettings: this.#readMcpSettingsCapability(),
    };
    this.#ownsFilesystem = false;
    this.#ownsDefinitions = false;
    this.#ownsMemory = false;
    const mcp = await McpRuntimeOwner.create(acquisition, operations);
    this.#ownsTrustCleanup = false;
    this.#mcp = mcp;
  }

  #readMcpSettingsCapability(): McpCapability<SessionMcpSettingsReads> {
    const reads = this.#sessionResources.settingsOwner.readMcpSettingsBinding();
    return reads === undefined
      ? { kind: 'none' }
      : { kind: 'supplied', capability: reads };
  }

  prepareProfileActivation(
    signal: AbortSignal,
  ): Promise<PreparedProfileFacade> {
    return this.#admitPublic(async () => {
      signal.throwIfAborted();
      const replacement =
        await this.#sessionResources.sessionClient.clients.prepareProfileActivation(
          signal,
        );
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
    const resources = this.#sessionResources;
    if (this.#ownsDefinitions) resources.workspaceDefinitions.closeAdmission();
    const memoryClosing = this.#ownsMemory
      ? resources.workspaceMemory.dispose()
      : undefined;
    void memoryClosing?.catch(() => undefined);
    this.#closing = retireActivationOwners({
      publicWork: Promise.allSettled([this.#tail, ...this.#publicWork]),
      memory: memoryClosing,
      sessionClient: () =>
        this.#ownsSessionClient ? resources.sessionClient.dispose() : undefined,
      afterClient: [
        () =>
          this.#ownsDefinitions
            ? resources.workspaceDefinitions.dispose()
            : undefined,
        () => this.#mediaOwner?.dispose(),
        () => (this.#ownsTrustCleanup ? resources.trustCleanup?.() : undefined),
        () =>
          this.#ownsFilesystem
            ? resources.workspaceFilesystem.dispose()
            : undefined,
      ],
      settings: () =>
        this.#ownsSettings && resources.settingsOwnership === 'transferred'
          ? resources.settingsOwner.dispose()
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
    if (operation.#config !== config)
      throw new AgentBootstrapError(
        'Activation preflight belongs to a different Config',
      );
    if (operation.#manager !== manager)
      throw new AgentBootstrapError(
        'Activation preflight belongs to a different ProviderManager',
      );
    operation.#sessionResources.settingsOwner.assertSettingsIdentity(settings);
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
    const assembly = AdoptedAgentAssembly.forAdoption(
      { config, settingsService, intent, credentialAuthority },
      operation,
    );
    operation.#assembly = assembly;
    operation.#foregroundPending = operation.#trackConstruction(
      assembly.assembleAdoption(),
    );
    return operation.#foregroundPending;
  }

  validateIdentity(): void {
    assertAdoptionConfig(this.#config);
  }

  async publish(agent: Agent): Promise<Agent> {
    this.#foregroundAgent = agent;
    try {
      this.#requireAssembly().assertOpen();
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
